const mongoose = require('mongoose');
const crypto = require('crypto');
const { PAYMENT_STATUSES } = require('../config/crm.constants');

const paymentLinkSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: [1, 'Amount must be greater than 0'],
    },
    description: {
      type: String,
      trim: true,
      required: [true, 'Description is required'],
    },
    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      default: 'pending',
    },
    token: {
      type: String,
      unique: true,
      default: () => crypto.randomBytes(12).toString('hex'),
    },
    url: {
      type: String,
      default: '',
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    paidAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// Builds the shareable payment URL from the token. A real payment-gateway
// integration (Stripe/JazzCash/Easypaisa/etc.) can replace this base URL
// in a later phase without touching the rest of the CRM.
paymentLinkSchema.pre('save', function buildUrl(next) {
  if (!this.url) {
    const base = process.env.PAYMENT_LINK_BASE_URL || 'https://pay.aquafishingacademy.com/l';
    this.url = `${base}/${this.token}`;
  }
  next();
});

// Lazily flips a still-"pending" link to "expired" once its expiry date has passed.
paymentLinkSchema.methods.applyExpiryIfNeeded = function applyExpiryIfNeeded() {
  if (this.status === 'pending' && this.expiresAt && this.expiresAt < new Date()) {
    this.status = 'expired';
    return true;
  }
  return false;
};

module.exports = mongoose.model('PaymentLink', paymentLinkSchema);
