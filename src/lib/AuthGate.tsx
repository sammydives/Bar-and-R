import { useEffect, useState, type ReactNode, type FormEvent } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { auth, configured } from './firebase'

export function AuthGate({ children }: { children: (uid: string | null) => ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(configured)
  const [error, setError] = useState('')
  const [registering, setRegistering] = useState(false)
  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, next => { setUser(next); setLoading(false) }, () => { setError('Unable to verify your session.'); setLoading(false) })
  }, [])
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!auth) return
    setError('')
    const fields = new FormData(e.currentTarget)
    const email = String(fields.get('email')).trim()
    const password = String(fields.get('password'))
    try {
      if (registering) await createUserWithEmailAndPassword(auth, email, password)
      else await signInWithEmailAndPassword(auth, email, password)
    } catch (err) { setError(err instanceof Error ? err.message : 'Sign in failed.') }
  }
  if (!configured) return <div className="setup-gate"><h1>B&R Hospitality</h1><p>Firebase is not configured. Copy <code>.env.example</code> to <code>.env.local</code> and enter your Firebase web app values. Read <code>README.md</code> for instructions.</p></div>
  if (loading) return <div className="setup-gate">Checking your session…</div>
  if (!user) return <div className="setup-gate"><form onSubmit={submit} className="login-card"><h1>B&R Hospitality</h1><p>{registering ? 'Create your workspace account' : 'Sign in to your workspace'}</p><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Password<input name="password" type="password" minLength={6} required autoComplete={registering ? 'new-password' : 'current-password'} /></label>{error && <p role="alert" className="auth-error">{error}</p>}<button className="primary" type="submit">{registering ? 'Create account' : 'Sign in'}</button><button type="button" className="auth-switch" onClick={() => { setError(''); setRegistering(!registering) }}>{registering ? 'Already have an account? Sign in' : 'Create an account'}</button></form></div>
  return <><div className="auth-toolbar"><span>{user.email}</span><button onClick={() => { if (auth) void signOut(auth) }}>Sign out</button></div>{children(user.uid)}</>
}
