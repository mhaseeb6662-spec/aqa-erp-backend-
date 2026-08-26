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
      enum: ['Credit Card', 'Debit Card', 'Stripe Gateway', 'PayPal', 'Bank Transfer', 'Cash', 'Apple Pay', 'Google Pay', 'Online Gateway'],
      default: 'Credit Card',
    },
    status: {
      type: String,
      enum: ['Completed', 'Pending', 'Failed', 'Refunded', 'Partially Refunded'],
      default: 'Completed',
    },
    gatewayReference: {
      type: String,
      default: '',
    },
    cardLast4: {
      type: String,
      default: '4242',
    },
    paidAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      default: 'Online payment processed successfully.',
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
