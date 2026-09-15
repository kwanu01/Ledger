# Native Apple authorization lifecycle

Candidate implementation, 2026-09-15. Apple Developer membership is currently **Pending**; no real Team ID/signing key has been configured and the production Apple provider must remain disabled. No real Apple login, token exchange, revocation or account deletion was run during these checks.

## API and trust boundaries

- Public `GET /api/mobile/v1/config` adds only `capabilities.appleRevocation:boolean`. It is true only when the server signing/encryption configuration parses and the migration readiness RPC succeeds. Native UI also requires Supabase `external.apple=true` and the iOS API to be available. Provider enablement alone does not permit a new Apple login.
- Authenticated `POST /api/mobile/v1/account/apple` accepts only `{authorizationCode}`. The current user comes from the existing server-verified Bearer handler. The request cannot supply a user ID, Apple subject, client ID, token or secret. Responses contain no Apple token material.
- A code is sent to Apple's fixed HTTPS token endpoint once. `jose` verifies the returned ID token signature against Apple's fixed JWKS endpoint, RS256, issuer, native App ID audience, expiry/issue time and the current Supabase user's verified Apple identity subject. User-editable metadata is never an authorization source.
- Each login retains its own refresh grant; a later login does not overwrite another device's grant. Authorization codes are not persisted. Their SHA-256 digests permit retries of a successfully stored request without reusing the single-use code.
- AES-256-GCM protects refresh tokens at rest. AAD binds ciphertext to the user, App ID, verified Apple subject and grant UUID. Keys remain outside the database and browser/native bundle. Tables and RPCs are service-role only, with RLS and explicit public/anon/authenticated privilege revocation.
- Native ID-token exchange uses a separate `persistSession:false` client. Registration uses that temporary session's fixed access token; the primary client persists the session only after registration succeeds. Cancellation, failure or an app restart while registration is pending cannot restore an unregistered new session or replace an existing account. If a response was lost after the code was consumed, the database preserves an uncertain state instead of asserting revocation readiness.

Apple authorization codes are single-use and expire after five minutes. A native authorization request has no `redirect_uri`, so the server does not invent one when exchanging its code. [Apple token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens)

## Server-only configuration

These names must be set only on the server after the real Apple account is active. No real values or fabricated identifiers are included here.

| Variable | Required value |
| --- | --- |
| `APPLE_CLIENT_ID` | Existing native App ID `net.teamledger.app` |
| `APPLE_TEAM_ID` | Actual 10-character Apple team identifier |
| `APPLE_KEY_ID` | Actual 10-character identifier for the Sign in with Apple signing key |
| `APPLE_PRIVATE_KEY` | The corresponding PKCS#8 `.p8` PEM, kept in server secret storage |
| `APPLE_TOKEN_ENCRYPTION_KEYS` | Secret JSON object mapping key identifiers to base64-encoded 32-byte encryption keys |
| `APPLE_TOKEN_ACTIVE_KEY_ID` | One key identifier present in that keyring, used for new writes |

Retain old encryption keys until every corresponding ciphertext has been re-encrypted or deleted. Removing a key early deliberately blocks automatic revocation rather than treating unreadable ciphertext as success. Client secrets are signed on demand with a five-minute lifetime; they are not persisted or returned to the app. Native ID-token login by itself did not require an Apple signing key, but token exchange/revocation now does. [Apple token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens) · [Supabase Apple authentication](https://supabase.com/docs/guides/auth/social-login/auth-apple)

## Deletion contract

`revokeAppleForAccountDeletion(userId)` in `apple.ts` returns `{status:'not_required'|'revoked'|'manual_required'}` or throws a safe `MobileError`. Account deletion calls it after ownership preflight and before destructive database writes. The UI must distinguish deleting the service's account data from an unconfirmed external Apple authorization.

- `not_required`: server-verified non-Apple account and no stored Apple grants.
- `revoked`: every known active grant received Apple HTTP 200 and the database confirmed cleanup. Apple intentionally does not distinguish newly revoked and already-invalid tokens.
- `manual_required`: a historical Apple account never had a stored token, or an exchange outcome was irrecoverably lost. The account-data deletion is still allowed; the UI directs the user to manually stop using Apple sign-in for this app. It must not label the external authorization automatically revoked.
- A known token that cannot be decrypted, a network/Apple failure, or a failed database confirmation throws. Those failures must not be converted into a successful deletion response.

Apple's guidance requires supporting deletion even when older credentials were not retained, and describes manual authorization removal for that case. [Apple TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple)

The account/Apple RPCs share an advisory lock. Reservation/commit reject `account_deletions` markers and frozen Apple states. A recent pending exchange makes deletion retry; after two minutes a stranded pending request becomes uncertain and requires manual external cleanup. Successful `auth.users` deletion cascades token/state rows; no permanent Apple subject/token/UUID tombstone is retained. If ownership changes after revocation but before the account transaction, revocation cannot be rolled back: the user must resolve ownership from the current session and retry deletion; the frozen state is retained for safety.

The app's new authenticated account deletion flow avoids forcing private-relay users through a separate web login. Actual hidden-email behavior, permission removal and native state cleanup still require signed-device tests. An account's own unconnected device ledger is preserved, as separately explained by the UI.

## Verification and rollout

- Candidate migrations: `20260915055134_permanent_account_access_revocation.sql`, then `20260915055506_apple_authorization_lifecycle.sql`. Created with Supabase CLI; not applied to production.
- `node --conditions=react-server --experimental-strip-types --test scripts/apple-authorization-test.ts` verifies real JWT signatures/claims and encryption with in-memory fixture keys, plus exchange/revocation failures and lifecycle state. It never contacts Apple.
- Native `npm run check:connection` verifies authorization-code forwarding with the fixed temporary access token, both readiness gates, missing code/cancel paths, registration interruption/restart, exactly one primary session commit after success, expected-user checks and real Supabase SDK local storage cleanup after server 404. Device ledger storage is retained.
- `checks/account-deletion-pg.mjs` passed all 19 cases against real local PostgreSQL 17.6, including roles, rollback and concurrent deletion/registration. Evidence: `work/ai-pg-concurrency/account-run-QSs4aW/result.json` in the workspace. Production requests: 0; temporary server stopped.
- Candidate web and native full TypeScript checks passed after integration.

Before enabling Apple: review/apply the migrations, configure actual server secrets, verify public readiness, complete signed iPhone login and deletion tests, then enable the production provider under the root task's control. The current candidate and passing fixtures are not evidence that a real Apple permission has been revoked.
