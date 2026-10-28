import { useEffect, useState, type ReactNode } from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

export type Workspace = { scope: string; role: 'manager' | 'waiter' | 'kitchen' | 'bar'; venueId?: string }
const collections = ['orders', 'menu', 'inventory', 'staff'] as const

function invitedVenue(): string | null {
  const id = new URLSearchParams(window.location.search).get('join')
  return id && /^[A-Za-z0-9]{10,128}$/.test(id) ? id : null
}

/** No existing user records are modified or deleted when creating a restaurant. */
export function VenueGate({ uid, children }: { uid: string; children: (workspace: Workspace) => ReactNode }) {
  const [venueId, setVenueId] = useState<string | null>(null)
  const [role, setRole] = useState<Workspace['role'] | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)
  const [membershipLoaded, setMembershipLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inviteId = invitedVenue()

  useEffect(() => {
    if (!db) return
    setProfileLoaded(false)
    return onSnapshot(doc(db, 'users', uid), snap => {
      const id = snap.data()?.activeVenueId
      setVenueId(typeof id === 'string' && id ? id : null)
      setProfileLoaded(true)
    }, e => { setError(e.message); setProfileLoaded(true) })
  }, [uid])

  useEffect(() => {
    if (!db || !venueId) { setRole(null); setMembershipLoaded(true); return }
    setMembershipLoaded(false)
    return onSnapshot(doc(db, 'venues', venueId, 'members', uid), snap => {
      const value = snap.data()
      setRole(value?.enabled === true && ['manager', 'waiter', 'kitchen', 'bar'].includes(value.role) ? value.role : null)
      setMembershipLoaded(true)
    }, e => { setError(e.message); setMembershipLoaded(true) })
  }, [uid, venueId])

  async function createVenue(copyExisting: boolean) {
    if (!db || busy) return
    setBusy(true); setError('')
    try {
      const venue = doc(collection(db, 'venues'))
      const groups = copyExisting ? await Promise.all(collections.map(async name => ({ name, snap: await getDocs(collection(db!, 'users', uid, name)) }))) : []
      const count = groups.reduce((sum, group) => sum + group.snap.size, 0)
      if (count > 450) throw new Error('There are too many old records to copy at once. Please use Start fresh; the old records will remain untouched.')
      const batch = writeBatch(db)
      batch.set(venue, { ownerId: uid, name: 'B&R Hospitality', createdAt: serverTimestamp(), schemaVersion: 1 })
      batch.set(doc(db, 'venues', venue.id, 'members', uid), { role: 'manager', enabled: true, joinedAt: serverTimestamp() })
      for (const group of groups) for (const original of group.snap.docs) {
        batch.set(doc(db, 'venues', venue.id, group.name, original.id), original.data())
      }
      batch.set(doc(db, 'users', uid), { activeVenueId: venue.id }, { merge: true })
      await batch.commit()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create your restaurant workspace.') }
    finally { setBusy(false) }
  }

  async function acceptInvitation(id: string) {
    if (!db || busy) return
    setBusy(true); setError('')
    try {
      const member = await getDoc(doc(db, 'venues', id, 'members', uid))
      if (!member.exists() || member.data().enabled !== true) throw new Error('Your manager must grant your account access before this invitation can be opened.')
      await setDoc(doc(db, 'users', uid), { activeVenueId: id }, { merge: true })
      window.history.replaceState({}, '', window.location.pathname)
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to open invitation.') }
    finally { setBusy(false) }
  }

  if (!profileLoaded || (venueId && !membershipLoaded)) return <div className="setup-gate">Loading your restaurant…</div>
  if (venueId && !role) return <div className="setup-gate"><h2>Access unavailable</h2><p>Your restaurant access is inactive. Ask the manager to restore your membership.</p>{error && <p role="alert">{error}</p>}</div>
  return <>
    {!venueId && <div className="migration-banner" role="region" aria-label="Restaurant setup">
      {inviteId ? <>
        <b>Restaurant invitation</b><span>You have been invited to an existing restaurant. Sign in with the staff account approved by the manager.</span>
        <button disabled={busy} onClick={() => void acceptInvitation(inviteId)}>{busy ? 'Connecting…' : 'Join restaurant'}</button>
      </> : <>
        <b>Set up your restaurant</b><span>Create a shared workspace for orders, menu and inventory. You won't need to enter a venue ID. Your previous personal records are never deleted.</span>
        <button disabled={busy} onClick={() => void createVenue(false)}>{busy ? 'Creating…' : 'Start fresh restaurant'}</button>
        <button disabled={busy} onClick={() => void createVenue(true)}>Copy existing records instead</button>
        <span>Until you choose, the original personal workspace remains available below.</span>
      </>}
      {error && <span role="alert">{error}</span>}
    </div>}
    {children(venueId ? { scope: `venue:${venueId}`, venueId, role: role! } : { scope: uid, role: 'manager' })}
  </>
}
