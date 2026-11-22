import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
initializeApp();
const database = getFirestore();

const TIME_ZONE = 'Africa/Kampala';
const DEFAULT_TAX = 18;
const DEFAULT_SERVICE = 5;
const DEFAULT_METHODS = ['Cash', 'Card', 'MTN Mobile Money', 'Airtel Money'];
// Mobile money is NOT integrated: staff type the reference from the customer's confirmation message.
const REFERENCE_REQUIRED = ['MTN Mobile Money', 'Airtel Money'];
const MAX_DAY_ORDERS = 2000;

const validCount = value => Number.isSafeInteger(value) && value > 0 && value <= 100;
const fail = (code, message) => { throw new HttpsError(code, message); };
const validVenueId = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const validMethodName = value => typeof value === 'string' && /^[\w ()+-]{1,40}$/.test(value);
const rate = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : fallback);

// "2026-11-22" for the Kampala calendar day. The server clock decides the day, never the phone.
const dayKeyOf = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const validDayKey = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

// Splits a bill so subtotal + tax + service always equals the total exactly (whole UGX).
const splitTotals = (subtotal, tax, service) => {
  const total = Math.round(subtotal * (1 + (tax + service) / 100));
  const taxAmount = Math.round(subtotal * tax / 100);
  return { subtotal, taxAmount, serviceAmount: total - subtotal - taxAmount, total };
};

const enabledMember = (member, roles) => member.exists && member.get('enabled') === true && roles.includes(member.get('role'));

export const placeStockOrder = onCall({ region: 'us-central1', maxInstances: 20 }, async request => {
  if (!request.auth) fail('unauthenticated', 'Please sign in.');
  // tax/service sent by older clients are ignored: the venue settings are the only source.
  const { venueId, requestId, table, items } = request.data ?? {};
  if (!validVenueId(venueId) ||
      typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId) ||
      typeof table !== 'string' || !/^[0-9]{1,3}$/.test(table) ||
      !Array.isArray(items) || items.length < 1 || items.length > 50 ||
      !items.every(x => x && Number.isSafeInteger(x.id) && validCount(x.qty))) {
    fail('invalid-argument', 'Invalid order information.');
  }
  if (new Set(items.map(x => x.id)).size !== items.length) fail('invalid-argument', 'Duplicate menu item entries.');
  const base = database.collection('venues').doc(venueId);
  const memberRef = base.collection('members').doc(request.auth.uid);
  const orderRef = base.collection('orders').doc(requestId);
  const settingsRef = base.collection('settings').doc('general');
  const menuRefs = items.map(x => base.collection('menu').doc(String(x.id)));
  return database.runTransaction(async tx => {
    // Read all data before transaction writes; Firestore retries on contention.
    const [member, previous, settings, ...menuDocs] = await tx.getAll(memberRef, orderRef, settingsRef, ...menuRefs);
    if (!enabledMember(member, ['manager', 'waiter'])) fail('permission-denied', 'Not authorized to place orders.');
    if (previous.exists) return { orderId: requestId, alreadyProcessed: true };
    const tax = rate(settings.get('taxRate'), DEFAULT_TAX);
    const service = rate(settings.get('serviceCharge'), DEFAULT_SERVICE);
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
    const { taxAmount, serviceAmount, total } = splitTotals(subtotal, tax, service);
    const event = FieldValue.serverTimestamp();
    const now = new Date();
    inventoryEntries.forEach((entry, index) => {
      const balance = Math.max(0, Number((inventoryDocs[index].get('qty') - entry.count).toFixed(6)));
      tx.update(entry.ref, { qty: balance });
      tx.create(base.collection('stockMovements').doc(`${requestId}_${index}`), { orderId: requestId, itemName: entry.name, deducted: entry.count, balance, createdAt: event, type: 'sale' });
    });
    tx.create(orderRef, {
      id: requestId, createdAt: now.toISOString(), createdAtServer: event, dayKey: dayKeyOf(now), createdBy: request.auth.uid,
      table, staff: request.auth.token.email ?? 'Staff', status: 'New', preparation: { Kitchen: 'New', Bar: 'New' },
      lineItems: lines, items: lines.map(x => `${x.qty} × ${x.name}`).join(', '),
      subtotal, tax, service, taxAmount, serviceAmount, total,
      paymentStatus: 'Unpaid', stockDeducted: true,
    });
    return { orderId: requestId, alreadyProcessed: false };
  });
});

// Records how an order was paid and adds it to that day's running totals, in one transaction.
export const recordPayment = onCall({ region: 'us-central1', maxInstances: 20 }, async request => {
  if (!request.auth) fail('unauthenticated', 'Please sign in.');
  const { venueId, orderId, method, tendered, reference } = request.data ?? {};
  const refText = typeof reference === 'string' ? reference.trim() : '';
  if (!validVenueId(venueId) ||
      typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orderId) ||
      !validMethodName(method) ||
      (reference !== undefined && reference !== null && (typeof reference !== 'string' || refText.length > 60)) ||
      (tendered !== undefined && tendered !== null && (!Number.isSafeInteger(tendered) || tendered < 0))) {
    fail('invalid-argument', 'Invalid payment information.');
  }
  const base = database.collection('venues').doc(venueId);
  const memberRef = base.collection('members').doc(request.auth.uid);
  const orderRef = base.collection('orders').doc(orderId);
  const settingsRef = base.collection('settings').doc('general');
  // One mobile-money/card reference can only be used once per venue.
  const refKeyRef = refText ? base.collection('paymentRefs').doc(encodeURIComponent(`${method}|${refText.toUpperCase()}`)) : null;
  return database.runTransaction(async tx => {
    const now = new Date();
    const day = dayKeyOf(now);
    const dailyRef = base.collection('dailySales').doc(day);
    const reads = [memberRef, orderRef, settingsRef, dailyRef];
    if (refKeyRef) reads.push(refKeyRef);
    const [member, orderSnap, settings, daily, refSnap] = await tx.getAll(...reads);
    if (!enabledMember(member, ['manager', 'waiter'])) fail('permission-denied', 'Not authorized to record payments.');
    if (!orderSnap.exists) fail('not-found', 'Order not found.');
    const order = orderSnap.data();
    if (order.paymentStatus === 'Paid') return { orderId, alreadyProcessed: true, change: 0 };
    if (order.paymentStatus !== 'Unpaid' || order.status === 'Cancelled') fail('failed-precondition', 'This order cannot be paid.');
    const configured = settings.get('paymentMethods');
    const methods = Array.isArray(configured) ? configured.filter(validMethodName) : DEFAULT_METHODS;
    if (!methods.includes(method)) fail('invalid-argument', 'This payment method is not enabled in Settings.');
    if (REFERENCE_REQUIRED.includes(method) && refText.length < 4) fail('invalid-argument', 'Enter the transaction reference from the customer\u2019s mobile money message.');
    if (refSnap?.exists) fail('already-exists', 'This transaction reference was already used on another order.');
    if (daily.exists && daily.get('status') === 'closed') fail('failed-precondition', `Sales for ${day} are already closed.`);
    const total = order.total;
    if (!Number.isSafeInteger(total) || total < 0) fail('failed-precondition', 'This order has an invalid total.');
    let received = total;
    let change = 0;
    if (method === 'Cash') {
      received = tendered ?? total;
      if (received < total) fail('invalid-argument', 'Cash received is less than the amount due.');
      change = received - total;
    }
    tx.update(orderRef, {
      paymentStatus: 'Paid',
      payment: {
        method, amount: total, tendered: received, change, reference: refText,
        recordedBy: request.auth.uid, recordedByEmail: request.auth.token.email ?? 'Staff',
        at: FieldValue.serverTimestamp(), atIso: now.toISOString(), dayKey: day,
      },
    });
    if (refKeyRef) tx.create(refKeyRef, { orderId, method, createdAt: FieldValue.serverTimestamp() });
    const items = {};
    for (const line of order.lineItems ?? []) {
      items[String(line.id)] = { name: line.name, qty: FieldValue.increment(line.qty), revenue: FieldValue.increment(line.price * line.qty) };
    }
    tx.set(dailyRef, {
      day, status: 'open',
      orderCount: FieldValue.increment(1), total: FieldValue.increment(total),
      subtotal: FieldValue.increment(order.subtotal ?? 0), taxAmount: FieldValue.increment(order.taxAmount ?? 0), serviceAmount: FieldValue.increment(order.serviceAmount ?? 0),
      byMethod: { [method]: FieldValue.increment(total) }, items,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { orderId, alreadyProcessed: false, change };
  });
});

// Manager-only. Rebuilds the day's totals from the actual paid orders, compares the cash count, and locks the day.
export const closeDay = onCall({ region: 'us-central1', maxInstances: 5 }, async request => {
  if (!request.auth) fail('unauthenticated', 'Please sign in.');
  const { venueId, day, countedCash, note } = request.data ?? {};
  if (!validVenueId(venueId) || !validDayKey(day) ||
      (countedCash !== undefined && countedCash !== null && (!Number.isSafeInteger(countedCash) || countedCash < 0)) ||
      (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 300))) {
    fail('invalid-argument', 'Invalid close-day information.');
  }
  if (day > dayKeyOf()) fail('failed-precondition', 'A day that has not started yet cannot be closed.');
  const base = database.collection('venues').doc(venueId);
  const memberRef = base.collection('members').doc(request.auth.uid);
  const dailyRef = base.collection('dailySales').doc(day);
  const paidQuery = base.collection('orders').where('payment.dayKey', '==', day).limit(MAX_DAY_ORDERS + 1);
  const createdQuery = base.collection('orders').where('dayKey', '==', day).limit(MAX_DAY_ORDERS + 1);
  return database.runTransaction(async tx => {
    const [member, daily] = await tx.getAll(memberRef, dailyRef);
    if (!enabledMember(member, ['manager'])) fail('permission-denied', 'Only managers can close a day.');
    if (daily.exists && daily.get('status') === 'closed') return { day, alreadyClosed: true };
    const [paidSnap, createdSnap] = await Promise.all([tx.get(paidQuery), tx.get(createdQuery)]);
    if (paidSnap.size > MAX_DAY_ORDERS || createdSnap.size > MAX_DAY_ORDERS) fail('resource-exhausted', 'Too many orders to close in one step. Contact support.');
    const totals = { orderCount: 0, total: 0, subtotal: 0, taxAmount: 0, serviceAmount: 0 };
    const byMethod = {};
    const items = {};
    for (const snap of paidSnap.docs) {
      const order = snap.data();
      const paidMethod = order.payment?.method;
      if (typeof paidMethod !== 'string') continue;
      totals.orderCount += 1;
      totals.total += order.total ?? 0;
      totals.subtotal += order.subtotal ?? 0;
      totals.taxAmount += order.taxAmount ?? 0;
      totals.serviceAmount += order.serviceAmount ?? 0;
      byMethod[paidMethod] = (byMethod[paidMethod] ?? 0) + (order.total ?? 0);
      for (const line of order.lineItems ?? []) {
        const key = String(line.id);
        const entry = items[key] ?? { name: line.name, qty: 0, revenue: 0 };
        entry.qty += line.qty; entry.revenue += line.price * line.qty;
        items[key] = entry;
      }
    }
    const unpaid = createdSnap.docs.map(s => s.data()).filter(o => o.paymentStatus === 'Unpaid' && o.status !== 'Cancelled');
    const unpaidValue = unpaid.reduce((sum, o) => sum + (o.total ?? 0), 0);
    const expectedCash = byMethod.Cash ?? 0;
    const counted = typeof countedCash === 'number' ? countedCash : null;
    const runningTotal = daily.exists ? (daily.get('total') ?? 0) : 0;
    tx.set(dailyRef, {
      day, status: 'closed', ...totals, byMethod, items,
      unpaidCount: unpaid.length, unpaidValue,
      expectedCash, countedCash: counted, cashDifference: counted === null ? null : counted - expectedCash,
      note: typeof note === 'string' ? note.trim() : '',
      runningTotalMismatch: runningTotal !== totals.total,
      closedBy: request.auth.uid, closedByEmail: request.auth.token.email ?? 'Manager',
      closedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    return { day, alreadyClosed: false, total: totals.total, orderCount: totals.orderCount, cashDifference: counted === null ? null : counted - expectedCash };
  });
});
