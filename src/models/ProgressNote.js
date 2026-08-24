const mongoose = require('mongoose');

const progressNoteSchema = new mongoose.Schema(
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
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule',
      default: null,
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Program',
      default: null,
    },
    skillLevel: {
      type: String,
      enum: ['Beginner', 'Intermediate', 'Advanced', 'Master'],
      default: 'Beginner',
    },
    skillsRating: {
      type: Number,
      min: 1,
      max: 5,
      default: 4,
    },
    safetyAwareness: {
      type: String,
      default: 'Good adherence to lifejacket & water safety guidelines.',
    },
    behaviorNotes: {
      type: String,
      default: 'Enthusiastic and respectful during session.',
    },
    remarks: {
      type: String,
      required: [true, 'Progress remarks are required'],
    },
    status: {
      type: String,
      enum: ['Approved', 'Draft'],
      default: 'Approved',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProgressNote', progressNoteSchema);
