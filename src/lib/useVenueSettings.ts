import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

export type VenueSettings = {
  venueName: string
  primaryColor: string
  receiptFooter: string
  taxRate: number
  serviceCharge: number
  paymentMethods: string[]
}
export const defaultVenueSettings: VenueSettings = {
  venueName: 'My Venue', primaryColor: '#765721',
  receiptFooter: 'Thank you for visiting. We hope to see you again!',
  taxRate: 18, serviceCharge: 5,
  paymentMethods: ['Cash', 'Card', 'MTN Mobile Money', 'Airtel Money']
}
const reference = (uid: string) => uid.startsWith('venue:')
  ? doc(db!, 'venues', uid.slice(6), 'settings', 'general')
  : doc(db!, 'users', uid, 'settings', 'general')
export function useVenueSettings(uid: string | null) {
  const [settings, setSettings] = useState<VenueSettings>(defaultVenueSettings)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    setSettings(defaultVenueSettings)
    setLoading(true)
    setError('')
    if (!uid || !db) { setLoading(false); return }
    return onSnapshot(reference(uid), snapshot => {
      const value = snapshot.data() || {}
      setSettings({
        venueName: typeof value.venueName === 'string' ? value.venueName : defaultVenueSettings.venueName,
        primaryColor: typeof value.primaryColor === 'string' && /^#[\da-f]{6}$/i.test(value.primaryColor) ? value.primaryColor : defaultVenueSettings.primaryColor,
        receiptFooter: typeof value.receiptFooter === 'string' ? value.receiptFooter : defaultVenueSettings.receiptFooter,
        taxRate: typeof value.taxRate === 'number' ? value.taxRate : defaultVenueSettings.taxRate,
        serviceCharge: typeof value.serviceCharge === 'number' ? value.serviceCharge : defaultVenueSettings.serviceCharge,
        paymentMethods: Array.isArray(value.paymentMethods) ? value.paymentMethods.filter((v:unknown):v is string => typeof v === 'string') : defaultVenueSettings.paymentMethods
      })
      setError(''); setLoading(false)
    }, e => { setError(`Unable to load settings: ${e.message}`); setLoading(false) })
  }, [uid])
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-deep', settings.primaryColor)
  }, [settings.primaryColor])
  async function save(next: VenueSettings) {
    if (!uid || !db) throw new Error('Sign in to save settings.')
    await setDoc(reference(uid), { ...next, updatedAt: serverTimestamp() }, { merge: true })
  }
  return { settings, save, loading, error }
}
