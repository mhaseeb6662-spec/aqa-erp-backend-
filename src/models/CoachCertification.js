const mongoose = require('mongoose');

const coachCertificationSchema = new mongoose.Schema(
  {
    coach: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: [true, 'Certification title is required'],
      trim: true,
    },
    certificationType: {
      type: String,
      enum: ['First Aid & CPR', 'Life Guard License', 'Offshore Navigation', 'PADI Diving Master', 'Maritime Safety', 'Coastal Captain License'],
      required: true,
    },
    issuingAuthority: {
      type: String,
      default: 'UAE Maritime Authority / Red Cross',
    },
    issueDate: {
      type: Date,
      required: true,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    documentUrl: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['Active', 'Expiring Soon', 'Expired'],
      default: 'Active',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CoachCertification', coachCertificationSchema);
