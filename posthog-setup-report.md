<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of your project. The project already had extensive PostHog tracking in place via `services/analytics.js`, covering payment flows, bot commands, and error capture across `bot.js`, `routes/cp2.js`, and `routes/cp2nus.js`. The one remaining gap — the global Express error handler in `app.js` — was instrumented so that any unhandled server errors are now captured via `captureException`. Environment variables `POSTHOG_API_KEY` and `POSTHOG_HOST` were verified and updated in `.env`.

| Event                    | Description                                                                                                              | File                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| `server_error`           | Captured via `captureException` in the global Express error handler whenever an unhandled error propagates to middleware | `app.js`                            |
| `webapp_opened`          | User opens the payment WebApp (already instrumented)                                                                     | `routes/cp2.js`, `routes/cp2nus.js` |
| `bootstrap_started`      | Payment bootstrap flow begins (already instrumented)                                                                     | `routes/cp2.js`, `routes/cp2nus.js` |
| `bootstrap_succeeded`    | Bootstrap completes successfully (already instrumented)                                                                  | `routes/cp2.js`, `routes/cp2nus.js` |
| `bootstrap_failed`       | Bootstrap fails with an error or invalid input (already instrumented)                                                    | `routes/cp2.js`, `routes/cp2nus.js` |
| `payment_attempted`      | User submits card data to eNETS (already instrumented)                                                                   | `routes/cp2.js`, `routes/cp2nus.js` |
| `payment_completed`      | Payment confirmed as successful (already instrumented)                                                                   | `routes/cp2.js`, `routes/cp2nus.js` |
| `payment_failed`         | Payment confirmed as failed (already instrumented)                                                                       | `routes/cp2.js`, `routes/cp2nus.js` |
| `bot_start`              | User starts the Telegram bot (already instrumented)                                                                      | `bot.js`                            |
| `topup_command`          | User issues /topup command (already instrumented)                                                                        | `bot.js`                            |
| `balance_command`        | User issues /balance command (already instrumented)                                                                      | `bot.js`                            |
| `usage_command`          | User issues /usage command (already instrumented)                                                                        | `bot.js`                            |
| `feedback_command`       | User issues /feedback command (already instrumented)                                                                     | `bot.js`                            |
| `feedback_submitted`     | User submits a star rating and optional message (already instrumented)                                                   | `bot.js`                            |
| `amount_accepted`        | User enters a valid top-up amount (already instrumented)                                                                 | `bot.js`                            |
| `hostel_selected`        | User selects a hostel (cp2 or cp2nus) (already instrumented)                                                             | `bot.js`                            |
| `miniapp_closed_success` | Telegram mini-app closes after a successful payment (already instrumented)                                               | `bot.js`                            |
| `miniapp_closed_failed`  | Telegram mini-app closes after a failed payment (already instrumented)                                                   | `bot.js`                            |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://eu.posthog.com/project/165245/dashboard/653720
- **Payment conversion funnel** (webapp opened → bootstrap succeeded → payment attempted → payment completed): https://eu.posthog.com/project/165245/insights/v1dyyLwp
- **Payment outcomes over time** (completed vs failed, daily): https://eu.posthog.com/project/165245/insights/NXzv4OCj
- **Bootstrap success rate** (started vs succeeded vs failed): https://eu.posthog.com/project/165245/insights/gmsR7FPZ
- **Bot command engagement** (top-up, balance, usage, feedback command frequency): https://eu.posthog.com/project/165245/insights/j8zAQ7vt
- **New bot users over time** (daily active users on bot_start): https://eu.posthog.com/project/165245/insights/eRoeuK0D

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
