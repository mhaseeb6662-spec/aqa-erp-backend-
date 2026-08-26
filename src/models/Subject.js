const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Subject name is required'],
      unique: true,
      trim: true,
      maxlength: 100,
    },
    code: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    defaultDuration: {
      type: Number,
      required: [true, 'Default duration in minutes is required'],
      default: 60,
      min: [5, 'Duration must be at least 5 minutes'],
      max: [1440, 'Duration cannot exceed 24 hours (1440 minutes)'],
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'archived'],
      default: 'active',
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    color: {
      type: String,
      default: '#0ea5e9',
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

subjectSchema.index({ name: 1 });
subjectSchema.index({ status: 1 });

module.exports = mongoose.model('Subject', subjectSchema);
