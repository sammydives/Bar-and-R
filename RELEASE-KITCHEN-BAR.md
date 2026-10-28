# B&R Hospitality: Kitchen / Bar ticket release

## Source and scope
Based on `B-R-Hospitality-Simplified-Venue-Setup.zip` from this conversation (not an authenticated live GitHub checkout). Review differences before merging. The live GitHub main branch may be older.

## Changes
- New orders retain route-tagged line items and initialize independent `preparation.Kitchen` / `preparation.Bar` statuses.
- Orders page shows station-specific tickets; kitchen and bar members see only their own station's tickets in the UI.
- Kitchen/bar updates use Firestore `updateDoc` of an individual preparation subfield, not replacement of the whole orders collection.
- Published rules must be changed to authorize role-scoped station updates. Read permissions still allow all active members to read orders, so the UI filtering is not data confidentiality protection.
- Manager/waiter can mark an order served only once all involved stations show Ready. Legacy orders without structured line items have no automatic station workflow.

## Deploy safely
1. Create a new GitHub branch and upload these files. Run `npm install`, `npm test`, `npm run build`.
2. In Firebase Console, review/publish `firestore.rules` from THIS ZIP. The rules in an earlier chat message do not include station-specific preparation permissions.
3. Test with one manager, one kitchen, one bar, and one waiter account in a preview URL. Ensure active venue memberships.
4. Submit an order containing food and drink. Confirm both stations see their respective ticket; mark each station Preparing and Ready independently; only then mark served.
5. Test unauthorized status changes with Firestore Rules Emulator. Do not merge to production before this passes.

## Known limitations
- The database uses a browser-side CRUD bridge for order creation and stock management. It does not guarantee concurrent order consistency; payment, invoices, ingredient mapping and stock deductions are NOT implemented.
- No Firebase Emulator integration tests or full TypeScript/Vite build were run in this session because dependencies were not available locally.
- Firestore rules need independent security review; these source checks do not establish production safety.
- The order-level status shows New until served; preparation progress is displayed per station.
- Existing orders lacking `lineItems` cannot be routed automatically.
- Do not clear or replace your Firestore database. No migration or deletion is required for this release.
