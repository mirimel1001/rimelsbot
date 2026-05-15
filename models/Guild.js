const mongoose = require('mongoose');

const GuildSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  prefix: { type: String },
  unbToken: { type: String },
  gameSettings: { type: Object, default: {} },
  activityRoles: { type: Array, default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Guild', GuildSchema);
