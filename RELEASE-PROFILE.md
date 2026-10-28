# Firebase profile and account menu release

- The account section now displays the authenticated Firebase user's displayName (or email prefix), email, and workspace role.
- Users can edit display name via Firebase Auth `updateProfile`; this persists across sign-ins without changing Firestore membership roles.
- Logout has moved into the account menu. A mobile account button is provided.
- Fake sales chart and fabricated payment totals were replaced with truthful order counts and a payment-system placeholder.
- No Firestore rules or Firebase environment changes are needed.

## Deploy
Run `npm install`, `npm run build`, and `npm test`. Upload to preview branch on GitHub; review Vercel preview; then merge.

## Test
1. Log in with a manager account, open account menu, edit display name, refresh and confirm it persists.
2. Log out and sign back in, confirm name and email match account.
3. Sign in as waiter and verify its role is displayed, not hardcoded manager.
4. On mobile, use account avatar in header to reach profile settings and logout.
5. Check no old fake revenue/payment values remain in Overview.
