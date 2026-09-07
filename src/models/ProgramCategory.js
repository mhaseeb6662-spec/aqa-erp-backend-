const mongoose = require('mongoose');

const programCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Program category name is required'],
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ProgramCategory', programCategorySchema);
