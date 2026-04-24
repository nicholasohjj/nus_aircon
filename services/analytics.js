const { PostHog } = require("posthog-node");

const SERVER_URL = process.env.SERVER_URL || "";
const IS_LOCAL =
  process.env.NODE_ENV !== "production" ||
  SERVER_URL.includes("localhost") ||
  SERVER_URL.includes("127.0.0.1");

const posthog =
  !IS_LOCAL && process.env.POSTHOG_API_KEY
    ? new PostHog(process.env.POSTHOG_API_KEY, {
        host: process.env.POSTHOG_HOST || "https://eu.i.posthog.com",
        enableExceptionAutocapture: true,
      })
    : null;

function track(event, data = {}) {
  const { distinctId, chatId, meterId, ...properties } = data;

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
      analyticsSkipped: !posthog,
    }),
  );

  if (!posthog) return;

  posthog.capture({
    distinctId: String(distinctId || chatId || "anonymous"),
    event,
    properties: {
      ...properties,
      meterId,
      chatId,
    },
  });
}

function captureException(error, distinctId = "anonymous", properties = {}) {
  console.error(error);

  if (!posthog) return;

  posthog.captureException(error, String(distinctId), properties);
}

async function shutdownAnalytics() {
  if (posthog) {
    await posthog.shutdown();
  }
}

module.exports = {
  track,
  captureException,
  shutdownAnalytics,
  IS_LOCAL,
};
