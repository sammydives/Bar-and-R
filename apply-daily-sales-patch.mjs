// Run from the repository root:  node apply-daily-sales-patch.mjs
// Edits src/App.tsx and src/WorkspacePages.tsx. Every anchor must match exactly once;
// if any anchor is missing or ambiguous, NOTHING is written.
import { readFileSync, writeFileSync } from 'node:fs'

const BT = '`'
const DS = '$'

const edits = {
  'src/WorkspacePages.tsx': [
    // 1. import the new components
    ["import { db } from './lib/firebase'",
     "import { db } from './lib/firebase'\nimport { PaymentSheet, DailySalesPanel } from './DailySales'"],
    // 2. order type gets the payment fields
    ["lineItems?:OrderLine[];preparation?:{Kitchen?:string;Bar?:string}}",
     "lineItems?:OrderLine[];preparation?:{Kitchen?:string;Bar?:string};dayKey?:string;paymentStatus?:string;payment?:{method?:string;reference?:string}}"],
    // 3. state for the order being paid
    ["const [table,setTable]=useState('01')",
     "const [table,setTable]=useState('01')\n  const [payOrder,setPayOrder]=useState<Order|null>(null)"],
    // 4. payment status + Take payment button on each ticket
    ["<strong>{money(x.total)}</strong><Action disabled={x.status==='Served'",
     "<strong>{money(x.total)}</strong><p className=\"ticket-items\">{x.paymentStatus==='Paid'?'Paid · '+(x.payment?.method??'')+(x.payment?.reference?' · '+x.payment.reference:''):x.paymentStatus==='Unpaid'?'Unpaid':'Legacy order · no payment record'}</p>{x.paymentStatus==='Unpaid'&&x.status!=='Cancelled'&&<Action primary onClick={()=>setPayOrder(x)}>Take payment</Action>}<Action disabled={x.status==='Served'"],
    // 5. render the payment sheet
    ["{modal&&<FormSheet title={modal} close={()=>setModal('')}>",
     "{payOrder&&uid?.startsWith('venue:')&&<PaymentSheet order={payOrder} venueId={uid.slice(6)} methods={settings.paymentMethods} onClose={()=>setPayOrder(null)} onDone={text=>{setPayOrder(null);notify(text)}}/>}\n    {modal&&<FormSheet title={modal} close={()=>setModal('')}>"],
    // 6. daily sales panel under Reports
    ["Older orders without a creation date are not included.</p></article></>}",
     "Older orders without a creation date are not included.</p></article>{uid?.startsWith('venue:')&&<DailySalesPanel venueId={uid.slice(6)} isManager={isManager} orders={orders}/>}</>}"],
    // 7. tax and service now come from the server, not the browser
    [".length })), tax, service })",
     ".length })) })"],
  ],
  'src/App.tsx': [
    // 1. order type gets payment fields
    ["[] as {id:number;status:string;total:number;table:string;staff:string;items:string;createdAt?:string}[]",
     "[] as {id:number|string;status:string;total:number;table:string;staff:string;items:string;createdAt?:string;paymentStatus?:string;payment?:{atIso?:string}}[]"],
    // 2. paid-sales figures
    ["const lowStock = stock.filter(item => item.qty < item.min)",
     "const paidSales = orders.filter(order=>order.paymentStatus==='Paid'&&isWithin(order.payment?.atIso,range)).reduce((sum, order) => sum + order.total, 0)\n  const unpaidCount = periodOrders.filter(order=>order.paymentStatus==='Unpaid').length\n  const lowStock = stock.filter(item => item.qty < item.min)"],
    // 3. Revenue card shows paid sales
    ['<Stat label="Revenue" value={' + BT + 'UGX ' + DS + "{totalSales.toLocaleString('en-UG')}" + BT + '} note="Recorded order value (not paid revenue)" />',
     "<Stat label=\"Revenue\" value={'UGX '+paidSales.toLocaleString('en-UG')} note={'Paid (recorded by staff) · '+unpaidCount+' unpaid · ordered UGX '+totalSales.toLocaleString('en-UG')} />"],
  ],
}

const results = {}
const problems = []
for (const [file, list] of Object.entries(edits)) {
  let text = readFileSync(file, 'utf8')
  if (text.includes('DailySalesPanel') || text.includes('paidSales')) { problems.push(`${file}: already patched`); continue }
  list.forEach(([find, replace], index) => {
    const count = text.split(find).length - 1
    if (count !== 1) { problems.push(`${file}: edit ${index + 1} matched ${count} times (expected 1): ${find.slice(0, 70)}…`); return }
    text = text.replace(find, () => replace)
  })
  results[file] = text
}
if (problems.length) {
  console.error('Nothing was written.\n' + problems.map(p => ' - ' + p).join('\n'))
  process.exit(1)
}
for (const [file, text] of Object.entries(results)) { writeFileSync(file, text); console.log('patched', file) }
