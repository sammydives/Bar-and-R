# B&R Hospitality — simplified restaurant setup

## What changed
- Restaurant creation no longer requires manually generating, copying or entering a venue ID. Choose **Start fresh restaurant** to create an empty shared workspace, or **Copy existing records instead** to snapshot legacy personal data without deleting the originals.
- Staff invited by a manager use a **Copy staff invitation link** button instead of typing a venue ID. The application accepts the URL's `join` parameter after confirming the signed-in user's active membership.
- The manager must **still register each staff member's Firebase Auth UID** in Staff & roles before the link will work. This is a remaining limitation; email-based invitations need trusted backend invitation logic.
- No original Firestore collection is deleted or overwritten by restaurant creation.

## Important: choosing a workspace
If you already created a shared venue, the app continues using it. It will not create another one automatically. If you are still in your personal workspace, **Start fresh restaurant** creates a separate empty venue for new inventory. Existing inventory is not copied, and the previous records remain in the personal workspace. **Copy existing records instead** uses the earlier copy approach (up to 450 records). Avoid creating fresh venues repeatedly: different venues do not share data.

## Safe deployment
1. Create a preview branch from the current working GitHub commit. Upload the extracted files there.
2. Run `npm test` and `npm run build` using GitHub Actions or Vercel. This environment did not verify a complete dependency-installed build.
3. Review and publish `firestore.rules` to the **correct Firebase project** if not already published. The rule file is unchanged from the previous shared-venue package.
4. Test creation using a test user before changing any production user's active venue. Test inventory creation, edit, restock, and order creation, including refresh and a second browser.
5. Once validated, merge to main. Your Vercel `VITE_FIREBASE_*` values do not need changing.

## Still outstanding
- POS → kitchen/bar item-ticket routing and per-item preparation statuses
- Transactional inventory deductions, recipe mappings, and stock movement history
- Payment settlement and printable receipts
- Staff invitation by email without copying Firebase UID
- Firebase Emulator security and concurrency tests; offline-safe POS operations

**Do not use current order totals as verified paid revenue.**
