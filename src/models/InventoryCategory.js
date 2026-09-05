const mongoose = require('mongoose');

const inventoryCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    inventoryType: {
      type: String,
      enum: ['ACADEMY_USE', 'MERCHANDISE_FOR_SALE', 'BOTH'],
      default: 'BOTH',
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('InventoryCategory', inventoryCategorySchema);
