const mongoose = require('mongoose');

const ServerGameRegistrySchema = new mongoose.Schema({
  gameName: { type: String, required: true, unique: true, index: true },
  genreTag: { type: String, default: 'Gaming' },
  bannerUrl: { type: String, default: null },
  firstSeenAt: { type: Date, default: Date.now },
  lastPlayedAt: { type: Date, default: Date.now, index: true },
  totalSessions: { type: Number, default: 1 }
}, { timestamps: true });

module.exports = mongoose.models.ServerGameRegistry || mongoose.model('ServerGameRegistry', ServerGameRegistrySchema);
