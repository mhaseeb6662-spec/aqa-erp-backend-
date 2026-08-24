const mongoose = require('mongoose');

const safetyChecklistSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule',
      required: true,
    },
    vessel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vessel',
    },
    checkedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    checks: [
      {
        item: String, // e.g., 'Life Jackets', 'First Aid'
        status: { type: String, enum: ['Pass', 'Fail', 'N/A'] },
        notes: String,
      },
    ],
    overallStatus: {
      type: String,
      enum: ['Passed', 'Failed'],
      required: true,
    },
    exceptions: String,
    weatherCondition: String, // e.g., 'Sunny', 'Rainy'
    wind: String,
    seaState: String,
    waveConditions: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('SafetyChecklist', safetyChecklistSchema);
