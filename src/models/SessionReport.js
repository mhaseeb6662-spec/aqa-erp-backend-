const mongoose = require('mongoose');

const sessionReportSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule',
      required: true,
    },
    coach: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    deliveryStatus: {
      type: String,
      enum: ['Completed', 'Partial', 'Cancelled', 'Weather Delay'],
      default: 'Completed',
    },
    summary: {
      type: String,
      required: [true, 'Session summary is required'],
    },
    attendanceCompleted: {
      type: Boolean,
      default: true,
    },
    studentObservations: {
      type: String,
      default: 'Students engaged well with practical fishing drills.',
    },
    safetyIncidents: {
      type: String,
      default: 'No safety incidents reported.',
    },
    followUpRequired: {
      type: Boolean,
      default: false,
    },
    upsellOpportunity: {
      type: String,
      default: 'Recommended Advanced Deep Sea Expedition for top performers.',
    },
    remarks: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SessionReport', sessionReportSchema);
