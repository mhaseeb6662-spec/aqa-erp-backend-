const mongoose = require('mongoose');
const { LEAD_SOURCES, PIPELINE_STAGES } = require('../config/crm.constants');

const leadSchema = new mongoose.Schema(
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
    // Stable id from the originating platform (Facebook leadgen_id, Google
    // Ads lead_id, ...) — used by the inbound webhooks to dedupe retried/
    // re-delivered payloads so the same lead never gets created twice.
    // Not set for manually-entered or WhatsApp leads (matched by phone
    // instead). Deliberately no `default` here — the field must stay
    // completely absent (not even `null`) on those leads, otherwise the
    // sparse unique index below would treat every lead sharing a source
    // as a duplicate of the next.
    externalId: {
      type: String,
      trim: true,
    },
    stage: {
      type: String,
      enum: PIPELINE_STAGES,
      default: 'new',
      index: true,
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
    // Set once this lead is converted into a Customer. The Lead document is
    // kept (stage becomes "won") so pipeline history/reporting stays intact.
    convertedToCustomer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    convertedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    migrationMetadata: {
      batchId: { type: String, default: null },
      importedAt: { type: Date, default: null },
      rawOwner: { type: String, default: '' },
      rawStatus: { type: String, default: '' },
      rawSource: { type: String, default: '' },
      interestLevel: { type: String, default: '' },
      subject: { type: String, default: '' },
      courses: { type: String, default: '' },
      birthday: { type: Date, default: null },
      age: { type: String, default: '' },
      gender: { type: String, default: '' },
      nationality: { type: String, default: '' },
      city: { type: String, default: '' },
      guardianName: { type: String, default: '' },
      guardianPhone: { type: String, default: '' },
      guardianEmail: { type: String, default: '' },
      numberOfKids: { type: String, default: '' },
      signupSource: { type: String, default: '' },
      lastContacted: { type: Date, default: null },
      followUpDate: { type: Date, default: null },
      isPhoneAsName: { type: Boolean, default: false },
      ownerMappingRequired: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

leadSchema.index({ fullName: 'text', phone: 'text', email: 'text' });
leadSchema.index({ assignedTo: 1 });
leadSchema.index({ source: 1 });
// DB-level backstop against duplicate webhook redelivery: unique per
// (source, externalId) but only for docs that actually have an externalId
// — a partialFilterExpression is used (rather than plain `sparse: true`)
// because externalId is never explicitly set to null on other leads, only
// ever entirely absent, so this only ever applies to webhook-sourced leads.
leadSchema.index(
  { source: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } }
);

module.exports = mongoose.model('Lead', leadSchema);
