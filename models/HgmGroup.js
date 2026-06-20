const mongoose = require('mongoose');

const HgmGroupSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  displayName: { type: String, required: true },
  username: { type: String, required: true },
  mention: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('HgmGroup', HgmGroupSchema);
