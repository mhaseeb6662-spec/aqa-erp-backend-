const mongoose = require('mongoose');

const scheduledReminderSchema = new mongoose.Schema(
  {
    reminderType: {
      type: String,
      enum: [
        'session_reminder',
        'payment_due_reminder',
        'payment_overdue_reminder',
        'report_schedule',
        'certification_expiry',
      ],
      required: true,
      index: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    targetDate: {
      type: Date,
      required: true,
      index: true,
    },
    recordId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    recordType: {
      type: String,
      enum: ['Schedule', 'Invoice', 'Booking', 'User', 'CoachCertification'],
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    channels: {
      type: [String],
      enum: ['in_app', 'email', 'whatsapp'],
      default: ['in_app', 'email', 'whatsapp'],
    },
    status: {
      type: String,
      enum: ['PENDING', 'EXECUTED', 'CANCELLED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    executedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScheduledReminder', scheduledReminderSchema);
