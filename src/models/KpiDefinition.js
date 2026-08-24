const mongoose = require('mongoose');

const kpiDefinitionSchema = new mongoose.Schema(
  {
    kpiId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['Revenue', 'Sales', 'Finance', 'Operations', 'Coach', 'Staff', 'Branch', 'Program', 'Marketing', 'Customer Experience'],
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    formula: {
      type: String,
      required: true,
    },
    formulaVersion: {
      type: String,
      default: '1.0.0',
    },
    unit: {
      type: String,
      default: 'AED', // 'AED', '%', 'Count', 'Hours', 'Days', 'Ratio'
    },
    targetValue: {
      type: Number,
      default: 0,
    },
    warningThreshold: {
      type: Number,
      default: null,
    },
    criticalThreshold: {
      type: Number,
      default: null,
    },
    dataQuality: {
      type: String,
      enum: ['Live', 'Estimated', 'Incomplete', 'Delayed'],
      default: 'Live',
    },
    sourceCollections: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('KpiDefinition', kpiDefinitionSchema);
