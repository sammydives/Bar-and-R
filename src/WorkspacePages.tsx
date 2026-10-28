import type { Workspace } from './lib/VenueGate'
import { VenueMembers } from './lib/VenueMembers'
import { useState, useEffect, type ReactNode, type FormEvent } from 'react'
import type { VenueSettings } from './lib/useVenueSettings'
import { useCloudCollection } from './lib/useCollection'
import { doc, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { auth } from './lib/firebase'
import { db } from './lib/firebase'

const money = (n: number) => `UGX ${n.toLocaleString('en-UG')}`
const withinRange = (date: string | undefined, range: string) => {
  if (!date) return false // Legacy orders have no verified sale date.
  const timestamp = Date.parse(date)
  if (!Number.isFinite(timestamp)) return false
  const days = range === 'Today' ? 1 : range === '7 days' ? 7 : 30
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return timestamp >= start.getTime() && timestamp <= Date.now()
}
const csvCell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`

const initialMenu = [
  {id:1,name:'Grilled tilapia',category:'Mains',price:35000,route:'Kitchen',available:true},
  {id:2,name:'Beef fillet',category:'Mains',price:42000,route:'Kitchen',available:true},
  {id:3,name:'Avocado salad',category:'Starters',price:18000,route:'Kitchen',available:true},
  {id:4,name:'Nile Special',category:'Drinks',price:7000,route:'Bar',available:true},
  {id:5,name:'Passion fruit juice',category:'Drinks',price:8000,route:'Bar',available:true},
]
type StockItem = {name:string; qty:number; unit:string; min:number; category?:string; cost?:number}
type RecipePart = {inventoryId:string;quantity:number}
type MenuItem = {id:number;name:string;category:string;price:number;route:string;available:boolean;recipe?:RecipePart[]}
type OrderLine = {id:number;name:string;price:number;route:string;qty:number}
type Order = {id:number|string;table:string;staff:string;status:string;total:number;items:string;createdAt?:string;lineItems?:OrderLine[];preparation?:{Kitchen?:string;Bar?:string}}
const initialOrders: Order[] = [
  {id:1042,table:'12',staff:'Sarah K.',status:'Preparing',total:128000,items:'2 × Grilled tilapia, 2 × Nile Special, 1 × Beef fillet'},
  {id:1041,table:'04',staff:'Daniel M.',status:'Ready',total:76500,items:'1 × Beef fillet, 2 × Passion fruit juice'},
  {id:1040,table:'19',staff:'Grace A.',status:'New',total:214000,items:'4 × Grilled tilapia, 4 × Avocado salad'},
]
function Action({children,onClick,primary=false,disabled=false}:{children:ReactNode,onClick?:()=>void,primary?:boolean,disabled?:boolean}) {
  return <button className={`action ${primary?'primary':''}`} onClick={onClick} disabled={disabled}>{children}</button>
}
function Field({label,children}:{label:string,children:ReactNode}) { return <label className="field"><span>{label}</span>{children}</label> }
function FormSheet({title,children,close}:{title:string,children:ReactNode,close:()=>void}) {
  return <div className="modal-backdrop" onClick={close}><section className="form-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><div className="page-toolbar"><h2>{title}</h2><Action onClick={close}>Close</Action></div>{children}</section></div>
}
export default function WorkspacePages({active,uid,workspace,settings,saveSettings,settingsLoading,settingsError}:{active:string,uid:string|null,workspace:Workspace,settings:VenueSettings,saveSettings:(value:VenueSettings)=>Promise<void>,settingsLoading:boolean,settingsError:string}) {
  const isManager = workspace.role === 'manager'
  const canOrder = isManager || workspace.role === 'waiter'
  const [orders,setOrders,ordersError]=useCloudCollection(uid,'orders',initialOrders,x=>String(x.id))
  const [menu,setMenu,menuError]=useCloudCollection<MenuItem>(uid,'menu',initialMenu,x=>String(x.id))
  const [stock,setStock,stockError]=useCloudCollection<StockItem>(uid,'inventory',[{name:'Nile Special',qty:12,unit:'bottles',min:24},{name:'Beef fillet',qty:3.2,unit:'kg',min:5},{name:'Avocado',qty:8,unit:'pcs',min:15},{name:'Passion fruit',qty:4,unit:'kg',min:8},{name:'Tilapia',qty:30,unit:'pcs',min:10}],x=>x.name)
  const [staff,setStaff,staffError]=useCloudCollection(uid,'staff',[{name:'Sarah K.',role:'Waiter',language:'English',enabled:true},{name:'Daniel M.',role:'Waiter',language:'Luganda',enabled:true},{name:'Grace A.',role:'Manager',language:'English',enabled:true},{name:'Isaac O.',role:'Kitchen',language:'Swahili',enabled:true}],x=>x.name)
  const updatePreparation = async (order:Order, route:'Kitchen'|'Bar', next:'Preparing'|'Ready') => {
    if (!uid || !db || !uid.startsWith('venue:')) { notify('A shared restaurant workspace is required for preparation updates.'); return }
    if (!(isManager || workspace.role.toLowerCase() === route.toLowerCase())) { notify('Your role cannot update this station.'); return }
    try {
      await updateDoc(doc(db, 'venues', uid.slice(6), 'orders', String(order.id)), { [`preparation.${route}`]: next })
      notify(`${route} ticket for table ${order.table} updated.`)
    } catch (error) { notify(`Could not update ticket: ${error instanceof Error ? error.message : 'Unknown error'}`) }
  }
  const [search,setSearch]=useState('')
  const [filter,setFilter]=useState('All')
  const [modal,setModal]=useState('')
  const [editing,setEditing]=useState<number|null>(null)
  const [notice,setNotice]=useState('')
  const [reportRange,setReportRange]=useState('Today')
  const [cart,setCart]=useState<number[]>([])
  const [sending,setSending]=useState(false)
  const [pendingRequestId,setPendingRequestId]=useState<string|null>(null)
  const [table,setTable]=useState('01')
  const [settingsTab,setSettingsTab]=useState('Branding')
  const [draftSettings,setDraftSettings]=useState<VenueSettings>(settings)
  const [settingsBusy,setSettingsBusy]=useState(false)
  const [settingsNotice,setSettingsNotice]=useState('')
  useEffect(()=>{setDraftSettings(settings)},[settings])
  const tax=settings.taxRate
  const service=settings.serviceCharge
  const saveCurrentSettings=async (event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(!isManager || settingsBusy || settingsLoading)return
    const next={...draftSettings,venueName:draftSettings.venueName.trim(),receiptFooter:draftSettings.receiptFooter.trim()}
    if(!next.venueName || next.venueName.length>100 || !/^#[\da-f]{6}$/i.test(next.primaryColor) || ![next.taxRate,next.serviceCharge].every(v=>Number.isFinite(v)&&v>=0&&v<=100)){
      setSettingsNotice('Enter a venue name, valid color and rates between 0 and 100.');return
    }
    if(next.paymentMethods.length===0){setSettingsNotice('Select at least one payment method.');return}
    setSettingsBusy(true);setSettingsNotice('')
    try{await saveSettings(next);setSettingsNotice('Settings saved to Firestore.')}
    catch(e){setSettingsNotice(`Could not save settings: ${e instanceof Error?e.message:'Unknown error'}`)}
    finally{setSettingsBusy(false)}
  }
  const notify=(text:string)=>setNotice(text)
  const submit=(e:FormEvent<HTMLFormElement>,fn:(d:FormData)=>void)=>{e.preventDefault();fn(new FormData(e.currentTarget));setModal('')}
  const sendStockOrder = async () => {
    if (!uid?.startsWith('venue:') || !auth?.currentUser || !db) { notify('Choose a shared restaurant workspace first.'); return }
    if (!cart.length || sending) return
    const selected = menu.filter(item => cart.includes(item.id))
    if (selected.some(item => !item.recipe?.length)) { notify('Configure stock ingredients for every ordered menu item before sending.'); return }
    const requestId = pendingRequestId ?? crypto.randomUUID()
    setPendingRequestId(requestId)
    setSending(true)
    try {
      const callable = httpsCallable(getFunctions(auth.app), 'placeStockOrder')
      await callable({ venueId: uid.slice(6), requestId, table, items: selected.map(item => ({ id: item.id, qty: cart.filter(id => id === item.id).length })), tax, service })
      setCart([])
      setPendingRequestId(null)
      notify(`Order placed for table ${table}; stock deducted.`)
    } catch (error) { notify(`Order not submitted: ${error instanceof Error ? error.message : 'Unknown error'}. Do not change the cart before retrying.`) }
    finally { setSending(false) }
  }
  const shownMenu=menu.filter(x=>x.name.toLowerCase().includes(search.toLowerCase())&&(filter==='All'||!['Mains','Starters','Drinks'].includes(filter)||x.category===filter))
  const scopedOrders = orders.filter(o => withinRange(o.createdAt, reportRange) && o.status !== 'Cancelled')
  const scopedRevenue = scopedOrders.reduce((sum,o)=>sum+o.total,0)
  const productSales = menu.map(item => {
    const qty = scopedOrders.reduce((sum,order)=>sum+(order.lineItems ?? []).filter(line=>line.id===item.id).reduce((n,line)=>n+line.qty,0),0)
    return {id:item.id,name:item.name,qty,revenue:scopedOrders.reduce((sum,order)=>sum+(order.lineItems ?? []).filter(line=>line.id===item.id).reduce((n,line)=>n+line.qty*line.price,0),0)}
  }).filter(x=>x.qty>0).sort((a,b)=>b.qty-a.qty)
  const exportReport=()=>{
    const rows=[['Order ID','Created at','Table','Status','Items','Total UGX'],...scopedOrders.map(o=>[o.id,o.createdAt ?? '',o.table,o.status,o.items,o.total])]
    const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}))
    const link=document.createElement('a');link.href=url;link.download=`br-orders-${reportRange.toLowerCase().replace(/ /g,'-')}.csv`;link.click();URL.revokeObjectURL(url);notify('Recorded orders exported. This is not a reconciled payment report.')
  }
  if(active==='Overview')return null
  return <section className="workspace-page">
    <div className="page-toolbar"><div><h2>{active==='POS'?'Take an order':active}</h2><p>{({Orders:'Track every ticket from kitchen to table.',Menu:'Create and manage your venue’s menu.',Inventory:'Keep your kitchen and bar well stocked.',Reports:'Understand your venue’s performance.','Staff & roles':'Manage your team and their access.',Settings:'Make B&R work for your venue.',POS:'Select items, choose a table, and send to the team.'} as Record<string,string>)[active]}</p></div>
    {active==='Inventory'&&isManager&&<Action primary onClick={()=>{setEditing(null);setModal('Inventory item')}}>+ Add inventory item</Action>}
    {active==='Menu'&&isManager&&<Action primary onClick={()=>{setEditing(null);setModal('Menu item')}}>+ Add item</Action>}
    {active==='Staff & roles'&&isManager&&<Action primary onClick={()=>setModal('Add staff')}>+ Add staff</Action>}
    {active==='Reports'&&<Action primary onClick={exportReport}>Export CSV</Action>}
    </div>
    <p className="demo-note">{uid ? 'Signed-in workspace · Records are saved to Firestore. Sales and payment charts are previews; reports use recorded orders, not settled payments.' : 'Firebase is not connected · Preview data only.'}</p>
    {(ordersError||menuError||stockError||staffError)&&<div role="alert" className="page-notice">{ordersError||menuError||stockError||staffError}</div>}
    {notice&&<div className="page-notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss notification">×</button></div>}
    {['Orders','Menu','Inventory'].includes(active)&&<div className="page-toolbar controls"><input aria-label={`Search ${active}`} placeholder={`Search ${active.toLowerCase()}…`} value={search} onChange={e=>setSearch(e.target.value)}/><div className="range">{(active==='Orders'?['All','New','Preparing','Ready','Served']:active==='Menu'?['All','Mains','Starters','Drinks']:['All','Low stock']).map(x=><button className={filter===x?'selected':''} key={x} onClick={()=>setFilter(x)}>{x}</button>)}</div></div>}
    {active==='Orders'&&<><p className="demo-note">Kitchen and Bar tickets are updated independently. Older orders without routed line items remain visible to managers and waiters only.</p><div className="page-cards">{orders.filter(x => (filter==='All'||!['New','Preparing','Ready','Served'].includes(filter)||x.status===filter) && `${x.id} ${x.table} ${x.staff}`.toLowerCase().includes(search.toLowerCase()) && (isManager || workspace.role==='waiter' || (x.lineItems??[]).some(line=>line.route.toLowerCase()===workspace.role))).map(x => <article className="panel ticket" key={x.id}><div className="page-toolbar"><h3>Table {x.table}</h3><span className={`badge ${x.status.toLowerCase()}`}>{x.status}</span></div><p>#{x.id} · {x.staff}</p>{(['Kitchen','Bar'] as const).filter(route=>(isManager||workspace.role==='waiter'||workspace.role.toLowerCase()===route.toLowerCase()) && (x.lineItems??[]).some(line=>line.route===route)).map(route=>{const items=(x.lineItems??[]).filter(line=>line.route===route); const status=x.preparation?.[route]??'New'; return <div key={route} className="station-ticket"><p><b>{route}</b> · {status}</p><p className="ticket-items">{items.map(line=>`${line.qty} × ${line.name}`).join(', ')}</p>{(isManager||workspace.role.toLowerCase()===route.toLowerCase())&&status!=='Ready'&&<Action onClick={()=>void updatePreparation(x,route,status==='New'?'Preparing':'Ready')}>Mark {route} {status==='New'?'Preparing':'Ready'}</Action>}</div>})}{!x.lineItems?.length&&<p className="ticket-items">{x.items} (legacy order)</p>}{(isManager||workspace.role==='waiter')&&<><strong>{money(x.total)}</strong><Action disabled={x.status==='Served'||x.status==='Cancelled'||!x.lineItems?.length||(['Kitchen','Bar'] as const).some(route=>(x.lineItems??[]).some(line=>line.route===route)&&(x.preparation?.[route]??'New')!=='Ready')} onClick={()=>{if(!uid||!db||!uid.startsWith('venue:')){notify('A shared venue is required.');return}void updateDoc(doc(db,'venues',uid.slice(6),'orders',String(x.id)),{status:'Served'}).then(()=>notify('Order marked served.')).catch(err=>notify(`Could not mark served: ${err.message}`))}}>{x.status==='Served'?'Completed':'Mark Served (after all stations ready)'}</Action></>}</article>)}{!orders.length&&<p className="empty">No orders yet.</p>}</div></>}
    {active==='Menu'&&<div className="page-cards">{shownMenu.map(x=><article className="panel menu-card" key={x.id}><div className="menu-symbol">{x.name.slice(0,2).toUpperCase()}</div><span className="eyebrow">{x.category} · {x.route} · {x.recipe?.length ? `${x.recipe.length} stock mapping(s)` : 'Stock mapping required'}</span><h3>{x.name}</h3><strong>{money(x.price)}</strong><div className="card-actions">{isManager&&<Action onClick={()=>{setEditing(x.id);setModal('Menu item')}}>Edit item</Action>}{isManager&&<Action onClick={()=>setMenu(menu.map(m=>m.id===x.id?{...m,available:!m.available}:m))}>{x.available?'Available':'Unavailable'}</Action>}{isManager&&<Action onClick={()=>{if(window.confirm(`Delete ${x.name} from the menu? Existing orders will be preserved.`)) setMenu(current=>current.filter(m=>m.id!==x.id))}}>Delete</Action>}</div></article>)}{!shownMenu.length&&<p className="empty">No matching menu items. Try another search or add an item.</p>}</div>}
    {active==='Inventory'&&<div className="panel table-scroll"><table className="data-table"><thead><tr><th>Stock item</th><th>On hand</th><th>Reorder level</th><th>Status</th><th>Action</th></tr></thead><tbody>{stock.filter(x=>x.name.toLowerCase().includes(search.toLowerCase())&&(filter!=='Low stock'||x.qty<x.min)).map((x)=><tr key={x.name}><td><b>{x.name}</b></td><td>{x.qty} {x.unit}</td><td>{x.min} {x.unit}</td><td><span className={`badge ${x.qty<x.min?'preparing':'ready'}`}>{x.qty<x.min?'Low stock':'In stock'}</span></td><td><div className="card-actions"><Action onClick={()=>{setEditing(stock.indexOf(x));setModal('Restock')}}>Stock in</Action><Action onClick={()=>{setEditing(stock.indexOf(x));setModal('Inventory item')}}>Edit</Action>{isManager&&<Action disabled={x.qty!==0} onClick={()=>{if(window.confirm(`Remove ${x.name} from inventory? This cannot be undone.`)) setStock(current=>current.filter(item=>item.name!==x.name))}}>Delete</Action>}</div></td></tr>)}</tbody></table>{stock.length===0&&<p className="empty">No inventory items yet. Select “Add inventory item” to create your first item.</p>}</div>}
    {active==='Reports'&&<><div className="range report-range">{['Today','7 days','30 days'].map(x=><button key={x} className={reportRange===x?'selected':''} onClick={()=>setReportRange(x)}>{x}</button>)}</div><div className="report-summary"><article className="panel"><p>Order value · {reportRange}</p><h2>{money(scopedRevenue)}</h2></article><article className="panel"><p>Recorded orders</p><h2>{scopedOrders.length}</h2></article><article className="panel"><p>Average order</p><h2>{money(scopedOrders.length?Math.round(scopedRevenue/scopedOrders.length):0)}</h2></article></div><article className="panel"><div className="panel-head"><h3>Items ordered</h3><p>{reportRange} · Firestore order records</p></div>{productSales.length?productSales.map((x,i)=><div className="report-row" key={x.id}><span>{i+1}</span><b>{x.name}</b><span>{x.qty} units</span><strong>{money(x.revenue)}</strong></div>):<p className="empty">No dated orders with item details in this period.</p>}<p className="demo-note">Order values are not verified payments. Older orders without a creation date are not included.</p></article></>}
    {active==='Staff & roles'&&<><VenueMembers workspace={workspace}/><div className="panel table-scroll"><table className="data-table"><thead><tr><th>Team member</th><th>Role</th><th>Language</th><th>Access</th></tr></thead><tbody>{staff.map((x,i)=><tr key={i}><td><b>{x.name}</b></td><td><select aria-label={`Role for ${x.name}`} value={x.role} onChange={e=>setStaff(staff.map((s,j)=>i===j?{...s,role:e.target.value}:s))}>{['Waiter','Manager','Kitchen','Bar'].map(r=><option key={r}>{r}</option>)}</select></td><td><select aria-label={`Language for ${x.name}`} value={x.language} onChange={e=>setStaff(staff.map((s,j)=>i===j?{...s,language:e.target.value}:s))}>{['English','Luganda','Swahili'].map(r=><option key={r}>{r}</option>)}</select></td><td><Action onClick={()=>setStaff(staff.map((s,j)=>i===j?{...s,enabled:!s.enabled}:s))}>{x.enabled?'Active — suspend':'Suspended — activate'}</Action></td></tr>)}</tbody></table><p className="demo-note">Staff entries are directory records only; these role fields do not grant Firebase access. Firebase access is managed separately above.</p></div></>}
    {active==='Settings'&&<>
      <div className="range report-range">{['Branding','Tax & service','Payments'].map(x=><button key={x} className={settingsTab===x?'selected':''} onClick={()=>setSettingsTab(x)}>{x}</button>)}</div>
      <form className="panel settings-form" onSubmit={e=>void saveCurrentSettings(e)}>
        {settingsError&&<p className="page-notice" role="alert">{settingsError}</p>}
        {settingsNotice&&<p className="page-notice" role="status">{settingsNotice}</p>}
        {settingsLoading&&<p>Loading saved settings…</p>}
        {settingsTab==='Branding'&&<>
          <h3>Branding & venue</h3>
          <Field label="Venue name"><input required maxLength={100} disabled={!isManager||settingsLoading} value={draftSettings.venueName} onChange={e=>setDraftSettings(prev=>({...prev,venueName:e.target.value}))}/></Field>
          <Field label="Primary color"><input type="color" disabled={!isManager||settingsLoading} value={draftSettings.primaryColor} onChange={e=>setDraftSettings(prev=>({...prev,primaryColor:e.target.value}))}/></Field>
          <Field label="Receipt footer"><textarea maxLength={500} disabled={!isManager||settingsLoading} value={draftSettings.receiptFooter} onChange={e=>setDraftSettings(prev=>({...prev,receiptFooter:e.target.value}))}/></Field>
          <p>Preview: <b>{draftSettings.venueName}</b></p>
        </>}
        {settingsTab==='Tax & service'&&<>
          <h3>Tax & service charge</h3>
          <Field label="Tax rate (%)"><input type="number" min="0" max="100" step="0.01" required disabled={!isManager||settingsLoading} value={draftSettings.taxRate} onChange={e=>setDraftSettings(prev=>({...prev,taxRate:Number(e.target.value)}))}/></Field>
          <Field label="Service charge (%)"><input type="number" min="0" max="100" step="0.01" required disabled={!isManager||settingsLoading} value={draftSettings.serviceCharge} onChange={e=>setDraftSettings(prev=>({...prev,serviceCharge:Number(e.target.value)}))}/></Field>
          <p>Saved rates appear in POS. Tax calculation is not a verified fiscal invoice.</p>
        </>}
        {settingsTab==='Payments'&&<>
          <h3>Accepted payment methods</h3>
          {['Cash','Card','MTN Mobile Money','Airtel Money'].map(x=><label className="check-field" key={x}><input type="checkbox" disabled={!isManager||settingsLoading} checked={draftSettings.paymentMethods.includes(x)} onChange={()=>setDraftSettings(prev=>({...prev,paymentMethods:prev.paymentMethods.includes(x)?prev.paymentMethods.filter(p=>p!==x):[...prev.paymentMethods,x]}))}/>{x}</label>)}
          <p>Accepted methods are saved. Payment processing is not implemented.</p>
        </>}
        <button type="submit" className="action primary" disabled={!isManager||settingsBusy||settingsLoading}>{settingsBusy?'Saving…':'Save settings'}</button>
      </form>
    </>}
    {active==='POS'&&<div className="pos-layout"><div className="page-cards">{menu.filter(x=>x.available).map(x=><article className="panel menu-card" key={x.id}><span className="eyebrow">{x.category}</span><h3>{x.name}</h3><strong>{money(x.price)}</strong><Action disabled={sending} onClick={()=>{setPendingRequestId(null);setCart([...cart,x.id])}}>Add to order</Action></article>)}</div><article className="panel cart"><h3>Current order</h3><Field label="Table"><select value={table} disabled={sending} onChange={e=>{setPendingRequestId(null);setTable(e.target.value)}}>{Array.from({length:32},(_,i)=>String(i+1).padStart(2,'0')).map(x=><option key={x}>{x}</option>)}</select></Field>{!cart.length&&<p>Add an item to get started.</p>}{cart.map((id,i)=>{const x=menu.find(m=>m.id===id)!;return <div className="cart-line" key={i}><span>{x.name}<small>{money(x.price)}</small></span><Action disabled={sending} onClick={()=>{setPendingRequestId(null);setCart(cart.filter((_,j)=>j!==i))}}>Remove</Action></div>})}<p>Subtotal <b>{money(cart.reduce((a,id)=>a+menu.find(m=>m.id===id)!.price,0))}</b></p><p>Tax {tax}% · Service {service}%</p><h3>{money(Math.round(cart.reduce((a,id)=>a+menu.find(m=>m.id===id)!.price,0)*(1+(tax+service)/100)))}</h3><Action primary disabled={!cart.length || !canOrder || sending || !uid?.startsWith('venue:')} onClick={()=>void sendStockOrder()}>{sending?'Sending…':'Send order & deduct stock'}</Action></article></div>}
    {modal&&<FormSheet title={modal} close={()=>setModal('')}>{modal==='Menu item'&&<form onSubmit={e=>submit(e,d=>{const rawRecipe=String(d.get('recipe')??'').trim();const recipe:RecipePart[]=[];for(const row of rawRecipe.split('\n').map(v=>v.trim()).filter(Boolean)){const divider=row.lastIndexOf('|');const inventoryId=row.slice(0,divider).trim();const quantity=Number(row.slice(divider+1).trim());if(divider<1||!stock.some(v=>v.name===inventoryId)||!Number.isFinite(quantity)||quantity<=0||recipe.some(v=>v.inventoryId===inventoryId)){notify(`Invalid stock mapping: ${row}. Use 'Exact inventory name | quantity'.`);return}recipe.push({inventoryId,quantity})}const item:MenuItem={id:editing??Date.now(),name:String(d.get('name')).trim(),price:Number(d.get('price')),category:String(d.get('category')),route:String(d.get('route')),available:editing?menu.find(m=>m.id===editing)!.available:true,recipe};setMenu(editing?menu.map(m=>m.id===editing?item:m):[...menu,item]);notify('Menu item saved.')})}><Field label="Item name"><input name="name" required pattern=".*\S.*" defaultValue={menu.find(m=>m.id===editing)?.name}/></Field><Field label="Price (UGX)"><input name="price" type="number" min="1" step="1" required defaultValue={menu.find(m=>m.id===editing)?.price}/></Field><Field label="Category"><select name="category" defaultValue={menu.find(m=>m.id===editing)?.category}>{['Mains','Starters','Drinks'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Destination"><select name="route" defaultValue={menu.find(m=>m.id===editing)?.route}><option>Kitchen</option><option>Bar</option></select></Field><Field label="Stock required per menu serving (one per line: Exact inventory name | quantity)"><textarea name="recipe" rows={4} placeholder={stock.map(x=>`${x.name} | 1`).slice(0,2).join('\n')} defaultValue={menu.find(m=>m.id===editing)?.recipe?.map(part=>`${part.inventoryId} | ${part.quantity}`).join('\n')??''}/></Field><p className="demo-note">Example: Beef fillet | 0.25 for 0.25 kg per serving. Every POS item needs at least one mapping. Quantities use the inventory item's own unit.</p><button className="action primary" type="submit">Save item</button></form>}
    {modal==='Inventory item'&&<form key={`inventory-${editing ?? 'new'}`} onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);const name=String(d.get('name')??'').trim();const qty=Number(d.get('qty'));const min=Number(d.get('min'));const unit=String(d.get('unit')??'').trim();const category=String(d.get('category')??'Other');const rawCost=String(d.get('cost')??'').trim();const cost=rawCost===''?undefined:Number(rawCost);if(!name||!unit||![qty,min].every(v=>Number.isFinite(v)&&v>=0)||(cost!==undefined&&(!Number.isFinite(cost)||cost<0))){notify('Enter a valid name, unit and non-negative quantities.');return}if(stock.some((x,i)=>i!==editing&&x.name.toLocaleLowerCase()===name.toLocaleLowerCase())){notify('An inventory item with this name already exists. Choose another name.');return}const item:StockItem={name,qty,min,unit,category,...(cost===undefined?{}:{cost})};setStock(current=>editing===null?[...current,item]:current.map((x,i)=>i===editing?item:x));notify(editing===null?'Inventory item added.':'Inventory item updated.');setModal('')}}><Field label="Item name"><input name="name" required maxLength={100} defaultValue={editing===null?'':stock[editing ?? -1]?.name} autoFocus/></Field><Field label="Category"><select name="category" defaultValue={editing===null?'Beverages':stock[editing ?? -1]?.category??'Other'}>{['Beverages','Food ingredients','Bar stock','Supplies','Other'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Unit of measure"><select name="unit" defaultValue={editing===null?'bottles':stock[editing ?? -1]?.unit??'pcs'}>{Array.from(new Set(['bottles','pcs','kg','litres','cartons','packs',...(stock[editing ?? -1]?.unit?[stock[editing ?? -1].unit]:[])])).map(x=><option key={x} value={x}>{x}</option>)}</select></Field><Field label="Quantity on hand"><input name="qty" type="number" required min="0" step="any" defaultValue={editing===null?0:stock[editing ?? -1]?.qty}/></Field><Field label="Reorder level"><input name="min" type="number" required min="0" step="any" defaultValue={editing===null?10:stock[editing ?? -1]?.min}/></Field><Field label="Unit cost (UGX, optional)"><input name="cost" type="number" min="0" step="any" defaultValue={editing===null?'':stock[editing ?? -1]?.cost??''}/></Field><button className="action primary" type="submit">{editing===null?'Save inventory item':'Save changes'}</button></form>}
    {modal==='Restock'&&editing!==null&&<form onSubmit={e=>submit(e,d=>{setStock(stock.map((x,i)=>i===editing?{...x,qty:Math.round((x.qty+Number(d.get('qty')))*100)/100}:x));notify('Stock quantity updated.')})}><p>{stock[editing].name} · {stock[editing].qty} {stock[editing].unit} on hand</p><Field label={`Quantity to add (${stock[editing].unit})`}><input name="qty" type="number" min=".01" step=".01" required autoFocus/></Field><button className="action primary" type="submit">Confirm stock in</button></form>}
    {modal==='Add staff'&&<form onSubmit={e=>submit(e,d=>{setStaff([...staff,{name:String(d.get('name')).trim(),role:String(d.get('role')),language:'English',enabled:true}]);notify('Staff record saved.')})}><Field label="Full name"><input name="name" required pattern=".*\S.*" autoFocus/></Field><Field label="Role"><select name="role">{['Waiter','Manager','Kitchen','Bar'].map(x=><option key={x}>{x}</option>)}</select></Field><button className="action primary" type="submit">Add team member</button></form>}</FormSheet>}
  </section>
}
