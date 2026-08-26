const mongoose = require('mongoose');
const { LEAD_SOURCES } = require('../config/crm.constants');

// Customers are created automatically when a Lead converts. They keep a
// reference back to the originating lead so full history can be traced.
const customerSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      trim: true,
      default: '',
    },
    lastName: {
      type: String,
      trim: true,
      default: '',
    },
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
    dateOfBirth: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other', 'Prefer not to say'],
      default: 'Prefer not to say',
    },
    nationality: {
      type: String,
      trim: true,
      default: '',
    },
    // Emirates ID Document
    emiratesIdUrl: {
      type: String,
      default: '',
    },
    emiratesIdMetadata: {
      fileName: { type: String, default: '' },
      fileSize: { type: Number, default: 0 },
      mimeType: { type: String, default: '' },
      uploadedAt: { type: Date, default: Date.now },
    },
    // Full Address
    streetAddress: {
      type: String,
      trim: true,
      default: '',
    },
    country: {
      type: String,
      trim: true,
      default: 'United Arab Emirates',
    },
    city: {
      type: String,
      trim: true,
      default: 'Dubai',
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    zipCode: {
      type: String,
      trim: true,
      default: '',
    },
    // Parent / Guardian
    parentFullName: {
      type: String,
      trim: true,
      default: '',
    },
    parentEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    parentPhone: {
      type: String,
      trim: true,
      default: '',
    },
    parentRelationship: {
      type: String,
      enum: ['Father', 'Mother', 'Guardian', 'Other'],
      default: 'Guardian',
    },
    // Behavioural / Attention Needs
    hasBehaviouralNeeds: {
      type: Boolean,
      default: false,
    },
    behaviouralNeedsDetails: {
      type: String,
      trim: true,
      default: '',
    },
    // Consent
    socialMediaConsent: {
      type: Boolean,
      default: true,
    },
    // Lead / Referral Source
    source: {
      type: String,
      default: 'Social Media',
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

customerSchema.pre('save', function (next) {
  if (this.firstName || this.lastName) {
    this.fullName = `${this.firstName || ''} ${this.lastName || ''}`.trim() || this.fullName;
  }
  next();
});

customerSchema.index({ fullName: 'text', phone: 'text', email: 'text' });
customerSchema.index({ assignedTo: 1 });

module.exports = mongoose.model('Customer', customerSchema);
