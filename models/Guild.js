const mongoose = require('mongoose');

const GuildSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true, index: true },
  prefix: { type: String },
  unbToken: { type: String },
  gameSettings: { type: Object, default: {} },
  roleStore: [{
    roleId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    priceMode: { type: String, default: 'FIXED' },     // FIXED or RENT
    description: { type: String, default: "" },
    isTemporary: { type: Boolean, default: false },
    durationMs: { type: Number, default: 0 },          // Duration of temporary role in milliseconds
    stock: { type: Number, default: -1 },               // -1 for unlimited
    saleExpiresAt: { type: Date, default: null }        // Shop removal date. Null if indefinite
  }]
}, { timestamps: true });

module.exports = mongoose.model('Guild', GuildSchema);
