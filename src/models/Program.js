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
      required: [true, 'Program code is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['Fishing Essentials', 'Offshore & Deep Sea', 'Kayak & Boating', 'Junior Angler', 'Spearfishing & Diving', 'Custom Private'],
      default: 'Fishing Essentials',
    },
    description: {
      type: String,
      required: [true, 'Program description is required'],
      trim: true,
    },
    level: {
      type: String,
      enum: ['Beginner', 'Intermediate', 'Advanced', 'Master'],
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
      enum: ['blue', 'teal', 'emerald', 'rose', 'amber', 'purple', 'indigo'],
      default: 'blue',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Program', programSchema);
