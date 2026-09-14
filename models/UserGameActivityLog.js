const mongoose = require('mongoose');

const UserGameActivityLogSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  username: { type: String, required: true },
  displayName: { type: String },
  avatarUrl: { type: String },
  gameName: { type: String, required: true, index: true },
  state: { type: String, default: "" },
  recordedAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// Auto-delete records older than 7 days using MongoDB TTL index
UserGameActivityLogSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.models.UserGameActivityLog || mongoose.model('UserGameActivityLog', UserGameActivityLogSchema);
