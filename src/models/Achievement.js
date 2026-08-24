const mongoose = require('mongoose');

const achievementSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    coach: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Program',
      default: null,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule',
      default: null,
    },
    title: {
      type: String,
      required: [true, 'Achievement title is required'],
    },
    badgeType: {
      type: String,
      enum: ['Little Angler Badge', 'Knot Tying Specialist', 'Deep Sea Master', 'Navigation Pro', 'Safety Hero', 'Camp Champion'],
      default: 'Little Angler Badge',
    },
    issueDate: {
      type: Date,
      default: Date.now,
    },
    remarks: {
      type: String,
      default: 'Awarded for outstanding performance during session.',
    },
    status: {
      type: String,
      enum: ['Approved', 'Pending'],
      default: 'Approved',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Achievement', achievementSchema);
