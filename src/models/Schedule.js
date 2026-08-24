const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      // Removed required to support Master Sessions
    },
    participants: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
    },
    program: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Program',
      required: [true, 'Schedule must belong to a program'],
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: [true, 'Schedule must belong to a branch'],
    },
    instructor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    title: {
      type: String,
      required: [true, 'Schedule must have a title'],
    },
    startTime: {
      type: Date,
      required: [true, 'Start time is required'],
    },
    endTime: {
      type: Date,
      required: [true, 'End time is required'],
    },
    location: {
      type: String,
    },
    status: {
      type: String,
      enum: ['Scheduled', 'Completed', 'Cancelled', 'Rescheduled', 'No Show'],
      default: 'Scheduled',
    },
    attendance: {
      type: String,
      enum: ['Present', 'Absent', 'Late', 'Excused', 'Pending'],
      default: 'Pending',
    },
    notes: {
      type: String,
    },
    // --- Phase 5 Operations Additions ---
    sessionType: {
      type: String,
      enum: ['Class', 'Camp', 'Trip'],
      default: 'Class',
    },
    maxCapacity: {
      type: Number,
      default: 10,
    },
    currentCapacity: {
      type: Number,
      default: 0,
    },
    vessel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vessel',
    },
    captain: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    assistantCoach: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    supportStaff: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    }],
    equipmentAllocations: [{
      equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment' },
      quantity: Number,
      status: { type: String, enum: ['Issued', 'Returned'], default: 'Issued' },
    }],
  },
  {
    timestamps: true,
  }
);

// Indexes for faster querying
scheduleSchema.index({ student: 1, startTime: 1 });
scheduleSchema.index({ branch: 1, startTime: 1 });
scheduleSchema.index({ program: 1 });
scheduleSchema.index({ instructor: 1 });

module.exports = mongoose.model('Schedule', scheduleSchema);