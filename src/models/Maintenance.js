const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema(
  {
    vessel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vessel',
      required: true,
    },
    maintenanceType: {
      type: String,
      enum: ['Preventive', 'Corrective'],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    dueDate: Date,
    startDate: Date,
    completionDate: Date,
    vendor: String,
    cost: Number,
    status: {
      type: String,
      enum: ['Scheduled', 'In Progress', 'Completed', 'Cancelled'],
      default: 'Scheduled',
    },
    notes: String,
    attachments: [String],
    isDowntime: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Maintenance', maintenanceSchema);
