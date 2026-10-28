import { useEffect, useState, type FormEvent } from 'react'
import { collection, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import type { Workspace } from './VenueGate'

type Member = { id: string; role: Workspace['role']; enabled: boolean }
export function VenueMembers({workspace}: {workspace: Workspace}) {
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!db || !workspace.venueId || workspace.role !== 'manager') return
    return onSnapshot(collection(db,'venues',workspace.venueId,'members'), snap => setMembers(snap.docs.map(d=>({ id:d.id, role:d.data().role, enabled:d.data().enabled }))), e => setError(e.message))
  },[workspace.venueId,workspace.role])
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!db || !workspace.venueId) return
    setBusy(true); setError('')
    const fields = new FormData(e.currentTarget)
    const uid = String(fields.get('uid')).trim()
    const role = String(fields.get('role'))
    try {
      if (!/^[A-Za-z0-9_-]{10,128}$/.test(uid) || !['manager','waiter','kitchen','bar'].includes(role)) throw new Error('Enter a valid Firebase Authentication UID and role.')
      if (members.some(m=>m.id===uid)) throw new Error('This account is already a member. Use the controls below.')
      await setDoc(doc(db,'venues',workspace.venueId,'members',uid),{role,enabled:true,joinedAt:new Date().toISOString()})
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to add staff.') }
    finally { setBusy(false) }
  }
  const invitationLink = workspace.venueId ? `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(workspace.venueId)}` : ''
  if (!workspace.venueId) return <article className="panel"><p>Activate a shared venue above before adding account access.</p></article>
  if (workspace.role !== 'manager') return <p>Only managers can manage venue membership.</p>
  return <article className="panel"><h3>Restaurant staff access</h3><p>Invite staff without sharing or typing venue IDs. After granting a staff member access, copy the link below and send it to them.</p><button className="action" onClick={() => void navigator.clipboard.writeText(invitationLink).then(() => setError("Invitation link copied. Share it with approved staff."), () => setError("Unable to copy the link. Please use your browser copy option."))}>Copy staff invitation link</button><p>Staff must create their own Firebase login first. Enter their Firebase Authentication UID. Adding a staff directory entry alone does not give access.</p><form onSubmit={add} className="member-form"><input name="uid" aria-label="Firebase Authentication UID" placeholder="Firebase Authentication UID" required/><select name="role" aria-label="Staff role"><option value="waiter">Waiter</option><option value="kitchen">Kitchen</option><option value="bar">Bar</option><option value="manager">Manager</option></select><button className="action primary" disabled={busy}>Grant access</button></form>{error && <p role="alert">{error}</p>}<div className="table-scroll"><table className="data-table"><thead><tr><th>Account UID</th><th>Role</th><th>Enabled</th></tr></thead><tbody>{members.map(m=><tr key={m.id}><td>{m.id}</td><td><select aria-label={`Role for ${m.id}`} value={m.role} onChange={async e=>{if(!db||!workspace.venueId)return;try{await updateDoc(doc(db,'venues',workspace.venueId,'members',m.id),{role:e.target.value})}catch(e){setError(String(e))}}}>{['manager','waiter','kitchen','bar'].map(role=><option key={role}>{role}</option>)}</select></td><td><button disabled={m.id===workspace.venueId || false} className="action" onClick={async()=>{if(!db||!workspace.venueId)return;try{await updateDoc(doc(db,'venues',workspace.venueId,'members',m.id),{enabled:!m.enabled})}catch(e){setError(String(e))}}}>{m.enabled?'Disable':'Enable'}</button></td></tr>)}</tbody></table></div><p className="demo-note">Never share manager credentials or PINs. Role changes take effect via Firestore rules; other devices may need to refresh.</p></article>
}
