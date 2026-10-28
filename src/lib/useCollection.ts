import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { collection, doc, onSnapshot, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

// Each signed-in owner has isolated Firestore records under /users/{uid}.
// This is a simple CRUD bridge, not a multi-venue POS transaction engine.
export function useCloudCollection<T extends object>(uid: string | null, name: string, demoRows: T[], key: (row: T) => string): [T[], Dispatch<SetStateAction<T[]>>, string] {
  const [rows, setRows] = useState<T[]>([])
  const [error, setError] = useState('')
  const ref = useRef<T[]>([])
  const keyRef = useRef(key)
  keyRef.current = key
  useEffect(() => {
    ref.current = uid ? [] : demoRows
    setRows(uid ? [] : demoRows)
    if (!uid || !db) return
    const path = uid.startsWith('venue:') ? collection(db, 'venues', uid.slice(6), name) : collection(db, 'users', uid, name)
    return onSnapshot(path, snap => {
      const next = snap.docs.map(d => d.data() as T)
      ref.current = next
      setRows(next)
      setError('')
    }, err => setError(`Cannot load ${name}: ${err.message}`))
  // demoRows is intentionally initial fallback only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, name])
  const setCloudRows: Dispatch<SetStateAction<T[]>> = update => {
    const previous = ref.current
    const next = typeof update === 'function' ? (update as (prev: T[]) => T[])(previous) : update
    ref.current = next
    setRows(next)
    if (!uid || !db) return
    const before = new Map(previous.map(row => [keyRef.current(row), row]))
    const after = new Map(next.map(row => [keyRef.current(row), row]))
    const batch = writeBatch(db)
    let changes = 0
    for (const [id, row] of after) {
      if (JSON.stringify(row) !== JSON.stringify(before.get(id))) {
        batch.set(uid.startsWith('venue:') ? doc(db, 'venues', uid.slice(6), name, id) : doc(db, 'users', uid, name, id), row)
        changes++
      }
    }
    for (const id of before.keys()) if (!after.has(id)) { batch.delete(uid.startsWith('venue:') ? doc(db, 'venues', uid.slice(6), name, id) : doc(db, 'users', uid, name, id)); changes++ }
    if (changes > 0) {
      if (changes > 450) { setError('Too many changes at once. Please contact support.'); return }
      void batch.commit().catch(err => { ref.current = previous; setRows(previous); setError(`Unable to save ${name}: ${err.message}`) })
    }
  }
  return [rows, setCloudRows, error]
}
