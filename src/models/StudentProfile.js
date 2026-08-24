const mongoose = require('mongoose');

const studentProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    parentUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    studentCode: {
      type: String,
      unique: true,
      required: true,
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
    emergencyContact: {
      name: { type: String, default: '' },
      phone: { type: String, default: '' },
      relationship: { type: String, default: '' },
    },
    medicalNotes: {
      type: String,
      default: 'No known allergies or medical restrictions.',
    },
    dietaryNotes: {
      type: String,
      default: 'Standard diet.',
    },
    skillLevel: {
      type: String,
      enum: ['Beginner', 'Intermediate', 'Advanced', 'Master'],
      default: 'Beginner',
    },
    primaryBranch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
    },
    membershipStatus: {
      type: String,
      enum: ['Active', 'Pending', 'Suspended', 'Expired'],
      default: 'Active',
    },
    enrolledPrograms: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Program',
      },
    ],
    mediaConsent: {
      type: Boolean,
      default: true,
    },
    waiverSigned: {
      type: Boolean,
      default: true,
    },
    joinedDate: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudentProfile', studentProfileSchema);
