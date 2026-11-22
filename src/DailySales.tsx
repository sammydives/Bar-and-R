import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth, db } from './lib/firebase'

const money = (n: number) => `UGX ${n.toLocaleString('en-UG')}`
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`
const errorText = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback)
// The server decides the real business day (Africa/Kampala). This only pre-selects a day in the form.
const kampalaDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

type DayItem = { name: string; qty: number; revenue: number }
type DailyDoc = {
  day: string; status: 'open' | 'closed'
  orderCount: number; total: number; subtotal: number; taxAmount: number; serviceAmount: number
  byMethod: Record<string, number>; items: Record<string, DayItem>
  unpaidCount: number; unpaidValue: number
  expectedCash: number | null; countedCash: number | null; cashDifference: number | null
  note: string; closedByEmail: string
}

function parseDay(id: string, raw: Record<string, unknown>): DailyDoc {
  const methods = (raw.byMethod && typeof raw.byMethod === 'object' ? raw.byMethod : {}) as Record<string, unknown>
  const items = (raw.items && typeof raw.items === 'object' ? raw.items : {}) as Record<string, Record<string, unknown> | null>
  return {
    day: typeof raw.day === 'string' ? raw.day : id,
    status: raw.status === 'closed' ? 'closed' : 'open',
    orderCount: num(raw.orderCount), total: num(raw.total), subtotal: num(raw.subtotal), taxAmount: num(raw.taxAmount), serviceAmount: num(raw.serviceAmount),
    byMethod: Object.fromEntries(Object.entries(methods).map(([key, value]) => [key, num(value)])),
    items: Object.fromEntries(Object.entries(items).map(([key, value]) => {
      const entry = value ?? {}
      return [key, { name: typeof entry.name === 'string' ? entry.name : key, qty: num(entry.qty), revenue: num(entry.revenue) }]
    })),
    unpaidCount: num(raw.unpaidCount), unpaidValue: num(raw.unpaidValue),
    expectedCash: typeof raw.expectedCash === 'number' ? raw.expectedCash : null,
    countedCash: typeof raw.countedCash === 'number' ? raw.countedCash : null,
    cashDifference: typeof raw.cashDifference === 'number' ? raw.cashDifference : null,
    note: typeof raw.note === 'string' ? raw.note : '',
    closedByEmail: typeof raw.closedByEmail === 'string' ? raw.closedByEmail : '',
  }
}

type PayableOrder = { id: number | string; table: string; total: number }

/** Records how a customer paid. Mobile money is typed in by staff and is not verified with MTN or Airtel. */
export function PaymentSheet({ order, venueId, methods, onClose, onDone }: {
  order: PayableOrder; venueId: string; methods: string[]; onClose: () => void; onDone: (text: string) => void
}) {
  const options = methods.length ? methods : ['Cash']
  const [method, setMethod] = useState(options[0])
  const [tendered, setTendered] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isCash = method === 'Cash'
  const needsReference = method === 'MTN Mobile Money' || method === 'Airtel Money'
  const received = tendered.trim() === '' ? order.total : Number(tendered)
  const change = isCash && Number.isFinite(received) ? received - order.total : 0

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!auth || busy) return
    if (isCash && (!Number.isSafeInteger(received) || received < order.total)) { setError('Cash received must be a whole number that covers the amount due.'); return }
    if (needsReference && reference.trim().length < 4) { setError('Enter the transaction reference from the customer\u2019s mobile money message.'); return }
    setBusy(true); setError('')
    try {
      const call = httpsCallable<Record<string, unknown>, { alreadyProcessed?: boolean; change?: number }>(getFunctions(auth.app), 'recordPayment')
      const result = await call({ venueId, orderId: String(order.id), method, tendered: isCash ? received : null, reference: reference.trim() })
      onDone(result.data.alreadyProcessed ? 'This order was already marked paid.' : `Payment recorded for table ${order.table}.${result.data.change ? ` Change due: ${money(result.data.change)}.` : ''}`)
    } catch (e) { setError(errorText(e, 'Could not record the payment.')) }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop" onClick={onClose}>
    <section className="form-sheet" role="dialog" aria-modal="true" aria-label="Take payment" onClick={e => e.stopPropagation()}>
      <div className="page-toolbar"><h2>Take payment</h2><button type="button" className="action" onClick={onClose}>Close</button></div>
      <form onSubmit={e => void submit(e)}>
        <p>Table {order.table} · Amount due <b>{money(order.total)}</b></p>
        <label className="field"><span>Payment method</span>
          <select value={method} disabled={busy} onChange={e => { setMethod(e.target.value); setError('') }}>{options.map(x => <option key={x}>{x}</option>)}</select>
        </label>
        {isCash && <label className="field"><span>Cash received (UGX)</span>
          <input type="number" min={order.total} step="1" inputMode="numeric" placeholder={String(order.total)} value={tendered} disabled={busy} onChange={e => setTendered(e.target.value)} autoFocus />
        </label>}
        {isCash && change > 0 && <p>Change to give: <b>{money(change)}</b></p>}
        {!isCash && <label className="field"><span>{needsReference ? 'Transaction reference (required)' : 'Reference or last 4 digits (optional)'}</span>
          <input value={reference} maxLength={60} disabled={busy} onChange={e => setReference(e.target.value)} autoFocus />
        </label>}
        {error && <p role="alert" className="page-notice">{error}</p>}
        <p className="demo-note">Recorded by hand. Mobile money and card payments are not verified automatically, so check the confirmation message before saving.</p>
        <button className="action primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
      </form>
    </section>
  </div>
}

/** Daily totals for managers, with a "Close day" step that locks the day and checks the cash count. */
export function DailySalesPanel({ venueId, isManager, orders }: {
  venueId: string; isManager: boolean
  orders: { dayKey?: string; paymentStatus?: string; status: string; total: number }[]
}) {
  const [days, setDays] = useState<DailyDoc[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(kampalaDay())
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!db || !isManager) return
    setError('')
    return onSnapshot(
      query(collection(db, 'venues', venueId, 'dailySales'), orderBy('day', 'desc'), limit(30)),
      snap => setDays(snap.docs.map(d => parseDay(d.id, d.data()))),
      e => setError(`Cannot load daily sales: ${e.message}`),
    )
  }, [venueId, isManager])

  const methodNames = useMemo(() => Array.from(new Set(days.flatMap(d => Object.keys(d.byMethod)))).sort(), [days])
  const current = days.find(d => d.day === selected)
  const closed = current?.status === 'closed'
  const unpaid = orders.filter(o => o.dayKey === selected && o.paymentStatus === 'Unpaid' && o.status !== 'Cancelled')
  const unpaidValue = unpaid.reduce((sum, o) => sum + o.total, 0)
  const itemRows = Object.values(current?.items ?? {}).sort((a, b) => b.revenue - a.revenue)

  async function closeSelectedDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!auth || busy) return
    const amount = counted.trim() === '' ? null : Number(counted)
    if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) { setNotice('Enter the counted cash as a whole number of UGX, or leave it blank.'); return }
    const warning = unpaid.length ? `${unpaid.length} order(s) from this day are still unpaid and are not included. ` : ''
    if (!window.confirm(`Close sales for ${selected}? ${warning}A closed day cannot be changed.`)) return
    setBusy(true); setNotice('')
    try {
      const call = httpsCallable<Record<string, unknown>, { alreadyClosed?: boolean; cashDifference?: number | null }>(getFunctions(auth.app), 'closeDay')
      const result = await call({ venueId, day: selected, countedCash: amount, note })
      setNotice(result.data.alreadyClosed ? `${selected} was already closed.` : `${selected} closed.${typeof result.data.cashDifference === 'number' ? ` Cash difference: ${money(result.data.cashDifference)}.` : ''}`)
      setCounted(''); setNote('')
    } catch (e) { setNotice(errorText(e, 'Could not close the day.')) }
    finally { setBusy(false) }
  }

  function exportDays() {
    const header = ['Day', 'Status', 'Paid orders', 'Total UGX', 'Subtotal UGX', 'Tax UGX', 'Service UGX', ...methodNames.map(m => `${m} UGX`), 'Counted cash UGX', 'Cash difference UGX']
    const rows = days.map(d => [d.day, d.status, d.orderCount, d.total, d.subtotal, d.taxAmount, d.serviceAmount, ...methodNames.map(m => d.byMethod[m] ?? 0), d.countedCash ?? '', d.cashDifference ?? ''])
    const url = URL.createObjectURL(new Blob(['\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'br-daily-sales.csv'; link.click(); URL.revokeObjectURL(url)
  }

  if (!isManager) return null
  return <article className="panel">
    <div className="panel-head page-toolbar">
      <div><h3>Daily sales</h3><p>Paid orders by the day the payment was recorded (Kampala time). Payments are entered by staff, not verified with mobile money.</p></div>
      <button type="button" className="action" onClick={exportDays} disabled={!days.length}>Export daily CSV</button>
    </div>
    {error && <p role="alert" className="page-notice">{error}</p>}
    {notice && <p role="status" className="page-notice">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss notification">×</button></p>}
    <div className="table-scroll">
      <table className="data-table">
        <thead><tr><th>Day</th><th>Status</th><th>Paid orders</th><th>Total</th>{methodNames.map(m => <th key={m}>{m}</th>)}</tr></thead>
        <tbody>{days.map(d => <tr key={d.day} onClick={() => setSelected(d.day)} aria-selected={d.day === selected} style={{ cursor: 'pointer', fontWeight: d.day === selected ? 700 : undefined }}>
          <td>{d.day}</td><td><span className={`badge ${d.status === 'closed' ? 'ready' : 'preparing'}`}>{d.status === 'closed' ? 'Closed' : 'Open'}</span></td>
          <td>{d.orderCount}</td><td>{money(d.total)}</td>{methodNames.map(m => <td key={m}>{money(d.byMethod[m] ?? 0)}</td>)}
        </tr>)}</tbody>
      </table>
      {!days.length && <p className="empty">No payments recorded yet. Open an order and choose Take payment.</p>}
    </div>

    <h3>Day detail</h3>
    <label className="field"><span>Day</span><input type="date" value={selected} max={kampalaDay()} onChange={e => e.target.value && setSelected(e.target.value)} /></label>
    {current ? <>
      <div className="report-summary">
        <article className="panel"><p>Total taken</p><h2>{money(current.total)}</h2></article>
        <article className="panel"><p>Paid orders</p><h2>{current.orderCount}</h2></article>
        <article className="panel"><p>Tax · Service</p><h2>{money(current.taxAmount)} · {money(current.serviceAmount)}</h2></article>
      </div>
      {itemRows.length > 0 && <div>{itemRows.map(row => <div className="report-row" key={row.name}><b>{row.name}</b><span>{row.qty} units</span><strong>{money(row.revenue)}</strong></div>)}</div>}
      {closed && <p className="demo-note">Closed{current.closedByEmail ? ` by ${current.closedByEmail}` : ''}. Expected cash {money(current.expectedCash ?? 0)}{current.countedCash !== null ? ` · counted ${money(current.countedCash)} · difference ${money(current.cashDifference ?? 0)}` : ' · cash not counted'}.{current.unpaidCount ? ` ${current.unpaidCount} order(s) were unpaid at close (${money(current.unpaidValue)}).` : ''}{current.note ? ` Note: ${current.note}` : ''}</p>}
    </> : <p className="empty">No payments were recorded on {selected}.</p>}

    {!closed && <form className="settings-form" onSubmit={e => void closeSelectedDay(e)}>
      <h3>Close {selected}</h3>
      {unpaid.length > 0 && <p className="page-notice" role="status">{unpaid.length} unpaid order(s) from this day · {money(unpaidValue)}. Take payment before closing, or they will be left out.</p>}
      <label className="field"><span>Cash counted in the till (UGX, optional)</span><input type="number" min="0" step="1" inputMode="numeric" value={counted} disabled={busy} onChange={e => setCounted(e.target.value)} /></label>
      <label className="field"><span>Note (optional)</span><textarea maxLength={300} value={note} disabled={busy} onChange={e => setNote(e.target.value)} /></label>
      <button className="action primary" type="submit" disabled={busy}>{busy ? 'Closing…' : 'Close day'}</button>
    </form>}
  </article>
}
