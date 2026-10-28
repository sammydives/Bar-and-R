import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
initializeApp();
const database = getFirestore();
const validCount = value => Number.isSafeInteger(value) && value > 0 && value <= 100;
const fail = (code, message) => { throw new HttpsError(code, message); };

export const placeStockOrder = onCall({ region: 'us-central1', maxInstances: 20 }, async request => {
  if (!request.auth) fail('unauthenticated', 'Please sign in.');
  const { venueId, requestId, table, items, tax, service } = request.data ?? {};
  if (typeof venueId !== 'string' || !/^[\w-]{1,128}$/.test(venueId) ||
      typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId) ||
      typeof table !== 'string' || !/^[0-9]{1,3}$/.test(table) ||
      !Array.isArray(items) || items.length < 1 || items.length > 50 ||
      !items.every(x => x && Number.isSafeInteger(x.id) && validCount(x.qty)) ||
      ![tax, service].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100)) {
    fail('invalid-argument', 'Invalid order information.');
  }
  if (new Set(items.map(x => x.id)).size !== items.length) fail('invalid-argument', 'Duplicate menu item entries.');
  const base = database.collection('venues').doc(venueId);
  const memberRef = base.collection('members').doc(request.auth.uid);
  const orderRef = base.collection('orders').doc(requestId);
  const menuRefs = items.map(x => base.collection('menu').doc(String(x.id)));
  return database.runTransaction(async tx => {
    // Read all data before transaction writes; Firestore retries on contention.
    const [member, previous, ...menuDocs] = await tx.getAll(memberRef, orderRef, ...menuRefs);
    if (!member.exists || member.get('enabled') !== true || !['manager', 'waiter'].includes(member.get('role'))) fail('permission-denied', 'Not authorized to place orders.');
    if (previous.exists) return { orderId: requestId, alreadyProcessed: true };
    const requirements = new Map();
    let subtotal = 0;
    const lines = items.map(({ id, qty }, index) => {
      const snap = menuDocs[index]; const item = snap.data();
      if (!snap.exists || item.available !== true || !Number.isSafeInteger(item.price) || item.price < 0 || !['Kitchen','Bar'].includes(item.route)) fail('failed-precondition', 'A menu item is unavailable or invalid.');
      if (!Array.isArray(item.recipe) || item.recipe.length === 0 || item.recipe.length > 30) fail('failed-precondition', `${item.name} has no stock recipe.`);
      for (const part of item.recipe) {
        if (!part || typeof part.inventoryId !== 'string' || !part.inventoryId || part.inventoryId.includes('/') || !Number.isFinite(part.quantity) || part.quantity <= 0) fail('failed-precondition', `Invalid stock recipe for ${item.name}.`);
        requirements.set(part.inventoryId, (requirements.get(part.inventoryId) ?? 0) + part.quantity * qty);
      }
      subtotal += item.price * qty;
      return { id, name: item.name, price: item.price, qty, route: item.route };
    });
    if (!Number.isSafeInteger(subtotal) || subtotal > 1000000000 || requirements.size > 100) fail('invalid-argument', 'Order exceeds supported limits.');
    const inventoryEntries = [...requirements].map(([name, count]) => ({ name, count, ref: base.collection('inventory').doc(name) }));
    const inventoryDocs = await tx.getAll(...inventoryEntries.map(x => x.ref));
    inventoryEntries.forEach((entry, index) => {
      const snapshot = inventoryDocs[index]; const available = snapshot.get('qty');
      if (!snapshot.exists || typeof available !== 'number' || !Number.isFinite(available) || available < entry.count - 1e-9) fail('failed-precondition', `Insufficient stock: ${entry.name}.`);
    });
    const roundedTotal = Math.round(subtotal * (1 + (tax + service) / 100));
    const event = FieldValue.serverTimestamp();
    inventoryEntries.forEach((entry, index) => {
      const balance = Math.max(0, Number((inventoryDocs[index].get('qty') - entry.count).toFixed(6)));
      tx.update(entry.ref, { qty: balance });
      tx.create(base.collection('stockMovements').doc(`${requestId}_${index}`), { orderId: requestId, itemName: entry.name, deducted: entry.count, balance, createdAt: event, type: 'sale' });
    });
    tx.create(orderRef, { id: requestId, createdAt: new Date().toISOString(), createdAtServer: event, createdBy: request.auth.uid, table, staff: request.auth.token.email ?? 'Staff', status: 'New', preparation: { Kitchen:'New', Bar:'New' }, lineItems: lines, items: lines.map(x=>`${x.qty} × ${x.name}`).join(', '), subtotal, tax, service, total: roundedTotal, stockDeducted: true });
    return { orderId: requestId, alreadyProcessed: false };
  });
});
