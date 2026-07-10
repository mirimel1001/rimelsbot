const mongoose = require('mongoose');

const CommandSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  aliases: [{ type: String }],
  usage: { type: String },
  description: { type: String },
  category: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('Command', CommandSchema);
