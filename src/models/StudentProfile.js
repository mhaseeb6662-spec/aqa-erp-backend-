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
    firstName: {
      type: String,
      trim: true,
      default: '',
    },
    lastName: {
      type: String,
      trim: true,
      default: '',
    },
    nationality: {
      type: String,
      trim: true,
      default: '',
    },
    // Emirates ID Document
    emiratesIdUrl: {
      type: String,
      default: '',
    },
    emiratesIdMetadata: {
      fileName: { type: String, default: '' },
      fileSize: { type: Number, default: 0 },
      mimeType: { type: String, default: '' },
      uploadedAt: { type: Date, default: Date.now },
    },
    // Full Address
    streetAddress: {
      type: String,
      trim: true,
      default: '',
    },
    country: {
      type: String,
      trim: true,
      default: 'United Arab Emirates',
    },
    city: {
      type: String,
      trim: true,
      default: 'Dubai',
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    zipCode: {
      type: String,
      trim: true,
      default: '',
    },
    // Behavioural / Attention Needs
    hasBehaviouralNeeds: {
      type: Boolean,
      default: false,
    },
    behaviouralNeedsDetails: {
      type: String,
      trim: true,
      default: '',
    },
    // Consent
    socialMediaConsent: {
      type: Boolean,
      default: true,
    },
    mediaConsent: {
      type: Boolean,
      default: true,
    },
    hearAboutUs: {
      type: String,
      default: 'Social Media',
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
