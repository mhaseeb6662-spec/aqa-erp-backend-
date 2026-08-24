const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema(
  {
    incidentId: {
      type: String,
      unique: true,
      required: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule', // Or trip
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    staffInvolved: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    incidentType: {
      type: String, // Injury, Complaint, Delay, Equipment Issue, Safety Issue
      required: true,
    },
    severity: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
    },
    description: {
      type: String,
      required: true,
    },
    immediateAction: String,
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      enum: ['Open', 'Under Investigation', 'Resolved', 'Closed'],
      default: 'Open',
    },
    followUpRequired: Boolean,
    resolutionDetails: String,
    attachments: [String],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Incident', incidentSchema);
