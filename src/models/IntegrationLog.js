const mongoose = require('mongoose');

const integrationLogSchema = new mongoose.Schema(
  {
    correlationId: {
      type: String,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      enum: [
        'payment_gateway',
        'meta_leads',
        'google_leads',
        'whatsapp',
        'email',
        'accounting',
        'google_calendar',
      ],
      index: true,
    },
    event: {
      type: String,
      required: true,
    },
    direction: {
      type: String,
      enum: ['INBOUND', 'OUTBOUND'],
      required: true,
    },
    externalId: {
      type: String,
      default: null,
      index: true,
    },
    internalRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    internalRecordType: {
      type: String,
      enum: ['Lead', 'Booking', 'Invoice', 'PaymentTransaction', 'Schedule', 'Customer', 'User', 'Other'],
      default: 'Other',
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'RETRY_SCHEDULED', 'IGNORED_DUPLICATE'],
      required: true,
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 1,
    },
    requestPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    responsePayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('IntegrationLog', integrationLogSchema);
