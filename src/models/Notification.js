const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentTransaction',
      default: null,
    },
    schedule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule',
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: [
        'booking_confirmed',
        'payment_confirmed',
        'payment_failed',
        'payment_reminder',
        'session_reminder',
        'schedule_changed',
        'cancellation',
        'announcement',
        'certificate_available',
        'report_ready',
        'document_status',
        'booking_alert',
        'schedule_change',
        'system',
      ],
      default: 'system',
      index: true,
    },
    channels: {
      type: [String],
      enum: ['in_app', 'email', 'whatsapp'],
      default: ['in_app'],
    },
    status: {
      type: String,
      enum: ['PENDING', 'SCHEDULED', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED'],
      default: 'SENT',
      index: true,
    },
    link: {
      type: String,
      default: '',
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    providerMessageId: {
      type: String,
      default: null,
    },
    scheduledFor: {
      type: Date,
      default: null,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    readAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Notification', notificationSchema);
