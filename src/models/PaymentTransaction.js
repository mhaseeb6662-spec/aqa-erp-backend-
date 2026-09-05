const mongoose = require('mongoose');

const paymentTransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
      required: true,
    },
    invoice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: [true, 'Payment amount is required'],
      min: 0,
    },
    paymentMethod: {
      type: String,
      enum: ['Credit Card', 'Debit Card', 'Physical Card / POS Machine', 'Cash', 'Bank Transfer', 'Online Payment', 'Stripe Gateway', 'PayPal', 'Apple Pay', 'Google Pay', 'Online Gateway', 'Tabby', 'PayTabs', 'TotalPay'],
      default: 'Credit Card',
    },
    status: {
      type: String,
      enum: ['Completed', 'Pending', 'Failed', 'Refunded', 'Partially Refunded'],
      default: 'Completed',
    },
    approvalCode: {
      type: String,
      default: '',
    },
    provider: {
      type: String,
      enum: ['Manual', 'Tabby', 'PayTabs', 'TotalPay', 'Stripe', 'Other'],
      default: 'Manual',
    },
    providerSessionId: {
      type: String,
      default: '',
    },
    currency: {
      type: String,
      default: 'AED',
    },
    failureReason: {
      type: String,
      default: '',
    },
    gatewayReference: {
      type: String,
      default: '',
    },
    cardLast4: {
      type: String,
      default: '4242',
    },
    evidenceUrl: {
      type: String,
      default: '',
    },
    evidenceMetadata: {
      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
      },
      uploadedAt: {
        type: Date,
        default: null,
      },
      fileName: {
        type: String,
        default: '',
      },
      mimeType: {
        type: String,
        default: '',
      },
      fileSize: {
        type: Number,
        default: 0,
      },
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      default: 'Payment processed successfully.',
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PaymentTransaction', paymentTransactionSchema);
