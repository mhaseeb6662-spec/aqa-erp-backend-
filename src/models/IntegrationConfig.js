const mongoose = require('mongoose');

const integrationConfigSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      required: true,
      unique: true,
      enum: [
        'payment_gateway',
        'meta_leads',
        'google_leads',
        'whatsapp',
        'email',
        'accounting',
        'google_calendar',
      ],
    },
    providerName: {
      type: String,
      required: true,
      default: 'Generic Provider',
    },
    status: {
      type: String,
      enum: [
        'CONNECTED',
        'DISCONNECTED',
        'NEEDS_CONFIGURATION',
        'ERROR',
        'WAITING_FOR_CREDENTIALS',
      ],
      default: 'WAITING_FOR_CREDENTIALS',
    },
    environment: {
      type: String,
      enum: ['TEST', 'LIVE'],
      default: 'TEST',
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
    webhookUrl: {
      type: String,
      default: '',
    },
    configMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastSuccessfulSync: {
      type: Date,
      default: null,
    },
    lastFailedSync: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    lastWebhookReceivedAt: {
      type: Date,
      default: null,
    },
    totalEventsProcessed: {
      type: Number,
      default: 0,
    },
    totalErrors: {
      type: Number,
      default: 0,
    },
    connectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    connectedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('IntegrationConfig', integrationConfigSchema);
