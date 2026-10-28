# B&R Hospitality — Firebase + Vercel starter

React 19 / TypeScript / Vite hospitality dashboard, adapted from the supplied prototype.

## What is connected

- Firebase Authentication (email/password registration and sign-in).
- Cloud Firestore listeners and writes for **menu**, **orders**, **inventory**, and **staff directory**.
- Records are isolated **per signed-in account**: `users/{uid}/menu`, `users/{uid}/orders`, `users/{uid}/inventory`, `users/{uid}/staff`.
- The dashboard's headline order count, recorded order totals, and low-stock list now read from Firestore.
- Vercel deploy configuration for Vite SPA refreshes and routing.

## Important limitations

This is a **Firebase-enabled prototype**, not a production-ready restaurant POS. The sales chart, payment donut, example order display, reports and CSV exports are illustrative; venue branding, tax, service charge, and payment preferences are still local UI state. Staff directory roles **do not** grant real authentication permissions. Orders are not payment settlements, and inventory is not automatically deducted; do not rely on this for financial, inventory, or tax reporting. The basic browser-side CRUD bridge is not transaction-safe under concurrent edits. There are no built-in backups, audit logs, shift controls, fiscal receipts, or payment gateway integration. **Do not create real staff logins by sharing an owner's account.**

## 1. Create Firebase project

1. Go to https://console.firebase.google.com/ and choose **Add project**.
2. Under **Project settings > General > Your apps**, register a **Web** app.
3. Copy the Firebase web app config fields into environment variables matching `.env.example` (the values prefixed `VITE_`). The Firebase web config is not a server secret; do **not** commit service-account JSON or private keys.
4. Open **Build > Authentication > Sign-in method** and enable **Email/Password**.
5. Open **Build > Firestore Database** and create a database in an appropriate region. Choose a secure rules configuration; **do not leave Firestore in test mode**.
6. In the Firebase console **Firestore Database > Rules**, paste `firestore.rules` and **Publish**. These rules isolate one account from another. Alternatively use `firebase deploy --only firestore:rules` after installing the Firebase CLI and selecting the correct project.
7. Under **Authentication > Settings > Authorized domains**, add your actual `<project>.vercel.app` hostname and any custom domain. Do not add made-up addresses.

> The UI allows signup for anyone who has the URL. Disable the "Create an account" switch in the source and provision accounts in Firebase Console yourself if you need invite-only access. Account isolation does **not** allow team members to share a venue; multi-user venue roles require a separate tenant schema and robust security rules.

## 2. Run locally

Requires Node.js 20.19+ or 22.12+ (Vite 8).

```bash
npm install
cp .env.example .env.local
# Fill in the VITE_FIREBASE_* values in .env.local
npm run dev
```

In PowerShell, copy using `Copy-Item .env.example .env.local`.

Run checks:

```bash
npm run typecheck
npm run build
```

## 3. Upload to GitHub

1. Unzip this package.
2. On GitHub create a new **empty** repository (without a README).
3. In the extracted directory:

```bash
git init
git add .
git commit -m "Initial B&R Hospitality Firebase starter"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Or use GitHub's **Add file > Upload files** to upload the extracted files and folders. **GitHub does not automatically unpack a ZIP** into your repository.

## 4. Deploy on Vercel

1. Go to https://vercel.com/new, sign in and **Import Git Repository**.
2. Select the new repository.
3. Framework preset: **Vite**. Build command `npm run build`; output directory `dist` (also in `vercel.json`).
4. In **Environment Variables**, add all six `VITE_FIREBASE_*` entries from `.env.example` with values from the Firebase web app. Apply them to Production (and Preview if needed).
5. Deploy. Add the resulting Vercel domain to Firebase Authentication's authorized domains.
6. After updating Vercel variables, **redeploy**. These Vite variables are bundled into the frontend at build time.

## 5. Safety checks before relying on it

- Verify users cannot read another account's Firestore collections.
- Enforce proper owner/staff permissions and invite flows on the server/rules before real multi-user operations.
- Replace demonstration dashboards and reports with authoritative query-based aggregates.
- Use Firestore transactions or trusted server functions for order creation, stock movements and payment reconciliation.
- Confirm UGX VAT/service treatment with an accountant and implement an appropriate receipt flow.
- Add automated tests, audit logs, backups, monitoring, and error recovery.

## Files

- `src/lib/firebase.ts` — initializes Firebase web SDK.
- `src/lib/AuthGate.tsx` — email/password authentication UI.
- `src/lib/useCollection.ts` — basic per-user Firestore collection synchronization.
- `firestore.rules` — initial account-isolation rules.
- `firebase.json` — optional Firebase CLI rules deployment.
- `vercel.json` — Vercel build and SPA fallback.
- `.env.example` — configuration keys only, no real credentials.
