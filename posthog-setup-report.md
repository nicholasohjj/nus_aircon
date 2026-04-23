<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of your EVS electricity top-up Telegram bot project.

## Summary of changes

### `bot.js`

- Fixed hardcoded PostHog host (`https://us.i.posthog.com`) to use `process.env.POSTHOG_HOST` so it now points to the correct EU region.
- Added `enableExceptionAutocapture: true` to the PostHog client options.
- Added `posthog.captureException()` call in `bot.catch()` to automatically report unhandled Telegram bot errors to PostHog error tracking.

### `routes/cp2.js`

- Added `posthog-node` import and a new PostHog client instance (reading `POSTHOG_API_KEY` and `POSTHOG_HOST` from environment variables).
- Replaced the stub `track()` function (which only `console.log`'d) with a real implementation that calls `posthog.capture()`, using `meterId` as the `distinctId` and attaching a `route: "cp2"` property to all events.
- Added `posthog.captureException()` in the `/purchase_flow` error handler to surface payment gateway exceptions.
- Added `payment_completed` / `payment_failed` event capture in the `/webapp/result` handler based on the payment `status` query param.

### `routes/cp2nus.js`

- Added `posthog-node` import and a new PostHog client instance.
- Added a `track()` helper matching the pattern in `cp2.js`, with `route: "cp2nus"` property.
- Added `bootstrap_started`, `bootstrap_succeeded`, and `bootstrap_failed` event captures in the `/webapp/bootstrap` handler.
- Added `posthog.captureException()` in the bootstrap error catch block.
- Added `payment_completed` / `payment_failed` event capture in the `/webapp/result` handler.
- Added graceful `posthog.shutdown()` on `SIGINT`/`SIGTERM` to ensure buffered events are flushed before the process exits.

### `.env`

- Set `POSTHOG_HOST=https://eu.i.posthog.com` (was missing).
- Confirmed `POSTHOG_API_KEY` is present and up to date.

## Events instrumented

| Event                     | Description                                                  | File                                        |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `bot_start`               | User sent /start to the bot                                  | `bot.js` (existing)                         |
| `topup_command`           | User issued /topup command                                   | `bot.js` (existing)                         |
| `balance_command`         | User issued /balance command                                 | `bot.js` (existing)                         |
| `usage_command`           | User issued /usage command                                   | `bot.js` (existing)                         |
| `hostel_selected`         | User selected PGPR/PGP/RC/NUSC hostel                        | `bot.js` (existing)                         |
| `hostel_selected_blocked` | User attempted UTown/RVRC (not yet available)                | `bot.js` (existing)                         |
| `amount_accepted`         | Valid top-up amount entered                                  | `bot.js` (existing)                         |
| `payment_button_shown`    | Payment link shown to user (non-HTTPS fallback)              | `bot.js` (existing)                         |
| `prefill_usage_error`     | Failed to pre-fetch meter usage during top-up flow           | `bot.js` (existing)                         |
| `usage_error`             | Failed to fetch usage history on /usage command              | `bot.js` (existing)                         |
| `balance_error`           | Failed to fetch balance on /balance command                  | `bot.js` (existing)                         |
| `bootstrap_started`       | Payment bootstrap initiated (cp2 flow)                       | `routes/cp2.js` (connected to PostHog)      |
| `bootstrap_succeeded`     | Payment bootstrap succeeded (cp2 flow)                       | `routes/cp2.js` (connected to PostHog)      |
| `bootstrap_failed`        | Payment bootstrap failed (cp2 flow)                          | `routes/cp2.js` (connected to PostHog)      |
| `payment_completed`       | Payment result page reached with success status (cp2)        | `routes/cp2.js` (new)                       |
| `payment_failed`          | Payment result page reached with non-success status (cp2)    | `routes/cp2.js` (new)                       |
| `purchase_flow_error`     | Unhandled exception in /purchase_flow handler                | `routes/cp2.js` (new, via captureException) |
| `bootstrap_started`       | Payment bootstrap initiated (cp2nus flow)                    | `routes/cp2nus.js` (new)                    |
| `bootstrap_succeeded`     | Payment bootstrap succeeded (cp2nus flow)                    | `routes/cp2nus.js` (new)                    |
| `bootstrap_failed`        | Payment bootstrap failed (cp2nus flow)                       | `routes/cp2nus.js` (new)                    |
| `payment_completed`       | Payment result page reached with success status (cp2nus)     | `routes/cp2nus.js` (new)                    |
| `payment_failed`          | Payment result page reached with non-success status (cp2nus) | `routes/cp2nus.js` (new)                    |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://eu.posthog.com/project/165245/dashboard/640036
- **Top-up conversion funnel** (`topup_command` → `payment_completed`): https://eu.posthog.com/project/165245/insights/CQv6MR3i
- **Payment outcomes over time** (completed vs failed, daily): https://eu.posthog.com/project/165245/insights/QK2t8QC9
- **Bot command usage** (weekly breakdown of /topup, /balance, /usage, /start): https://eu.posthog.com/project/165245/insights/HAXziISd
- **Bootstrap success rate** (started vs succeeded vs failed): https://eu.posthog.com/project/165245/insights/4ZQd0ADm
- **Error events over time** (all error categories in one view): https://eu.posthog.com/project/165245/insights/bBbJHND1

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
