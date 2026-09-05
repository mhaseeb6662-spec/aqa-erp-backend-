const mongoose = require('mongoose');

const refundAuditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: ['REFUND_REQUESTED', 'REFUND_COMPLETED', 'REFUND_FAILED', 'INVOICE_STATUS_UPDATED', 'STUDENT_REFUND_NOTIFICATION_CREATED'],
  },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  refund: { type: mongoose.Schema.Types.ObjectId, ref: 'Refund', default: null },
  payment: { type: mongoose.Schema.Types.ObjectId, ref: 'PaymentTransaction', default: null },
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  amount: { type: Number, default: 0 },
  oldStatus: { type: String, default: '' },
  newStatus: { type: String, default: '' },
  providerReference: { type: String, default: '' },
  notes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('RefundAuditLog', refundAuditLogSchema);
