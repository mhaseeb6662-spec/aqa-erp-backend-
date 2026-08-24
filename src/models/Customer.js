const mongoose = require('mongoose');
const { LEAD_SOURCES } = require('../config/crm.constants');

// Customers are created automatically when a Lead converts. They keep a
// reference back to the originating lead so full history can be traced.
const customerSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    source: {
      type: String,
      enum: LEAD_SOURCES,
      default: 'Other',
    },
    interestedIn: {
      type: String,
      trim: true,
      default: '',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    originalLead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    conversionNote: {
      type: String,
      trim: true,
      default: '',
    },
    convertedAt: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

customerSchema.index({ fullName: 'text', phone: 'text', email: 'text' });
customerSchema.index({ assignedTo: 1 });

module.exports = mongoose.model('Customer', customerSchema);
