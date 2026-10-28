import { useEffect, useState, type ReactNode } from 'react'
import { collection, doc, getDocs, onSnapshot, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

export type Workspace = { scope: string; role: 'manager' | 'waiter' | 'kitchen' | 'bar'; venueId?: string }
const collections = ['orders', 'menu', 'inventory', 'staff'] as const

/** Legacy records are NOT deleted or migrated automatically. */
export function VenueGate({ uid, children }: { uid: string; children: (workspace: Workspace) => ReactNode }) {
  const [venueId, setVenueId] = useState<string | null>(null)
  const [role, setRole] = useState<Workspace['role'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [joinId, setJoinId] = useState('')
  useEffect(() => {
    if (!db) return
    return onSnapshot(doc(db, 'users', uid), snapshot => {
      setVenueId(typeof snapshot.data()?.activeVenueId === 'string' ? snapshot.data()!.activeVenueId : null)
      setLoading(false)
    }, e => { setError(e.message); setLoading(false) })
  }, [uid])
  useEffect(() => {
    if (!db || !venueId) { setRole(null); return }
    setLoading(true)
    return onSnapshot(doc(db, 'venues', venueId, 'members', uid), snapshot => {
      const value = snapshot.data()
      setRole(value?.enabled === true && ['manager','waiter','kitchen','bar'].includes(value.role) ? value.role : null)
      setLoading(false)
    }, e => { setError(e.message); setLoading(false) })
  }, [uid, venueId])

  async function createVenue() {
    if (!db || busy) return
    setBusy(true); setError('')
    try {
      const newVenue = doc(collection(db, 'venues'))
      // Create a brand new venue, preserve all legacy records, and copy a snapshot.
      const snapshotGroups = await Promise.all(collections.map(async name => ({ name, snap: await getDocs(collection(db!, 'users', uid, name)) })))
      const count = snapshotGroups.reduce((sum, group) => sum + group.snap.size, 0)
      if (count > 450) throw new Error('More than 450 legacy records: use an administrator-assisted paginated migration, not this one-click copy.')
      const batch = writeBatch(db)
      batch.set(newVenue, { ownerId: uid, name: 'B&R Hospitality', createdAt: serverTimestamp(), schemaVersion: 1 })
      batch.set(doc(db, 'venues', newVenue.id, 'members', uid), { role: 'manager', enabled: true, joinedAt: serverTimestamp() })
      for (const group of snapshotGroups) for (const original of group.snap.docs) {
        batch.set(doc(db, 'venues', newVenue.id, group.name, original.id), original.data())
      }
      // Switch only after all copied records and membership have committed atomically.
      batch.set(doc(db, 'users', uid), { activeVenueId: newVenue.id }, { merge: true })
      await batch.commit()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not create shared venue.') }
    finally { setBusy(false) }
  }
  async function joinVenue() {
    if (!db || !/^[A-Za-z0-9]{10,128}$/.test(joinId)) { setError('Enter the venue ID provided by your manager.'); return }
    setBusy(true); setError('')
    try {
      const { getDoc, setDoc } = await import('firebase/firestore')
      const membership = await getDoc(doc(db, 'venues', joinId, 'members', uid))
      if (!membership.exists() || membership.data().enabled !== true) throw new Error('Your account has not been granted access to that venue.')
      await setDoc(doc(db, 'users', uid), { activeVenueId: joinId }, { merge: true })
    } catch(e) { setError(e instanceof Error ? e.message : 'Cannot join venue.') }
    finally { setBusy(false) }
  }
  if (loading) return <div className="setup-gate">Loading your workspace…</div>
  if (error) return <div className="setup-gate"><h2>Workspace setup</h2><p role="alert">{error}</p><button onClick={() => setError('')}>Dismiss</button></div>
  if (venueId && !role) return <div className="setup-gate"><h2>Access unavailable</h2><p>Your account is not an active member of this venue. Ask your manager to restore access.</p></div>
  return <>{!venueId && <div className="migration-banner" role="region" aria-label="Shared venue setup"><b>Single-account workspace</b><span>Records are private to your login. Activate a shared venue to collaborate with staff. Existing records remain intact; a snapshot is copied once. Venue ID: {venueId ?? "not activated"}.</span><button disabled={busy} onClick={() => void createVenue()}>{busy ? 'Creating venue…' : 'Create shared venue'}</button><input aria-label="Existing venue ID" placeholder="Existing venue ID" value={joinId} onChange={e=>setJoinId(e.target.value)}/><button disabled={busy} onClick={() => void joinVenue()}>Join invited venue</button></div>}{children(venueId ? { scope: `venue:${venueId}`, venueId, role: role! } : {scope: uid, role:'manager'})}</>
}
