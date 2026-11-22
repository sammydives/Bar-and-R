# B&R order endpoint patch (keep Firebase Auth + Firestore)

This patch replaces only the POS `placeStockOrder` callable with a same-origin Vercel API route. It does not migrate Firestore data.

## Files

- `api/placeStockOrder.js` — new Vercel Node.js function.
- `package.json` — add `firebase-admin` to the root dependencies.
- `WorkspacePages-sendStockOrder.patch.txt` — exact client import/function changes for `src/WorkspacePages.tsx`.

## GitHub upload steps

1. In GitHub, open `sammydives/Bar-and-R` on the `main` branch.
2. Create a folder named `api` at the repository root (if it does not already exist).
3. Add `api/placeStockOrder.js` using the file in this patch.
4. Open the root `package.json`. Add `"firebase-admin": "^13.0.0"` inside its existing `"dependencies"` object. Do not replace the rest of your package.json.
5. Open `src/WorkspacePages.tsx`.
   - Remove `import { getFunctions, httpsCallable } from 'firebase/functions'`.
   - Replace the existing `sendStockOrder` function with the version in `WorkspacePages-sendStockOrder.patch.txt`.
   - Keep the other imports and code.
6. Commit the changes. Vercel should start a deployment automatically.

## Required Vercel environment variables

In Vercel: Project → Settings → Environment Variables. Add these three variables for **Production** (and Preview too if you test preview deployments):

- `FIREBASE_PROJECT_ID` = `b-and-r-ca162`
- `FIREBASE_CLIENT_EMAIL` = the `client_email` value from a Firebase Admin service-account JSON key
- `FIREBASE_PRIVATE_KEY` = the `private_key` value from that same JSON key

Use an authorized project owner/adult to create or manage the service-account key. Do not paste the key into GitHub, source files, screenshots, or chat. In Vercel, paste the private key with its BEGIN/END lines; escaped `\n` sequences are also supported by this code.

The service account must have permission to read/write Firestore (the narrow Google Cloud IAM role is `Cloud Datastore User`, `roles/datastore.user`). Do not grant broad Owner permissions to the service account.

After adding variables, redeploy the latest Vercel deployment so the function receives them.

## Test

1. Sign into B&R with an enabled Manager or Waiter account.
2. Choose a menu item with a configured stock recipe.
3. Submit one test order.
4. Confirm exactly one order appears in `venues/{venueId}/orders`, and the matching inventory quantities decrease once.

The API verifies the Firebase ID token and checks the venue's enabled Manager/Waiter membership. It uses a Firestore transaction and the existing request ID for retry safety.

## Important limits

- This patch changes POS order submission only. Existing `recordPayment` and `closeDay` Firebase callable functions are not replaced by this patch, so those features still need separate handling if they rely on Cloud Functions.
- Vercel Hobby and Firebase Spark both have usage limits; check their current limits and avoid unexpected high traffic.
- Do not remove Firestore security rules or the membership check.
