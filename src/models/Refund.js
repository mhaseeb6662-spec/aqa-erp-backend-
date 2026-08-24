const mongoose = require('mongoose');

const refundSchema = new mongoose.Schema(
  {
    refundId: {
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
    amount: {
      type: Number,
      required: [true, 'Refund amount is required'],
      min: 0,
    },
    reason: {
      type: String,
      required: [true, 'Refund reason is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Processed', 'Rejected'],
      default: 'Processed',
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Refund', refundSchema);
