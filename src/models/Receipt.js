const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema(
  {
    receiptNumber: {
      type: String,
      unique: true,
      required: true,
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentTransaction',
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
    amountPaid: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentMethod: {
      type: String,
      default: 'Credit Card',
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      default: 'Official Payment Receipt - Aqua Fishing Academy',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Receipt', receiptSchema);
