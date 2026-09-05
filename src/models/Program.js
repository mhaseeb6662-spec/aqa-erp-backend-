const mongoose = require('mongoose');

const programSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Program title is required'],
      trim: true,
    },
    code: {
      type: String,
      uppercase: true,
      trim: true,
    },
    category: {
      type: String,
      default: 'Fishing Essentials',
    },
    description: {
      type: String,
      required: [true, 'Program description is required'],
      trim: true,
    },
    level: {
      type: String,
      default: 'Beginner',
    },
    ageGroup: {
      type: String,
      enum: ['Kids (6-12)', 'Teens (13-17)', 'Adults (18+)', 'All Ages'],
      default: 'All Ages',
    },
    durationWeeks: {
      type: Number,
      default: 4,
    },
    durationHours: {
      type: Number,
      default: 1,
    },
    durationMinutes: {
      type: Number,
      default: 0,
    },
    sessionsCount: {
      type: Number,
      default: 8,
    },
    price: {
      type: Number,
      required: [true, 'Program price is required'],
      min: 0,
    },
    branches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Branch',
      },
    ],
    brochureUrl: {
      type: String,
      default: '',
    },
    brochureMetadata: {
      type: Object,
      default: {},
    },
    imageUrl: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'draft'],
      default: 'active',
    },
    prerequisites: {
      type: String,
      default: 'None',
    },
    calendarColor: {
      type: String,
      enum: ['blue', 'teal', 'emerald', 'rose', 'amber', 'purple', 'indigo', 'red', 'green', 'orange', 'yellow', 'pink'],
      default: 'blue',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Program', programSchema);
