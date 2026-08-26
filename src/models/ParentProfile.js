const mongoose = require('mongoose');

const parentProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    children: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    relationshipToStudent: {
      type: String,
      enum: ['Mother', 'Father', 'Guardian', 'Parent', 'Other'],
      default: 'Parent',
    },
    emergencyPhone: {
      type: String,
      default: '',
    },
    occupation: {
      type: String,
      default: '',
    },
    address: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ParentProfile', parentProfileSchema);
