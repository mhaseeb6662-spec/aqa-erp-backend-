const Branch = require('../models/Branch');
const AppError = require('../utils/appError');

// Get all active branches (defaults to active only; pass ?includeInactive=true for all)
exports.getAllBranches = async (req, res, next) => {
  try {
    const filter = req.query.includeInactive === 'true' ? {} : { isActive: true };
    const branches = await Branch.find(filter).sort({ name: 1 });
    res.status(200).json({
      success: true,
      count: branches.length,
      data: branches,
    });
  } catch (err) {
    next(err);
  }
};

// Get single branch
exports.getBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) return next(new AppError('Branch not found', 404));
    res.status(200).json({ success: true, data: branch });
  } catch (err) {
    next(err);
  }
};

// Create branch (Admin)
exports.createBranch = async (req, res, next) => {
  try {
    const branch = await Branch.create(req.body);
    res.status(201).json({ success: true, data: branch });
  } catch (err) {
    next(err);
  }
};

// Update branch (Admin)
exports.updateBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!branch) return next(new AppError('Branch not found', 404));
    res.status(200).json({ success: true, data: branch });
  } catch (err) {
    next(err);
  }
};

// Delete branch (Admin) - soft deactivates if historical data references this branch
exports.deleteBranch = async (req, res, next) => {
  try {
    const branch = await Branch.findById(req.params.id);
    if (!branch) return next(new AppError('Branch not found', 404));

    // Check if referenced by any records across models
    const Booking = require('../models/Booking');
    const Schedule = require('../models/Schedule');
    const StudentProfile = require('../models/StudentProfile');
    const CalendarEvent = require('../models/CalendarEvent');
    const Vessel = require('../models/Vessel');
    const Equipment = require('../models/Equipment');
    const Invoice = require('../models/Invoice');

    const [hasBookings, hasSchedules, hasStudents, hasEvents, hasVessels, hasEquip, hasInvoices] = await Promise.all([
      Booking.exists({ branch: branch._id }),
      Schedule.exists({ branch: branch._id }),
      StudentProfile.exists({ primaryBranch: branch._id }),
      CalendarEvent.exists({ branch: branch._id }),
      Vessel.exists({ branch: branch._id }),
      Equipment.exists({ branch: branch._id }),
      Invoice.exists({ branch: branch._id }),
    ]);

    if (hasBookings || hasSchedules || hasStudents || hasEvents || hasVessels || hasEquip || hasInvoices) {
      branch.isActive = false;
      await branch.save();
      return res.status(200).json({
        success: true,
        message: 'Branch has historical records and was deactivated instead of deleted to protect data integrity.',
        data: branch,
      });
    }

    await Branch.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Branch deleted successfully' });
  } catch (err) {
    next(err);
  }
};
