This is an Expo SDK 57 React Native and web application. Use the official versioned Expo documentation before changing Expo APIs.

## Commands

- `pnpm start` starts Expo.
- `pnpm typecheck` runs TypeScript checks.
- `pnpm test` runs the focused domain tests.
- `pnpm exec expo install <package>` selects an SDK-compatible dependency version.

## Navigation and structure

- Use Expo Router. Route files live in `app/`; `_layout.tsx` defines navigators.
- Keep domain logic in `domain/` and shared UI in `components/`.
- Keep Supabase access in `data/` and `lib/`; schema and trusted RPCs live in `supabase/migrations/`.
- Keep generated native folders out of source control; configure native behavior through `app.json` and Expo config plugins.

## Scope

- Keep weekly rules, number generation, reveal transitions, submissions, and point calculations in pure domain functions where possible.
- The database is authoritative for weekly secrets, reveal consumption, submissions, points, and streaks. Never put a service-role key in Expo client code.
- Do not add backend services, account systems, notifications, ads, or production reveal protections unless a task explicitly requests them.
