const mongoose = require('mongoose');

const GuildSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  prefix: { type: String },
  unbToken: { type: String },
  gameSettings: { type: Object, default: {} },
  activityRoles: [{
    id: String,
    roleId: String,
    name: String,
    req_msgs: Number,
    logChannel: { type: String, default: 'same' },
    adminLogChannel: { type: String, default: null },
    deleteLog: { type: Boolean, default: false },
    deleteTime: { type: Number, default: 60 },
    customMessage: { type: String, default: null }
  }]
}, { timestamps: true });

module.exports = mongoose.model('Guild', GuildSchema);
