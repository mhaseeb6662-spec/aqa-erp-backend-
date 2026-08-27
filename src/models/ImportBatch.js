const mongoose = require('mongoose');

const importBatchSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    filename: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      default: 'leads',
    },
    totalRows: {
      type: Number,
      default: 0,
    },
    importedCount: {
      type: Number,
      default: 0,
    },
    duplicatesSkipped: {
      type: Number,
      default: 0,
    },
    existingDuplicatesSkipped: {
      type: Number,
      default: 0,
    },
    failedCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['started', 'completed', 'failed', 'rolled_back'],
      default: 'started',
    },
    sourceBreakdown: {
      type: Map,
      of: Number,
      default: {},
    },
    stageBreakdown: {
      type: Map,
      of: Number,
      default: {},
    },
    ownerBreakdown: {
      type: Map,
      of: Number,
      default: {},
    },
    executedBy: {
      type: String,
      default: 'Super Admin',
    },
    completedAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ImportBatch', importBatchSchema);
