const mongoose = require('mongoose');

const UpdateSchema = new mongoose.Schema({
  version: { type: String, required: true, unique: true },
  date: { type: String, required: true },
  title: { type: String, required: true },
  items: [{ type: String }]
}, { timestamps: true });

module.exports = mongoose.model('Update', UpdateSchema);
