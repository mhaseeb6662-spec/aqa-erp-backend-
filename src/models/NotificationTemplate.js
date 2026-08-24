const mongoose = require('mongoose');

const notificationTemplateSchema = new mongoose.Schema(
  {
    templateKey: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      enum: [
        'BOOKING_CONFIRMED',
        'PAYMENT_LINK',
        'PAYMENT_CONFIRMED',
        'PAYMENT_FAILED',
        'PAYMENT_REMINDER',
        'SESSION_REMINDER',
        'SCHEDULE_CHANGED',
        'CANCELLED',
        'CERTIFICATE_AVAILABLE',
        'REPORT_READY',
        'SYSTEM',
      ],
      required: true,
    },
    subject: {
      type: String,
      required: true,
      default: 'Aqua Fishing Academy Notification',
    },
    inAppBody: {
      type: String,
      required: true,
    },
    emailHtml: {
      type: String,
      default: '',
    },
    whatsAppTemplateName: {
      type: String,
      default: '',
    },
    whatsAppBody: {
      type: String,
      default: '',
    },
    supportedVariables: {
      type: [String],
      default: [
        'customerName',
        'studentName',
        'bookingNumber',
        'invoiceNumber',
        'receiptNumber',
        'programName',
        'branchName',
        'sessionDate',
        'sessionTime',
        'coachName',
        'amount',
        'paymentLink',
      ],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationTemplate', notificationTemplateSchema);
