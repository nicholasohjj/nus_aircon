<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of your project. PostHog was already comprehensively instrumented across `services/analytics.js`, `bot.js`, `routes/cp2.js`, and `routes/cp2nus.js`. The integration covers the full top-up funnel, bot command engagement, error capture via `captureException`, and graceful SDK shutdown on SIGINT/SIGTERM. Environment variables `POSTHOG_API_KEY` and `POSTHOG_HOST` were verified and updated in `.env`.

| Event                             | Description                                                         | File                                |
| --------------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `bot_start`                       | User starts the bot via /start (no deeplink)                        | `bot.js`                            |
| `bot_start_deeplink`              | User starts bot via deeplink with meter ID or hostel prefix         | `bot.js`                            |
| `topup_button`                    | User taps the Top Up keyboard button                                | `bot.js`                            |
| `topup_command`                   | User issues the /topup command                                      | `bot.js`                            |
| `topup_disabled_button`           | User taps Top Up while top-ups are disabled                         | `bot.js`                            |
| `topup_disabled_command`          | User issues /topup command while top-ups are disabled               | `bot.js`                            |
| `topup_disabled_deeplink`         | User arrives via deeplink while top-ups are disabled                | `bot.js`                            |
| `topup_disabled_existing_session` | User is mid-flow when top-ups get disabled                          | `bot.js`                            |
| `hostel_selected`                 | User selects a hostel (cp2 or cp2nus) during top-up flow            | `bot.js`                            |
| `amount_accepted`                 | User enters a valid top-up amount; payment button about to be shown | `bot.js`                            |
| `payment_button_shown`            | Payment button (or fallback URL) sent to the user                   | `bot.js`                            |
| `miniapp_closed_success`          | Telegram mini-app reports a successful top-up on close              | `bot.js`                            |
| `miniapp_closed_failed`           | Telegram mini-app reports a failed top-up on close                  | `bot.js`                            |
| `balance_button`                  | User taps the Balance keyboard button                               | `bot.js`                            |
| `balance_command`                 | User issues the /balance command                                    | `bot.js`                            |
| `balance_error`                   | Error occurred while fetching meter balance                         | `bot.js`                            |
| `usage_button`                    | User taps the Usage keyboard button                                 | `bot.js`                            |
| `usage_command`                   | User issues the /usage command                                      | `bot.js`                            |
| `usage_error`                     | Error occurred while fetching usage history                         | `bot.js`                            |
| `prefill_usage_error`             | Error prefilling meter usage during meter ID validation             | `bot.js`                            |
| `feedback_command`                | User issues the /feedback command                                   | `bot.js`                            |
| `feedback_submitted`              | User submits feedback with a star rating and optional message       | `bot.js`                            |
| `webapp_opened`                   | User opens the payment web app                                      | `routes/cp2.js`, `routes/cp2nus.js` |
| `bootstrap_started`               | Server begins the EVS purchase flow bootstrap                       | `routes/cp2.js`, `routes/cp2nus.js` |
| `bootstrap_succeeded`             | Bootstrap completed successfully; payment session created           | `routes/cp2.js`, `routes/cp2nus.js` |
| `bootstrap_failed`                | Bootstrap failed (invalid meter ID, bad amount, or upstream error)  | `routes/cp2.js`, `routes/cp2nus.js` |
| `payment_attempted`               | User submits card details; eNETS payment request being sent         | `routes/cp2.js`, `routes/cp2nus.js` |
| `payment_completed`               | Payment confirmed as successful by EVS/eNETS                        | `routes/cp2.js`, `routes/cp2nus.js` |
| `payment_failed`                  | Payment confirmed as failed by EVS/eNETS                            | `routes/cp2.js`, `routes/cp2nus.js` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events instrumented:

- **Dashboard - Analytics basics**: https://eu.posthog.com/project/165245/dashboard/667693
- **Top-Up Conversion Funnel** (topup_button -> hostel_selected -> amount_accepted -> payment_attempted -> payment_completed): https://eu.posthog.com/project/165245/insights/aXYl4v9A
- **Payment Success vs Failure Rate** (daily trend of completed vs failed payments): https://eu.posthog.com/project/165245/insights/4VHpgELt
- **Daily Active Users** (bot_start, topup_button, balance_button unique users per day): https://eu.posthog.com/project/165245/insights/gwzPI8NR
- **Bootstrap Success vs Failure** (upstream EVS/eNETS reliability monitor): https://eu.posthog.com/project/165245/insights/KqpsxifB
- **Top Feature Usage** (weekly bar chart of top-up, balance, usage, and feedback): https://eu.posthog.com/project/165245/insights/lYgEOFk1

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
