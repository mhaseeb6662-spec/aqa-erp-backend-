const mongoose = require('mongoose');
const { ENTITY_TYPES, ACTIVITY_TYPES } = require('../config/crm.constants');

// Unified activity timeline / interaction history for leads & customers.
// Entries are either manually logged (note/call/email/meeting/whatsapp)
// or system-generated (stage_change, assignment, conversion, payment_link).
const activitySchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ENTITY_TYPES,
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true }
);

activitySchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = mongoose.model('Activity', activitySchema);
