import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const TIME_ZONE = 'Africa/Kampala'
const DEFAULT_TAX = 18
const DEFAULT_SERVICE = 5
const MAX_ITEMS = 50
const MAX_STOCK_PARTS = 100

function getDatabase() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Server configuration is incomplete. Set the Firebase Admin environment variables in Vercel.')
  }

  const app = getApps()[0] ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  })

  return getFirestore(app)
}

const validCount = value =>
  Number.isSafeInteger(value) && value > 0 && value <= 100

const validVenueId = value =>
  typeof value === 'string' && /^[\w-]{1,128}$/.test(value)

const rate = (value, fallback) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : fallback

const dayKeyOf = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)

const splitTotals = (subtotal, tax, service) => {
  const total = Math.round(subtotal * (1 + (tax + service) / 100))
  const taxAmount = Math.round(subtotal * tax / 100)
  return {
    subtotal,
    taxAmount,
    serviceAmount: total - subtotal - taxAmount,
    total,
  }
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return sendError(res, 405, 'Method not allowed.')
  }

  try {
    const authorization = req.headers.authorization ?? ''
    const match = /^Bearer\s+(.+)$/i.exec(authorization)
    if (!match) return sendError(res, 401, 'Please sign in again.')

    const database = getDatabase()
    const { getAuth } = await import('firebase-admin/auth')
    const decoded = await getAuth().verifyIdToken(match[1])

    const { venueId, requestId, table, items } = req.body ?? {}
    if (
      !validVenueId(venueId) ||
      typeof requestId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(requestId) ||
      typeof table !== 'string' ||
      !/^[0-9]{1,3}$/.test(table) ||
      !Array.isArray(items) ||
      items.length < 1 ||
      items.length > MAX_ITEMS ||
      !items.every(item => item && Number.isSafeInteger(item.id) && validCount(item.qty))
    ) {
      return sendError(res, 400, 'Invalid order information.')
    }

    if (new Set(items.map(item => item.id)).size !== items.length) {
      return sendError(res, 400, 'Duplicate menu item entries.')
    }

    const base = database.collection('venues').doc(venueId)
    const memberRef = base.collection('members').doc(decoded.uid)
    const orderRef = base.collection('orders').doc(requestId)
    const settingsRef = base.collection('settings').doc('general')
    const menuRefs = items.map(item => base.collection('menu').doc(String(item.id)))

    const result = await database.runTransaction(async tx => {
      const [member, previous, settings, ...menuDocs] =
        await tx.getAll(memberRef, orderRef, settingsRef, ...menuRefs)

      if (!member.exists || member.get('enabled') !== true ||
          !['manager', 'waiter'].includes(member.get('role'))) {
        const error = new Error('Not authorized to place orders.')
        error.status = 403
        throw error
      }

      if (previous.exists) {
        return { orderId: requestId, alreadyProcessed: true }
      }

      const tax = rate(settings.get('taxRate'), DEFAULT_TAX)
      const service = rate(settings.get('serviceCharge'), DEFAULT_SERVICE)
      const requirements = new Map()
      let subtotal = 0

      const lines = items.map(({ id, qty }, index) => {
        const snapshot = menuDocs[index]
        const item = snapshot.data()

        if (!snapshot.exists || item.available !== true ||
            !Number.isSafeInteger(item.price) || item.price < 0 ||
            !['Kitchen', 'Bar'].includes(item.route)) {
          const error = new Error('A menu item is unavailable or invalid.')
          error.status = 409
          throw error
        }

        if (!Array.isArray(item.recipe) || item.recipe.length === 0 || item.recipe.length > 30) {
          const error = new Error(`${item.name} has no stock recipe.`)
          error.status = 409
          throw error
        }

        for (const part of item.recipe) {
          if (!part || typeof part.inventoryId !== 'string' || !part.inventoryId ||
              part.inventoryId.includes('/') || !Number.isFinite(part.quantity) || part.quantity <= 0) {
            const error = new Error(`Invalid stock recipe for ${item.name}.`)
            error.status = 409
            throw error
          }
          requirements.set(
            part.inventoryId,
            (requirements.get(part.inventoryId) ?? 0) + part.quantity * qty,
          )
        }

        subtotal += item.price * qty
        return { id, name: item.name, price: item.price, qty, route: item.route }
      })

      if (!Number.isSafeInteger(subtotal) || subtotal > 1_000_000_000 ||
          requirements.size > MAX_STOCK_PARTS) {
        const error = new Error('Order exceeds supported limits.')
        error.status = 400
        throw error
      }

      const inventoryEntries = [...requirements].map(([name, count]) => ({
        name,
        count,
        ref: base.collection('inventory').doc(name),
      }))
      const inventoryDocs = inventoryEntries.length
        ? await tx.getAll(...inventoryEntries.map(entry => entry.ref))
        : []

      inventoryEntries.forEach((entry, index) => {
        const snapshot = inventoryDocs[index]
        const available = snapshot.get('qty')
        if (!snapshot.exists || typeof available !== 'number' ||
            !Number.isFinite(available) || available < entry.count - 1e-9) {
          const error = new Error(`Insufficient stock: ${entry.name}.`)
          error.status = 409
          throw error
        }
      })

      const { taxAmount, serviceAmount, total } = splitTotals(subtotal, tax, service)
      const event = FieldValue.serverTimestamp()
      const now = new Date()

      inventoryEntries.forEach((entry, index) => {
        const balance = Math.max(
          0,
          Number((inventoryDocs[index].get('qty') - entry.count).toFixed(6)),
        )
        tx.update(entry.ref, { qty: balance })
        tx.create(base.collection('stockMovements').doc(`${requestId}_${index}`), {
          orderId: requestId,
          itemName: entry.name,
          deducted: entry.count,
          balance,
          createdAt: event,
          type: 'sale',
        })
      })

      tx.create(orderRef, {
        id: requestId,
        createdAt: now.toISOString(),
        createdAtServer: event,
        dayKey: dayKeyOf(now),
        createdBy: decoded.uid,
        table,
        staff: decoded.email ?? 'Staff',
        status: 'New',
        preparation: { Kitchen: 'New', Bar: 'New' },
        lineItems: lines,
        items: lines.map(item => `${item.qty} × ${item.name}`).join(', '),
        subtotal,
        tax,
        service,
        taxAmount,
        serviceAmount,
        total,
        paymentStatus: 'Unpaid',
        stockDeducted: true,
      })

      return { orderId: requestId, alreadyProcessed: false }
    })

    return res.status(200).json(result)
  } catch (error) {
    console.error('placeStockOrder failed:', error)
    const status = Number.isInteger(error?.status) ? error.status : 500
    const message = status === 500
      ? 'The order could not be processed. Check Vercel Function Logs for details.'
      : error.message
    return sendError(res, status, message)
  }
}
