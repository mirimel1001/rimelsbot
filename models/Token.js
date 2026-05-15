const mongoose = require('mongoose');

const TokenSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  token: { type: String, required: true }
});

module.exports = mongoose.model('Token', TokenSchema);
