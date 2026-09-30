# Daily reveal push foundation

Client permission requests happen only from Settings. Web and Expo Go display an
unsupported message. A missing EAS project ID displays configuration required;
the code uses `Constants.expoConfig.extra.eas.projectId ?? Constants.easConfig.projectId`.
The Android channel is created before the permission request. Denial respects
`canAskAgain`. Existing opted-in registrations refresh on authenticated restore
without a new permission prompt. Settings also supports refresh and disable.

Only a random UUID, Expo token, platform, authenticated owner, and timestamps are
stored. SQLite-backed local storage holds this installation's registration;
there are no advertising IDs or unrelated telemetry. Explicit sign-out tries to
disable only this installation, with a five-second upper wait limit. Offline
failure retains a disable intent for the next session. Switching accounts moves
the active token to the new owner and disables it until explicit opt-in. Generic
notifications could still arrive after offline sign-out until reconciliation.

## Database and dispatcher

`20260930030000_reveal_push_devices.sql` adds RLS-protected device records with no
normal client table grants, narrow auth RPCs, and private delivery tracking.
The enabled token has one owner; historical disabled installation records retain
delivery history across token replacement and account switching. Multiple
installations per user are supported. Token possession is the registration
capability; no user ID is accepted by the registration RPC.

Only service-role RPCs can select, reserve, or finish deliveries. Selection and
reservation recheck private schedules using server time, current Seoul day/week,
enabled token ownership, and unconsumed state. Exact times and numbers never
leave these functions. A pending delivery is unique per user/week/day/device.
Concurrent workers reserve it once immediately before sending.

The Edge Function accepts POST only with `x-reveal-dispatch-secret` matching its
server-only `REVEAL_DISPATCH_SECRET` (at least 32 characters). JWT verification
is disabled because this is a dedicated cron endpoint, not an application-user
endpoint; the handler fails closed without its dedicated secret. Supabase's
service-role key is used only inside the deployed backend to call the narrow
worker RPCs. No input selects recipients or message content.

The Expo payload contains title "Today's number has arrived", body "You have
5 minutes to check it.", and data `{ "type": "DAILY_REVEAL" }`. Android uses the
`daily-reveal` channel. TTL is capped by remaining eligibility; downstream OS
delivery can still be delayed. Taps only route to protected `/reveal`. Signed-out
taps wait for authentication. The screen fetches server status and never consumes
automatically, including late/expired taps.

Successful Expo tickets are recorded and never resent. Explicit rate/ticket
rejections may retry after a minute, up to three attempts within the active
window. Invalid tokens are disabled. Ambiguous network failures, HTTP 5xx,
malformed success responses, and abandoned SENDING reservations are never retried:
Expo may have accepted them. This favors preventing duplicate sends over guaranteed
delivery. Exactly-once delivery across an external push service and PostgreSQL
cannot be guaranteed; push providers/OS may independently duplicate or delay.
Receipts are checked after 15 minutes, up to 24 hours; DeviceNotRegistered also
disables its matching token. Receipt errors never trigger resend. Counts only
are returned; tokens, secrets, schedules, and provider response bodies are not logged.

## Scheduler and remaining operator setup

`20260930031000_reveal_push_scheduler.sql` enables supported pg_cron/pg_net
extensions and creates the one-minute `dispatch-daily-reveal-pushes` job. Its SQL
contains no credentials. The private invoker reads Vault on each run and makes
no HTTP request until both required Vault entries exist. Missing extension support
also fails closed. The linked Supabase project supports these extensions.

Required operator steps, without committing any real credentials:

1. Connect this app to your actual Expo/EAS project (`eas init`), retaining its
   real `extra.eas.projectId`; configure a real Android application ID and/or iOS
   bundle identifier for your builds. No IDs were invented by this task.
2. Configure Android FCM v1 and/or Apple APNs credentials through EAS credentials,
   then create and install a native development build with expo-notifications.
   Expo Go/web are not remote-push validation environments for this app.
3. Generate a strong random dispatcher secret (32+ characters) using a password
   manager or cryptographic generator. Set `REVEAL_DISPATCH_SECRET` in the linked
   Supabase Edge Function secrets dashboard. Store the SAME value in Supabase
   Vault under `reveal_dispatch_secret`. Do not put it in `.env` or Expo extras.
4. Add Vault entry `reveal_dispatch_url` with the linked project's exact HTTPS
   endpoint: `https://gwgrouwkeyboheokuavw.supabase.co/functions/v1/dispatch-reveal-notifications`.
   The existing one-minute job becomes operational on its next run. Verify its
   run history and the Edge Function's count-only response.
5. If Expo enhanced push security is enabled, set server-only `EXPO_ACCESS_TOKEN`
   in Supabase Edge Function secrets. Otherwise it is optional. See Expo's
   [push delivery documentation](https://docs.expo.dev/push-notifications/sending-notifications/).
6. Sign in on a supported native test device, enable notifications in Settings,
   and verify a due reveal notification and late tap. Do not expose or manually
   move the private exact schedule into client code to perform the test.

Deployment: `pnpm dlx supabase functions deploy dispatch-reveal-notifications --use-api`.
The committed function config disables gateway JWT verification; handler secret
authentication remains mandatory. Deployment by itself does not activate delivery
until steps 3–4 are complete. No real devices were registered or sent test pushes.

## Verification

`pnpm test` covers domain/auth/status, minimal payload/routing, mocked Expo success,
permanent/temporary/ambiguous errors, dispatcher orchestration, and Edge auth gates.
`pnpm test:database` applies actual migrations on disposable loopback PostgreSQL,
including notification registration, ownership, replacement, transfers, multiple
devices, due boundaries, Sunday/expired/consumed exclusions, concurrent reservation,
retry, receipts, narrow grants, and preserved delivery history. Local tests never
connect to a remote project or send real pushes. Deno check/lint validates the Edge
Function separately from app TypeScript. Physical delivery, native permission UX,
and cold-start navigation require the configured native-device test above.

Supabase's [scheduler guidance](https://supabase.com/docs/guides/functions/schedule-functions)
uses pg_cron, pg_net and Vault; client APIs follow the
[versioned Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/).
