const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  item: { type: String, trim: true, default: '' },
  description: { type: String, default: '', trim: true },
  quantity: { type: Number, default: 1, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  amount: { type: Number, required: true, min: 0 },
  discount: {
    type: { type: String, enum: ['fixed', 'percentage'], default: 'fixed' },
    value: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
  },
  validity: { type: Date, default: null },
  taxRate: { type: Number, default: 0 },
  taxAmount: { type: Number, default: 0 },
  program: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Program',
    default: null,
  },
});

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      unique: true,
      required: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Customer reference is required'],
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    invoicedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Program',
      default: null,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },
    lineItems: [lineItemSchema],
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    totalExcludingTax: {
      type: Number,
      default: 0,
    },
    taxRate: {
      type: Number,
      default: 5, // 5% tax default
    },
    taxAmount: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    coupon: {
      code: { type: String, default: '' },
      discountAmount: { type: Number, default: 0 },
    },
    roundingAdjustment: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    amountRefunded: {
      type: Number,
      default: 0,
      min: 0,
    },
    balanceDue: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['Draft', 'Sent', 'Paid', 'Partially Paid', 'Overdue', 'Cancelled', 'Refunded', 'Partially Refunded'],
      default: 'Sent',
    },
    dueDate: {
      type: Date,
      required: true,
    },
    issuedDate: {
      type: Date,
      default: Date.now,
    },
    paymentTerms: {
      type: String,
      default: 'Net 15 Days',
    },
    notes: {
      type: String,
      default: 'Thank you for choosing Aqua Fishing Academy.',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

invoiceSchema.index({ customer: 1, student: 1, status: 1 });
invoiceSchema.index({ branch: 1, status: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
