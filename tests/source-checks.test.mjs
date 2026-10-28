import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
test('Firestore preserves private legacy data during migration', () => {
  const rules = read('firestore.rules')
  assert.match(rules, /match \/users\/\{userId\}/)
  assert.match(rules, /request\.auth\.uid == userId/)
  assert.match(rules, /match \/venues\/\{venueId\}/)
})
test('Venue membership is required for shared data', () => {
  const rules = read('firestore.rules')
  assert.match(rules, /function isActive\(venueId\)/)
  assert.match(rules, /get\(memberPath\(venueId, request\.auth\.uid\)\)\.data\.enabled == true/)
  assert.match(rules, /allow write: if isManager\(venueId\)/)
  assert.match(rules, /allowedStatusUpdate\(\)/)
})
test('Migration is opt-in, copies old collections and does not delete originals', () => {
  const source=read('src/lib/VenueGate.tsx')
  assert.match(source, /createVenue\(\)/)
  assert.match(source, /await batch\.commit\(\)/)
  assert.doesNotMatch(source, /batch\.delete\(/)
  assert.match(source, /activeVenueId/)
})
test('Vercel build checks types', () => {
  const pkg=JSON.parse(read('package.json'))
  assert.match(pkg.scripts.build, /tsc --noEmit && vite build/)
})
