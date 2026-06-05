const mongoose = require('mongoose');

const NameGuesserLogSchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  channelId: { type: String, required: true, index: true },
  hostId: { type: String, required: true },
  hostName: { type: String, required: true },
  status: { type: String, enum: ['RUNNING', 'ENDED'], default: 'RUNNING' },
  prize: { type: Number, default: 0 },
  players: [{
    id: { type: String, required: true },
    name: { type: String, required: true },
    assignedName: { type: String, required: true },
    ranked: { type: Number, default: null }
  }],
  history: [{
    type: { type: String, required: true }, // 'QUESTION' or 'GUESS'
    player: { type: String, required: true },
    playerId: { type: String, required: true },
    text: { type: String, required: true },
    majority: { type: String },
    host: { type: String },
    result: { type: String },
    timestamp: { type: Date, default: Date.now }
  }],
  endedAt: { type: Date, default: null, index: { expires: 1800 } } // Expires 30 minutes after endedAt is set
}, { timestamps: true });

module.exports = mongoose.model('NameGuesserLog', NameGuesserLogSchema);
