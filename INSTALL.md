# Bar-and-R Daily Sales Update

This folder is arranged to match the target paths in the existing Bar-and-R repository.

## Copy into your existing repository

Extract this ZIP and copy its contents into the **root** of your existing Bar-and-R project, keeping the folders intact. Merge folders when Windows asks; do not replace the entire project.

| This package path | Destination in your existing repository | Action |
|---|---|---|
| `functions/index.js` | `functions/index.js` | Replace the existing file after making a backup |
| `firestore.rules` | `firestore.rules` | Replace the existing file after making a backup |
| `src/DailySales.tsx` | `src/DailySales.tsx` | Add this new file |
| `apply-daily-sales-patch.mjs` | `apply-daily-sales-patch.mjs` | Copy to project root; temporary helper |

Do not replace your existing `package.json`, `firebase.json`, `src/App.tsx`, or `src/WorkspacePages.tsx` with files from this package. The patch script updates `src/App.tsx` and `src/WorkspacePages.tsx` only when each expected text anchor occurs exactly once.

## Run the patch and checks

Open PowerShell or the VS Code terminal in the existing project root (the folder containing `package.json`) and run:

```powershell
node apply-daily-sales-patch.mjs
npm install
npm run typecheck
npm run build
```

If the patch script reports a mismatch or says nothing was written, stop and share the full error. Do not deploy until the typecheck and build succeed.

After successful checks, remove `apply-daily-sales-patch.mjs` if you no longer need it.

## Firebase deployment

Only after reviewing the changes, confirming the correct Firebase project, and testing in a non-production/test venue, deploy in this order:

```powershell
firebase deploy --only functions
firebase deploy --only firestore:rules
```

Then merge/push the frontend changes so your hosting provider can build the updated site. Confirm the Firebase CLI is logged into the intended account and project before deploying.

## Important limitations

- Mobile money/card references are entered by staff and are not verified against a payment provider.
- Refunds/voids and reopening a closed day are not included.
- Existing orders without the required payment records are treated as legacy orders.
