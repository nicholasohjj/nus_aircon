const { mainKeyboard } = require("../constants");

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

function helpText() {
  return (
    `ℹ️ *EVS Top-Up Help*\n\n` +
    `*Supported hostels*\n` +
    `• PGPR\n` +
    `• Houses @ PGP\n` +
    `• Residential Colleges\n` +
    `• NUS College\n` +
    `  → uses cp2.evs.com.sg\n` +
    `• UTown Residence\n` +
    `• RVRC\n` +
    `  → uses cp2nus.evs.com.sg\n\n` +
    `*Accepted amount*\n` +
    `• Minimum: $6.00 SGD\n` +
    `• Maximum: $50.00 SGD\n\n` +
    `*Useful commands*\n` +
    `• /topup — start a new top-up\n` +
    `• /balance — check meter balance\n` +
    `• /usage — show last 7 days of daily consumption,\n` +
    `  estimated days remaining, and current balance\n` +
    `• /feedback — share feedback or report an issue\n` +
    `• /forget — clear your saved Meter ID and hostel\n` +
    `• /cancel — cancel the current flow\n` +
    `• /help — show this message`
  );
}

async function sendHelp(ctx) {
  return ctx.replyWithMarkdown(helpText(), mainKeyboard);
}

async function setupTelegramUi(bot) {
  await bot.telegram.setMyCommands([
    { command: "topup", description: "Start electricity top-up" },
    { command: "balance", description: "Check meter balance" },
    { command: "usage", description: "Show recent daily usage" },
    { command: "forget", description: "Clear your saved Meter ID" },
    { command: "feedback", description: "Share feedback or report an issue" },
    { command: "help", description: "Show help and usage" },
    { command: "cancel", description: "Cancel current flow" },
  ]);
}

module.exports = { helpText, sendHelp, setupTelegramUi, SERVER_URL };
