const Schedule = require('../models/Schedule');
const AppError = require('../utils/appError');

const ParentProfile = require('../models/ParentProfile');

// Get schedules for student/parent or overall calendar
exports.getSchedules = async (req, res, next) => {
  try {
    const filter = {};
    const userId = req.user?._id || req.user?.id;
    const roleSlug = req.user?.role?.slug || (typeof req.user?.role === 'string' ? req.user.role : '');

    if (roleSlug === 'student') {
      filter.$or = [{ student: userId }, { participants: userId }];
    } else if (roleSlug === 'parent') {
      let childrenIds = [];
      try {
        const parentProf = await ParentProfile.findOne({ user: userId });
        childrenIds = (parentProf?.children || []).map((c) => (c._id ? c._id.toString() : c.toString()));
      } catch (pe) {
        console.warn('Error fetching parent profile in getSchedules:', pe.message);
      }

      if (req.query.studentId) {
        if (childrenIds.length > 0 && !childrenIds.includes(req.query.studentId.toString())) {
          return next(new AppError('Unauthorized: You can only view schedules for your linked children.', 403));
        }
        filter.student = req.query.studentId;
      } else if (childrenIds.length > 0) {
        filter.$or = [{ student: { $in: childrenIds } }, { participants: { $in: childrenIds } }];
      } else {
        // If parent has no children yet, return empty list cleanly
        return res.status(200).json({ success: true, count: 0, data: [] });
      }
    } else if (roleSlug === 'coach') {
      if (req.query.all !== 'true') {
        filter.$or = [
          { instructor: userId },
          { captain: userId },
          { assistantCoach: userId },
          { supportStaff: userId }
        ];
      }
    } else if (req.query.studentId) {
      filter.$or = [{ student: req.query.studentId }, { participants: req.query.studentId }];
    }

    if (req.query.branchId) {
      filter.branch = req.query.branchId;
    }

    if (req.query.status) {
      filter.status = req.query.status;
    }

    const schedules = await Schedule.find(filter)
      .populate('student', 'fullName email phone')
      .populate('program', 'title category level code')
      .populate('branch', 'name code city address')
      .populate('instructor', 'fullName email phone')
      .populate('vessel', 'name registrationNumber capacity')
      .sort({ startTime: 1 });

    res.status(200).json({
      success: true,
      count: schedules.length,
      data: schedules,
    });
  } catch (err) {
    console.error('getSchedules Error:', err);
    res.status(500).json({ success: false, message: err.message, stack: err.stack });
  }
};

// Update attendance / schedule notes (Coach / Admin)
exports.updateScheduleStatus = async (req, res, next) => {
  try {
    const { attendance, status, notes, instructorId } = req.body;
    const updateData = {};
    if (attendance) updateData.attendance = attendance;
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (instructorId) updateData.instructor = instructorId;

    const schedule = await Schedule.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    })
      .populate('student', 'fullName email')
      .populate('program', 'title')
      .populate('branch', 'name');

    if (!schedule) return next(new AppError('Schedule entry not found', 404));

    res.status(200).json({ success: true, data: schedule });
  } catch (err) {
    next(err);
  }
};

// Phase 5 - Update full schedule (for Operations)
exports.updateSchedule = async (req, res, next) => {
  try {
    const { vessel, instructor, captain, assistantCoach, supportStaff, maxCapacity, sessionType, overrideCapacity } = req.body;
    
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule) return next(new AppError('Schedule not found', 404));

    // Vessel Conflict Prevention
    if (vessel && vessel !== schedule.vessel?.toString()) {
      const overlapping = await Schedule.findOne({
        _id: { $ne: schedule._id },
        vessel,
        status: { $nin: ['Cancelled', 'Completed'] },
        $or: [
          { startTime: { $lt: schedule.endTime }, endTime: { $gt: schedule.startTime } }
        ]
      });

      if (overlapping) {
        return next(new AppError(`Vessel is already assigned to another session during this time.`, 400));
      }
      
      const VesselModel = require('../models/Vessel');
      const v = await VesselModel.findById(vessel);
      if (v && v.operationalStatus === 'Maintenance') {
        return next(new AppError('Vessel is currently under maintenance.', 400));
      }
    }

    if (maxCapacity) schedule.maxCapacity = maxCapacity;
    if (vessel) schedule.vessel = vessel;
    if (instructor) schedule.instructor = instructor;
    if (captain) schedule.captain = captain;
    if (assistantCoach) schedule.assistantCoach = assistantCoach;
    if (supportStaff) schedule.supportStaff = supportStaff;
    if (sessionType) schedule.sessionType = sessionType;

    await schedule.save();
    res.status(200).json({ success: true, data: schedule });
  } catch (err) {
    next(err);
  }
};
