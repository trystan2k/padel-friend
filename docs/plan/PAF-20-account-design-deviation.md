# PAF-20 account screen — approved design deviation

Reference: `docs/design/padel-friend.pen`, frame `EGb2g` (Onboarding — account); export: `e2e/references/paf-1/account.png` (390×844).

- Keep step badge, heading, deep-green welcome card, surface email card, privacy note, and sign-in prompt.
- Replace magic-link helper and single email-only CTA with an email + labeled password form, password-oriented helper, and **CREATE ACCOUNT** CTA. No one-time-link promise: target Supabase Auth uses email/password with immediate session when confirmation is off. If confirmation is on elsewhere, show translated check-email state instead.
- Omit disabled alternative divider and Google sign-in nodes from this account screen.
- Added password row makes card and subsequent elements taller than original export; do not treat original full-screen PNG as an exact pixel baseline for adapted screen. PAF-23/24 own adapted visual reference and screenshot tests.
- Use `src/routes/onboarding_.account.tsx` to keep public `/onboarding/account` outside guarded `/onboarding` route.
