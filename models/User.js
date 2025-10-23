const { Schema, model } = require('mongoose');
module.exports = model('User', new Schema({
  telegramId: { type: Number, unique: true },
  username: String,
  wallet: String,
  referralCode: String,
  referredBy: String,
  referrals: [Number],
  stage: { type: String, default: 'start' },
  totalEarned: { type: Number, default: 0 }
}));
