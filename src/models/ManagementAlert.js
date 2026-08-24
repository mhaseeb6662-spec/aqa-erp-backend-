const mongoose = require('mongoose');

const managementAlertSchema = new mongoose.Schema(
  {
    alertId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    alertType: {
      type: String,
      enum: [
        'Conversion Drop',
        'High Outstanding Dues',
        'Low Capacity Utilization',
        'Coach License Expiry',
        'Vessel Downtime',
        'Low Equipment Stock',
        'Lead Response SLA Breach',
        'Safety Incident',
        'High Cancellation Rate',
        'Other'
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ['Low', 'Medium', 'High', 'Critical'],
      default: 'Medium',
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    metricValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    thresholdValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },
    status: {
      type: String,
      enum: ['New', 'Acknowledged', 'Resolved'],
      default: 'New',
    },
    acknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
    resolutionNotes: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ManagementAlert', managementAlertSchema);
