# Shared venue release — deployment and safety guide

## What changed
- Opt-in shared venue on the existing signed-in website. **Legacy `/users/{uid}` records are not deleted.**
- One-time atomic snapshot copy (up to 450 documents) of orders/menu/inventory/staff to a new `/venues/{venueId}`.
- Venue membership management on Staff & roles (manager assigns access by Firebase Authentication UID).
- Invited staff can enter the venue ID in the workspace setup banner after registering/logging in.
- Live Firestore collection listeners now read shared-venue data once the venue has been activated.
- Roles enforced by Firestore rules: managers administer inventory/menu/staff, waiters create/update orders, kitchen/bar can change order status only.
- Menu deletion and zero-stock inventory removal UI; existing order snapshots remain intact.
- GitHub CI checks, basic static safety tests and optimistic-write rollback on failed saves.

## Before deployment
1. Export/back up Firestore through an approved method and check the backup.
2. Deploy this source to a **preview branch**; confirm `npm test` and `npm run build` in CI.
3. Publish the **new `firestore.rules`** from this ZIP using Firebase Console or `firebase deploy --only firestore:rules` from a configured Firebase CLI. This is a real security policy change; review it first.
4. Validate authentication, menu, inventory and POS operations under a test account.
5. Only then release to production.

## Activating shared venues
1. Owner signs in. The app remains on their existing private data until they press **Create shared venue**.
2. Creating the venue copies a snapshot of up to 450 current documents in a Firestore atomic batch and then sets their `activeVenueId` profile pointer as part of that batch. Original documents are not deleted.
3. Open Staff & roles to see the new **venue ID** and grant each staff member's Authentication UID the minimum necessary role.
4. Staff creates an account (if not already registered), signs in, enters the venue ID in **Join invited venue**, and joins.
5. Changes to the legacy personal collections *after activation* are not synchronized into the shared venue. Avoid running two copies in parallel.

## Limitations and safeguards
- **Not a production-complete POS:** Inventory is not automatically deducted from sales, and payments/receipts are not implemented. Order value is not settled revenue.
- Staff are invited by Firebase Authentication UID, not email. A staff directory entry is not an account invitation.
- The UI still includes several demonstration-only features, including table layout and analytics charts.
- Frontend-side order totals are NOT trusted payment settlement records. Production checkout needs trusted server processing and inventory transactions; do not use this for final cash reconciliation.
- Firestore security rules are provided but require actual Firebase Emulator test coverage before accepting real payments.
- The one-click snapshot is limited to 450 records and is intended for an initial small venue. Large datasets require a deliberate paginated migration with reconciliation.
- Source-only checks pass locally; full TypeScript+Vite build requires npm dependencies, unavailable in this offline work environment.
- **Do not publish `.env.local` or service-account private keys.**
- Configure `VITE_FIREBASE_*` in Vercel as already done.

## Quick checks
- `npm install`
- `npm test`
- `npm run build`
- Firebase console: verify new venue documents and membership records after opting in.
- In two signed-in browsers: create an order as a waiter and watch manager Orders update.
- Verify that kitchen/bar cannot write menu or inventory (permission-denied should be shown).
- Confirm deletion of an inventory entry requires stock = 0.
- Verify old `/users/{uid}/...` data is unchanged after snapshot migration.
