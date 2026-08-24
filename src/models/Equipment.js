const mongoose = require('mongoose');

const equipmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    category: {
      type: String, // Rod, Reel, Bait, Life Jacket, Safety Gear
      required: true,
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
    },
    totalQuantity: {
      type: Number,
      required: true,
      default: 0,
    },
    availableQuantity: {
      type: Number,
      required: true,
      default: 0,
    },
    reservedQuantity: {
      type: Number,
      default: 0,
    },
    damagedQuantity: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Equipment', equipmentSchema);
