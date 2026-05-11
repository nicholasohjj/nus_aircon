<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of your project. The project already had extensive PostHog event tracking in place. This session added three supplemental capabilities:

1. **User identification** — Added an `identify()` helper to `services/analytics.js` that calls `posthog.identify()` to set person profiles. Called in `bot/handlers/webAppData.js` after a successful payment, persisting `hostel`, `meterId`, and `last_payment_at` as person properties.

2. **Top-up toggle tracking** — Added `topup_toggled` event to `bot/commands/owner.js` when the owner runs `/topupon` or `/topupoff`, including an `enabled` boolean so maintenance windows can be correlated with payment drops.

3. **Cancellation tracking** — Added `topup_cancelled` event to `bot/handlers/buttons.js` when users tap the Cancel button, enabling funnel drop-off analysis.

Environment variables `POSTHOG_API_KEY` and `POSTHOG_HOST` were confirmed and updated in `.env`.

| Event                                                                                     | Description                                                                     | File                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| `identify` (new helper)                                                                   | Sets person properties (hostel, meterId, last_payment_at) on successful payment | `services/analytics.js`             |
| identify call                                                                             | Called on successful miniapp payment closure                                    | `bot/handlers/webAppData.js`        |
| `topup_toggled`                                                                           | Owner enabled or disabled top-ups via /topupon or /topupoff                     | `bot/commands/owner.js`             |
| `topup_cancelled`                                                                         | User tapped Cancel button during top-up flow                                    | `bot/handlers/buttons.js`           |
| `webapp_opened`                                                                           | User opens the payment web app                                                  | `routes/cp2.js`, `routes/cp2nus.js` |
| `bootstrap_started`                                                                       | Server begins the EVS purchase flow bootstrap                                   | `routes/cp2.js`, `routes/cp2nus.js` |
| `bootstrap_succeeded`                                                                     | Bootstrap completed successfully; payment session created                       | `routes/cp2.js`, `routes/cp2nus.js` |
| `bootstrap_failed`                                                                        | Bootstrap failed (invalid meter ID, bad amount, or upstream error)              | `routes/cp2.js`, `routes/cp2nus.js` |
| `payment_attempted`                                                                       | User submits card details; eNETS payment request being sent                     | `routes/cp2.js`, `routes/cp2nus.js` |
| `payment_completed`                                                                       | Payment confirmed as successful by EVS/eNETS                                    | `routes/cp2.js`, `routes/cp2nus.js` |
| `payment_failed`                                                                          | Payment confirmed as failed by EVS/eNETS                                        | `routes/cp2.js`, `routes/cp2nus.js` |
| `miniapp_closed_success`                                                                  | Telegram mini-app reports a successful top-up on close                          | `bot/handlers/webAppData.js`        |
| `miniapp_closed_failed`                                                                   | Telegram mini-app reports a failed top-up on close                              | `bot/handlers/webAppData.js`        |
| `bot_start`, `bot_start_deeplink`                                                         | User starts the bot                                                             | `bot/commands/user.js`              |
| `topup_command`, `balance_command`, `usage_command`, `forget_command`, `feedback_command` | User issues bot commands                                                        | `bot/commands/user.js`              |
| `feedback_submitted`                                                                      | User submits feedback with a star rating                                        | `bot/handlers/text.js`              |
| `amount_accepted`, `payment_button_shown`                                                 | Amount entered and payment button shown                                         | `bot/handlers/text.js`              |
| `topup_button`, `balance_button`, `usage_button`                                          | User taps keyboard buttons                                                      | `bot/handlers/buttons.js`           |
| `hostel_selected`                                                                         | User selects a hostel during top-up flow                                        | `bot/handlers/actions.js`           |
| `topup_disabled_*`                                                                        | Various disabled top-up events                                                  | Multiple files                      |
| `prefill_usage_error`                                                                     | Error prefilling meter usage during validation                                  | `bot/handlers/text.js`              |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://eu.posthog.com/project/165245/dashboard/672807
- **Payment Conversion Funnel** (webapp open → bootstrap → payment attempt → payment complete): https://eu.posthog.com/project/165245/insights/kTlIpMvu
- **Payment Outcomes Over Time** (completed vs failed daily trend): https://eu.posthog.com/project/165245/insights/cOed9rmE
- **Bootstrap Success vs Failure** (meter lookup + eNETS setup reliability): https://eu.posthog.com/project/165245/insights/336eG07I
- **Churn Signals** (cancellations + disabled top-up encounters): https://eu.posthog.com/project/165245/insights/nnExAAVY
- **Bot User Engagement** (DAU across start, top-up, balance, feedback): https://eu.posthog.com/project/165245/insights/21YPTLza

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
