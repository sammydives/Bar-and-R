# Automatic stock deductions — preview release

This release uses a **Firebase Callable Cloud Function**, not browser writes, to validate order items against live menu prices and deduct the mapped inventory in the same Firestore transaction. A stable `requestId` prevents duplicate deductions when an order submission is retried.

## Requirements before going live

1. Back up the Firestore database. Do not deploy directly to production without testing.
2. Firebase Cloud Functions requires a Firebase project on the **Blaze billing plan**. Confirm billing access and budget alerts first.
3. Deploy the backend with `firebase login`, `firebase use b-and-r-ca162`, `firebase deploy --only functions:placeStockOrder`. Node 22 is used for the function runtime. Install the Firebase CLI if needed.
4. Publish the included `firestore.rules` using `firebase deploy --only firestore:rules`, **only after** the function has deployed successfully. These rules deny direct creation of shared-venue orders and require the callable function instead.
5. Deploy the frontend to a Vercel preview branch, retaining existing `VITE_FIREBASE_*` variables. Merge only after end-to-end tests.
6. In Menu > Edit, define stock mappings, **one per line** in format `Exact inventory name | quantity`. Stock names are case-sensitive; units match inventory records. All items in an order need mapped stock ingredients.
7. Test manager and waiter orders with sufficient stock, insufficient stock, mixed food/bar orders, duplicate submission retries, and concurrent sales. Verify orders, inventory quantities and `stockMovements` records in Firestore.

## Important limitations

- This release reserves/deducts stock **when the order is submitted**, not when payment settles. Cancellations **do not automatically return stock**. Refund/void workflow remains future work.
- Prices/taxes are not fully regulated invoice processing. Service and tax rates are submitted from the current UI settings and are not yet securely sourced from the venue configuration. Managers should confirm pricing.
- The browser-side inventory editing and restocking UI still uses direct Firestore writes; future releases should move adjustments to audited backend functions.
- The code supports **shared venue** workspaces only for stock-deducting orders; old personal workspaces cannot submit new orders through this POS.
- Rules are not a substitute for function-level checks or real Firebase Emulator testing.
