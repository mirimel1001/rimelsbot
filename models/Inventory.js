const mongoose = require('mongoose');

const InventorySchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  roles: [{
    roleId: { type: String, required: true },
    name: { type: String, required: true },
    purchasedAt: { type: Date, default: Date.now },
    isTemporary: { type: Boolean, default: false },
    durationMs: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },         // Starts when role is equipped
    isUsed: { type: Boolean, default: false },         // Currently active on Discord
    assignedTo: { type: String, default: null }        // User ID of wearer (self or a friend)
  }]
}, { timestamps: true });

// Compound index to guarantee uniqueness per user per guild
InventorySchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Inventory', InventorySchema);
