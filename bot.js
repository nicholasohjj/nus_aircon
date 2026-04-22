require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
console.log('🚀 SERVER_URL =', SERVER_URL);
if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN env var is required');

const bot = new Telegraf(TOKEN);

function isHttpsUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidMeterId(value) {
  return /^\d{8}$/.test(String(value).trim());
}

const HOSTELS = {
  UTOWN: 'utown_rc',
  RVRC: 'rvrc',
};

// In-memory session store: { chatId -> { stage, hostel, txtMtrId, txtAmount } }
const sessions = {};

function getSession(chatId) {
  if (!sessions[chatId]) sessions[chatId] = { stage: 'idle' };
  return sessions[chatId];
}

function resetSession(chatId) {
  sessions[chatId] = { stage: 'idle' };
}

function mainKeyboard() {
  return Markup.keyboard([
    ['⚡ Top Up']
  ]).resize();
}

function hostelKeyboard() {
  return Markup.keyboard([
    ['🏠 U-Town RCs (cp2)', '🏠 RVRC (WIP)'],
    ['❌ Cancel']
  ]).resize();
}

function startTopUp(chatId) {
  resetSession(chatId);
  const session = getSession(chatId);
  session.stage = 'awaiting_hostel';
  return session;
}

function getWebAppPath(hostel) {
  return hostel === HOSTELS.RVRC ? '/webapp/new' : '/webapp';
}

async function setupTelegramUi() {
  await bot.telegram.setMyCommands([
    { command: 'topup', description: 'Start electricity top-up' },
    { command: 'cancel', description: 'Cancel current flow' }
  ]);
}

bot.hears('⚡ Top Up', async ctx => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  startTopUp(chatId);
  return ctx.reply(
    '🏠 Please select your hostel:',
    hostelKeyboard()
  );
});

bot.start(async ctx => {
  const chatId = ctx.chat?.id;
  if (chatId) resetSession(chatId);

  return ctx.reply(
    '⚡ EVS Electricity Top-Up\n\nChoose an option below or use /topup.',
    mainKeyboard()
  );
});

bot.command('topup', async ctx => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  startTopUp(chatId);
  return ctx.reply(
    '🏠 Please select your hostel:',
    hostelKeyboard()
  );
});

bot.command('cancel', async ctx => {
  const chatId = ctx.chat?.id;
  if (chatId) resetSession(chatId);
  return ctx.reply('❌ Top-up cancelled. Use /topup to start again.', mainKeyboard());
});

bot.hears('❌ Cancel', async ctx => {
  const chatId = ctx.chat?.id;
  if (chatId) resetSession(chatId);
  return ctx.reply('❌ Top-up cancelled. Use /topup to start again.', mainKeyboard());
});

bot.on('text', async ctx => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = String(ctx.message?.text || '').trim();
  if (!text || text.startsWith('/')) return;

  const session = getSession(chatId);

  if (session.stage === 'awaiting_hostel') {
    if (text === '🏠 U-Town RCs (cp2)') {
      session.hostel = HOSTELS.UTOWN;
      session.stage = 'awaiting_meter_id';
      return ctx.reply('🔌 Please enter your 8-digit Meter ID:', mainKeyboard());
    }

    if (text === '🏠 RVRC (WIP)') {
      session.hostel = HOSTELS.RVRC;
      session.stage = 'awaiting_meter_id';
      return ctx.reply('🔌 Please enter your 8-digit Meter ID:', mainKeyboard());
    }

    return ctx.reply(
      '⚠️ Please choose either U-Town RCs if you use cp2.evs.com.sg or RVRC if you use cp2nus.evs.com.sg.',
      hostelKeyboard()
    );
  }

  if (session.stage === 'awaiting_meter_id') {
    if (!isValidMeterId(text)) {
      return ctx.reply('⚠️ Invalid Meter ID. Please try again.');
    }

    session.txtMtrId = text;
    session.stage = 'awaiting_amount';

    return ctx.replyWithMarkdown(
        `✅ Meter ID: \`${text}\`\n\nNow enter the *amount in SGD* (e.g. \`20\` for $20.00, min $6, max $50):`
    );
  }

  if (session.stage === 'awaiting_amount') {
    const amt = Number(text);

    if (!Number.isFinite(amt) || amt < 6 || amt > 50) {
        return ctx.reply('⚠️ Please enter a valid amount between $6 and $50.');
      }

    const amountDollars = Number(amt.toFixed(2));
    const amountCents = Math.round(amountDollars * 100);

    session.amountDollars = amountDollars;
    session.amountCents = amountCents;
    session.stage = 'idle';

    const webAppPath = getWebAppPath(session.hostel);
    const webAppUrl =
      `${SERVER_URL}${webAppPath}?txtMtrId=${encodeURIComponent(session.txtMtrId)}` +
      `&txtAmount=${encodeURIComponent(session.amountDollars)}`;
    console.log('🌐 WebApp URL =', webAppUrl);
    const hostelLabel =
      session.hostel === HOSTELS.RVRC ? 'RVRC/cp2nus (WIP)' : 'U-Town RCs (cp2)';

    if (!isHttpsUrl(SERVER_URL)) {
      await ctx.replyWithMarkdown(
        `📋 *Order Summary*\n\n` +
          `🏠 Hostel: *${hostelLabel}*\n` +
          `🔌 Meter ID: \`${session.txtMtrId}\`\n` +
          `💵 Amount: $${amountDollars.toFixed(2)} SGD\n\n` +
          `Your \`SERVER_URL\` is \`${SERVER_URL}\`.\n` +
          `Telegram WebApp buttons require *HTTPS*, so I can’t open the WebApp inside Telegram on localhost.\n\n` +
          `Open the payment page in your browser instead:`,
        Markup.inlineKeyboard([
          Markup.button.url('🌐 Open Payment Page', webAppUrl)
        ])
      );

      return ctx.replyWithMarkdown(
        `For in-Telegram WebApp support, expose your server over HTTPS and set:\n\n` +
          `\`SERVER_URL=https://<your-tunnel-host>\`\n\n` +
          `then restart the bot.`
      );
    }

    return ctx.replyWithMarkdown(
      `📋 *Order Summary*\n\n` +
        `🏠 Hostel: *${hostelLabel}*\n` +
        `🔌 Meter ID: \`${session.txtMtrId}\`\n` +
        `💵 Amount: $${amountDollars.toFixed(2)} SGD\n\n` +
        `Tap below to proceed to payment:`,
      Markup.inlineKeyboard([
        Markup.button.webApp('💳 Pay Now', webAppUrl),
      ])
    );
  }

  return ctx.reply('Use /topup to start a top up.', mainKeyboard());
});

(async () => {
  await setupTelegramUi();
  await bot.launch();
  console.log('🤖 EVS Telegram bot running...');
})();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

bot.catch((err, ctx) => {
  console.error('Telegram bot error', err);
  if (ctx?.chat?.id) {
    ctx.reply('⚠️ Bot error: ' + (err?.message || String(err))).catch(() => {});
  }
});