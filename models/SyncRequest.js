const mongoose = require('mongoose');

const SyncRequestSchema = new mongoose.Schema({
  requestedAt: { type: Date, default: Date.now, required: true, index: true },
  status: { 
    type: String, 
    enum: ['pending', 'processing', 'completed', 'failed'], 
    default: 'pending',
    required: true 
  },
  processedAt: { type: Date },
  error: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('SyncRequest', SyncRequestSchema);
