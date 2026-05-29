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
  }],
  roleStore: [{
    roleId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    description: { type: String, default: "" },
    isTemporary: { type: Boolean, default: false },
    durationMs: { type: Number, default: 0 },          // Duration of temporary role in milliseconds
    stock: { type: Number, default: -1 },               // -1 for unlimited
    saleExpiresAt: { type: Date, default: null }        // Shop removal date. Null if indefinite
  }]
}, { timestamps: true });

module.exports = mongoose.model('Guild', GuildSchema);
