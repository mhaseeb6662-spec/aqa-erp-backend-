const Program = require('../models/Program');
const Booking = require('../models/Booking');
const Schedule = require('../models/Schedule');
const Invoice = require('../models/Invoice');
const CalendarEvent = require('../models/CalendarEvent');
const StudentProfile = require('../models/StudentProfile');
const Branch = require('../models/Branch');
const AppError = require('../utils/appError');
const logActivity = require('../utils/logActivity');

async function validateBranches(branchIds) {
  if (!Array.isArray(branchIds) || branchIds.length === 0) return true;
  const count = await Branch.countDocuments({
    _id: { $in: branchIds },
    isActive: true,
  });
  return count === branchIds.length;
}

// Get all programs with filters
exports.getPrograms = async (req, res, next) => {
  try {
    const { category, level, ageGroup, branch, activeOnly } = req.query;
    const filter = {};

    if (category) filter.category = category;
    if (level) filter.level = level;
    if (ageGroup) filter.ageGroup = ageGroup;
    if (branch) filter.branches = branch;
    if (activeOnly === 'true') filter.status = 'active';

    const programs = await Program.find(filter).populate('branches', 'name code city').sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: programs.length,
      data: programs,
    });
  } catch (err) {
    next(err);
  }
};

// Get program by ID
exports.getProgram = async (req, res, next) => {
  try {
    const program = await Program.findById(req.params.id).populate('branches');
    if (!program) return next(new AppError('Program not found', 404));
    res.status(200).json({ success: true, data: program });
  } catch (err) {
    next(err);
  }
};

// Create program (Admin)
exports.createProgram = async (req, res, next) => {
  try {
    const allowedColors = ['red', 'blue', 'green', 'orange', 'yellow', 'pink', 'purple'];
    if (req.body.calendarColor && !allowedColors.includes(req.body.calendarColor.toLowerCase())) {
      return next(new AppError('Invalid program colour. Allowed: red, blue, green, orange, yellow, pink, purple', 400));
    }
    if (req.body.durationHours) {
      req.body.durationMinutes = Math.round(Number(req.body.durationHours) * 60);
    }
    if (req.body.branches && req.body.branches.length > 0) {
      const valid = await validateBranches(req.body.branches);
      if (!valid) {
        return next(new AppError('One or more selected branches are invalid or inactive.', 400));
      }
    }

    const program = await Program.create(req.body);

    await logActivity({
      entityType: 'customer', // Using customer temporarily if program entity type not configured
      entityId: req.user._id,
      type: 'note',
      description: `PROGRAM_CREATED: Program "${program.title}" created.`,
      performedBy: req.user._id,
      metadata: { programId: program._id, newValues: program.toObject() }
    });

    res.status(201).json({ success: true, data: program });
  } catch (err) {
    next(err);
  }
};

// Update program (Admin)
exports.updateProgram = async (req, res, next) => {
  try {
    const oldProgram = await Program.findById(req.params.id);
    if (!oldProgram) return next(new AppError('Program not found', 404));

    if (req.body.calendarColor) {
      const allowedColors = ['red', 'blue', 'green', 'orange', 'yellow', 'pink', 'purple'];
      if (!allowedColors.includes(req.body.calendarColor.toLowerCase())) {
        return next(new AppError('Invalid program colour. Allowed: red, blue, green, orange, yellow, pink, purple', 400));
      }
    }
    if (req.body.durationHours) {
      req.body.durationMinutes = Math.round(Number(req.body.durationHours) * 60);
    }
    if (req.body.branches && req.body.branches.length > 0) {
      const valid = await validateBranches(req.body.branches);
      if (!valid) {
        return next(new AppError('One or more selected branches are invalid or inactive.', 400));
      }
    }

    const program = await Program.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    
    let actionName = 'PROGRAM_UPDATED';
    if (oldProgram.title !== program.title) actionName = 'PROGRAM_RENAMED';

    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `${actionName}: Program "${oldProgram.title}" updated to "${program.title}".`,
      performedBy: req.user._id,
      metadata: { programId: program._id, oldValues: oldProgram.toObject(), newValues: program.toObject() }
    });

    res.status(200).json({ success: true, data: program });
  } catch (err) {
    next(err);
  }
};

// Check dependencies for delete
exports.checkProgramDependencies = async (req, res, next) => {
  try {
    const programId = req.params.id;
    
    const [bookings, schedules, invoices, events, students] = await Promise.all([
      Booking.countDocuments({ program: programId }),
      Schedule.countDocuments({ program: programId }),
      Invoice.countDocuments({ program: programId }),
      CalendarEvent.countDocuments({ program: programId }),
      StudentProfile.countDocuments({ enrolledPrograms: programId })
    ]);

    const hasDependencies = (bookings + schedules + invoices + events + students) > 0;

    res.status(200).json({
      success: true,
      hasDependencies,
      details: {
        bookings,
        schedules,
        invoices,
        events,
        students
      }
    });
  } catch (err) {
    next(err);
  }
};

// Delete program (Admin) - Archives if dependencies exist
exports.deleteProgram = async (req, res, next) => {
  try {
    const { archive } = req.query;
    const program = await Program.findById(req.params.id);
    if (!program) return next(new AppError('Program not found', 404));

    const [bookings, schedules, invoices, events, students] = await Promise.all([
      Booking.countDocuments({ program: program._id }),
      Schedule.countDocuments({ program: program._id }),
      Invoice.countDocuments({ program: program._id }),
      CalendarEvent.countDocuments({ program: program._id }),
      StudentProfile.countDocuments({ enrolledPrograms: program._id })
    ]);

    const hasDependencies = (bookings + schedules + invoices + events + students) > 0;

    if (hasDependencies && archive !== 'true') {
      return res.status(409).json({ 
        success: false, 
        message: 'Program has existing dependencies. Please archive instead.',
        hasDependencies: true 
      });
    }

    if (hasDependencies && archive === 'true') {
      program.status = 'inactive';
      await program.save();
      
      await logActivity({
        entityType: 'customer',
        entityId: req.user._id,
        type: 'note',
        description: `PROGRAM_ARCHIVED: Program "${program.title}" archived because it has dependencies.`,
        performedBy: req.user._id,
      });

      return res.status(200).json({ success: true, message: 'Program archived successfully', archived: true });
    }

    await Program.findByIdAndDelete(req.params.id);
    
    await logActivity({
      entityType: 'customer',
      entityId: req.user._id,
      type: 'note',
      description: `PROGRAM_DELETED: Program "${program.title}" permanently deleted.`,
      performedBy: req.user._id,
    });

    res.status(200).json({ success: true, message: 'Program deleted successfully' });
  } catch (err) {
    next(err);
  }
};
