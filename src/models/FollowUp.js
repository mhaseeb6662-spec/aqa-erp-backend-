const mongoose = require('mongoose');
const { ENTITY_TYPES, FOLLOW_UP_TYPES, FOLLOW_UP_STATUSES } = require('../config/crm.constants');

// A follow-up can be attached to either a Lead or a Customer via a
// polymorphic (entityType, entityId) pair rather than two separate models.
const followUpSchema = new mongoose.Schema(
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
      enum: FOLLOW_UP_TYPES,
      required: [true, 'Follow-up type is required'],
    },
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: FOLLOW_UP_STATUSES,
      default: 'pending',
    },
    outcomeNote: {
      type: String,
      trim: true,
      default: '',
    },
    completedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

followUpSchema.index({ entityType: 1, entityId: 1 });
followUpSchema.index({ status: 1, dueDate: 1 });

module.exports = mongoose.model('FollowUp', followUpSchema);
