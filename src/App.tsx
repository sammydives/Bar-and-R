import type { Workspace } from './lib/VenueGate'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { updateProfile, signOut, type User } from 'firebase/auth'
import { auth } from './lib/firebase'
import WorkspacePages from './WorkspacePages'
import { useCloudCollection } from './lib/useCollection'

const Icon = ({ name }: { name: string }) => {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    orders: <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h10"/></>,
    stock: <><path d="m4 7 8-4 8 4-8 4z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/></>,
    report: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    users: <><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M16 4c3 0 5 2 5 5s-2 5-5 5"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.7-1.7.9-2-2.2-2.2-2 .9-1.7-.7-.7-2h-3l-.7 2-1.7.7-2-.9L1 6.1l.9 2-.7 1.7-2 .7v3l2 .7.7 1.7-.9 2 2.2 2.2 2-.9 1.7.7.7 2h3l.7-2 1.7-.7 2 .9 2.2-2.2-.9-2 .7-1.7z"/></>,
    arrow: <path d="m9 18 6-6-6-6"/>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    trend: <><path d="m3 17 6-6 4 4 8-9"/><path d="M15 6h6v6"/></>,
  }
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

const isWithin = (value: string | undefined, range: string) => {
  if (!value) return false
  const time = Date.parse(value)
  const start = new Date()
  start.setHours(0,0,0,0)
  start.setDate(start.getDate()-(range==='Today'?0:range==='7 days'?6:29))
  return Number.isFinite(time) && time >= start.getTime() && time <= Date.now()
}
const nav = [
  ['grid','Overview'],['orders','Orders'],['menu','Menu'],['stock','Inventory'],
  ['report','Reports'],['users','Staff & roles'],['settings','Settings']
]

const Stat = ({ label, value, note, tone }: {label:string,value:string,note:string,tone?:string}) => (
  <article className="stat-card">
    <div className={`stat-mark ${tone || ''}`}><Icon name={label === 'Revenue' ? 'trend' : label === 'Open tables' ? 'grid' : label === 'Orders today' ? 'orders' : 'stock'} /></div>
    <div><p className="eyebrow">{label}</p><strong>{value}</strong><p className={`note ${tone || ''}`}>{note}</p></div>
  </article>
)

export default function App({ uid, workspace, user }: { uid: string | null; workspace: Workspace; user: User }) {
  const [active, setActive] = useState('Overview')
  const [range, setRange] = useState('Today')
  const [venue, setVenue] = useState('My Venue')
  const [accountOpen, setAccountOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileName, setProfileName] = useState(user.displayName || '')
  const [visibleName, setVisibleName] = useState(user.displayName || '')
  const [profileError, setProfileError] = useState('')
  const [profileNotice, setProfileNotice] = useState('')
  const [profileBusy, setProfileBusy] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setVisibleName(user.displayName || ''); setProfileName(user.displayName || '') }, [user.uid, user.displayName])
  useEffect(() => {
    if (!accountOpen) return
    const close = (event: MouseEvent) => { if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAccountOpen(false); setEditingProfile(false) } }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [accountOpen])
  const accountName = visibleName.trim() || user.email?.split('@')[0] || 'Account'
  const initials = accountName.split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase() || '').join('')
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = profileName.trim().replace(/\s+/g,' ')
    if (name.length < 2 || name.length > 60) { setProfileError('Enter a name between 2 and 60 characters.'); return }
    setProfileError(''); setProfileNotice(''); setProfileBusy(true)
    try { await updateProfile(user, { displayName: name }); setVisibleName(name); setProfileName(name); setEditingProfile(false); setProfileNotice('Your display name was saved.') }
    catch (err) { setProfileError(err instanceof Error ? err.message : 'Unable to update your name.') }
    finally { setProfileBusy(false) }
  }
  async function logout() {
    setProfileError('')
    try { if (auth) await signOut(auth) }
    catch (err) { setProfileError(err instanceof Error ? err.message : 'Could not sign out.') }
  }
  const accountMenu = <div className="account-menu" role="region" aria-label="Account options">
    <strong>{accountName}</strong>
    <span className="account-email">{user.email || 'No email available'}</span>
    <span className="account-role">Role: {workspace.role.charAt(0).toUpperCase()+workspace.role.slice(1)}</span>
    {editingProfile ? <form onSubmit={saveProfile} className="account-edit-form">
      <label htmlFor="profile-display-name">Display name</label>
      <input id="profile-display-name" maxLength={60} autoComplete="name" required value={profileName} onChange={e=>setProfileName(e.target.value)} />
      <div className="account-edit-actions"><button type="submit" disabled={profileBusy}>Save name</button><button type="button" onClick={()=>{setEditingProfile(false);setProfileError('')}}>Cancel</button></div>
    </form> : <button type="button" className="account-menu-action" onClick={()=>{setProfileName(visibleName);setEditingProfile(true);setProfileError('');setProfileNotice('')}}>Edit display name</button>}
    {profileError && <p className="account-error" role="alert">{profileError}</p>}
    {profileNotice && <p className="account-success" role="status">{profileNotice}</p>}
    <button type="button" className="account-menu-action account-logout" onClick={()=>void logout()}>Log out</button>
  </div>
  const [orders] = useCloudCollection(uid, 'orders', [] as {id:number;status:string;total:number;table:string;staff:string;items:string;createdAt?:string}[], x=>String(x.id))
  const [stock] = useCloudCollection(uid, 'inventory', [] as {name:string;qty:number;min:number;unit:string}[], x=>x.name)
  const isManager = workspace.role === 'manager'
  const canSell = isManager || workspace.role === 'waiter'
  const visibleNav = nav.filter(([,label]) => isManager || !['Inventory','Reports','Staff & roles','Settings'].includes(label))
  const periodOrders = orders.filter(order=>isWithin(order.createdAt,range)&&order.status!=='Cancelled')
  const totalSales = periodOrders.reduce((sum, order) => sum + order.total, 0)
  const lowStock = stock.filter(item => item.qty < item.min)

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span>B&R</span><small>HOSPITALITY</small></div>
      <div className="venue-switch">
        <span className="venue-logo">B&R</span>
        <div><b>{venue}</b><small>Restaurant workspace</small></div>
        <span className="chev">⌄</span>
      </div>
      <nav>
        <p className="nav-label">WORKSPACE</p>
        {visibleNav.map(([icon,label]) => <button key={label} className={active === label ? 'active' : ''} onClick={()=>setActive(label)}><Icon name={icon}/><span>{label}</span>{label==='Inventory' && <i>{lowStock.length}</i>}</button>)}
      </nav>
      <div className="sidebar-foot">
        <div className="sync"><span></span><div><b>Firebase workspace</b><small>Connected session</small></div></div>
        <div className="account-area" ref={accountRef}><button type="button" className="user account-trigger" aria-expanded={accountOpen} aria-label="Open account menu" onClick={()=>setAccountOpen(o=>!o)}><span className="user-avatar">{initials}</span><span className="user-details"><b>{accountName}</b><small>{workspace.role}</small></span><span aria-hidden="true">•••</span></button>{accountOpen && accountMenu}</div>
      </div>
    </aside>

    <main>
      <header>
        <div><p className="breadcrumb">Workspace <span>/</span> {active}</p><h1>{active}</h1></div>
        <div className="header-actions"><button className="mobile-account-button" onClick={()=>setAccountOpen(o=>!o)} aria-label="Account options" aria-expanded={accountOpen}>{initials}</button>
          <button className="lang">EN <span>⌄</span></button>
          <button className="bell" aria-label="Notifications"><Icon name="bell"/><i></i></button>
          <button className="primary" disabled={!canSell} onClick={()=>setActive('POS')}>Open POS <Icon name="arrow"/></button>
        </div>
      </header>
      {accountOpen && <div className="mobile-account-menu">{accountMenu}</div>}

      <div className="mobile-nav">{visibleNav.map(([,label])=><button key={label} className={active===label?'selected':''} onClick={()=>setActive(label)}>{label}</button>)}</div>
      <div hidden={active!=='Overview'}>
      <section className="welcome">
        <div><h2>Welcome to your workspace</h2><p>Here’s how <b>{venue}</b> is doing today.</p></div>
        <div className="range">{['Today','7 days','30 days'].map(x=><button className={range===x?'selected':''} onClick={()=>setRange(x)} key={x}>{x}</button>)}</div>
      </section>

      <section className="stats">
        <Stat label="Revenue" value={`UGX ${totalSales.toLocaleString('en-UG')}`} note="Recorded order value (not paid revenue)" />
        <Stat label="Orders today" value={String(periodOrders.length)} note={`Orders · ${range}`} />
        <Stat label="Open tables" value="Demo" note="Table occupancy not connected" tone="amber" />
        <Stat label="Low stock" value={`${lowStock.length} items`} note="Needs your attention" tone="red" />
      </section>

      <section className="content-grid">
        <article className="panel sales">
          <div className="panel-head"><div><h3>Sales overview</h3><p>Recorded orders · {range}</p></div><b>UGX {totalSales.toLocaleString('en-UG')}</b></div>
          <p className="empty">{periodOrders.length ? `${periodOrders.length} recorded orders in this period. This is order value, not confirmed paid revenue.` : 'No recorded orders in this period.'}</p>
        </article>
        <article className="panel payments">
          <div className="panel-head"><div><h3>Payments</h3><p>Payment tracking is not connected yet</p></div></div>
          <p className="empty">No verified payment breakdown is available. Payment totals will appear after billing and settlement are implemented.</p>
        </article>

        <article className="panel orders">
          <div className="panel-head"><div><h3>Recent orders</h3><p>Updated from Firestore</p></div><button onClick={()=>setActive('Orders')}>View all <Icon name="arrow"/></button></div>
          {orders.length===0?<p className="empty">No orders recorded yet.</p>:orders.slice().sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??'')).slice(0,3).map(o=><div className="order-row" key={o.id}><span className="table">T{o.table}</span><div><b>Table {o.table}</b><small>{o.staff} · #{o.id}</small></div><time>{o.createdAt?new Date(o.createdAt).toLocaleTimeString('en-UG',{hour:'2-digit',minute:'2-digit'}):'—'}</time><em className={o.status.toLowerCase()}>{o.status}</em><strong>UGX {o.total.toLocaleString('en-UG')}</strong></div>)}
        </article>

        <article className="panel stock">
          <div className="panel-head"><div><h3>Low stock</h3><p>{lowStock.length} items need attention</p></div><button onClick={()=>setActive('Inventory')}>Inventory <Icon name="arrow"/></button></div>
          {lowStock.slice(0, 3).map(x=>[x.name, `${x.qty} ${x.unit}`, `${x.min} ${x.unit}`, x.qty < x.min / 2 ? 'Critical' : 'Low']).map(([a,b,c,d])=><div className="stock-row" key={a}><span>{a.slice(0,2).toUpperCase()}</span><div><b>{a}</b><small>{b} remaining · Reorder at {c}</small></div><em className={d==='Critical'?'critical':''}>{d}</em></div>)}
        </article>
      </section>
      </div>
      <WorkspacePages active={active} venue={venue} setVenue={setVenue} uid={uid} workspace={workspace} />
      <footer>Powered by <b>B&R</b><span>•</span> Firebase-enabled workspace</footer>
    </main>
  </div>
}
