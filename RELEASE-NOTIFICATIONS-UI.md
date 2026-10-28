# Profile and notifications update

- Sidebar displays a compact Firebase display name and role, while account menu shows the full name, email, role, edit-name action and sign-out.
- The bell now opens active notifications computed from **real Firestore orders and low inventory** (no sample alerts). Alerts open the relevant workspace page. Read/unread acknowledgement is saved per device using localStorage; it is not a push notification service.
- English is displayed as a language indicator rather than a nonfunctional dropdown.
- No Firestore rules, functions, or environment variable changes needed.
- Manual QA: test long names, login/logout, name persistence, 0/1/multiple alerts, navigation on alert click, mobile bell and profile controls.
- Not included: push notifications, staff assignment notifications, billing, or finalized notification read synchronization.
