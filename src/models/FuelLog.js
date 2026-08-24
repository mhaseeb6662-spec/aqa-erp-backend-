const mongoose = require('mongoose');

const fuelLogSchema = new mongoose.Schema(
  {
    vessel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vessel',
      required: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Schedule',
    },
    fuelQuantity: {
      type: Number,
      required: true,
    },
    fuelCost: {
      type: Number,
    },
    engineHours: {
      type: Number,
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    notes: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('FuelLog', fuelLogSchema);
