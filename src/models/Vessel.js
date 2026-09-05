const mongoose = require('mongoose');

const vesselSchema = new mongoose.Schema(
  {
    vesselId: {
      type: String,
      unique: true,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    registrationNumber: {
      type: String,
      required: true,
    },
    vesselType: {
      type: String,
      default: 'Boat',
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
    },
    capacity: {
      type: Number,
      required: true,
    },
    operationalStatus: {
      type: String,
      enum: ['Available', 'Assigned', 'Maintenance', 'Out of Service', 'Unavailable'],
      default: 'Available',
    },
    readinessStatus: {
      type: String,
      enum: ['Ready', 'Not Ready'],
      default: 'Ready',
    },
    photoUrl: {
      type: String,
      default: '',
    },
    photoMetadata: {
      fileName: { type: String, default: '' },
      fileSize: { type: Number, default: 0 },
      mimeType: { type: String, default: '' },
      uploadedAt: { type: Date },
    },
    location: {
      type: String,
    },
    documents: [
      {
        documentType: String, // Registration, Insurance, etc.
        documentNumber: String,
        issueDate: Date,
        expiryDate: Date,
        attachmentUrl: String,
        status: { type: String, enum: ['Valid', 'Expired', 'Pending'], default: 'Valid' },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Vessel', vesselSchema);
