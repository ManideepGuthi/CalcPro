const mongoose = require('mongoose');

const historySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expression: { type: String, required: true },
    result: { type: Number, required: true },
    steps: { type: [String], default: [] }
  },
  { timestamps: true }
);

module.exports = mongoose.model('History', historySchema);


