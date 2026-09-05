const Schedule = require('../models/Schedule');
const CalendarEvent = require('../models/CalendarEvent');
const StudentProfile = require('../models/StudentProfile');
const Customer = require('../models/Customer');
const ProgressNote = require('../models/ProgressNote');
const SessionReport = require('../models/SessionReport');
const CoachCertification = require('../models/CoachCertification');
const Achievement = require('../models/Achievement');
const Document = require('../models/Document');
const User = require('../models/User');
const Role = require('../models/Role');
const AppError = require('../utils/appError');

/**
 * Returns Start & End of day in UAE Timezone (UTC+4 Asia/Dubai).
 */
const getUaeDayBounds = (dateInput = new Date()) => {
  const d = new Date(dateInput);
  const uaeDateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(d);
  const [year, month, day] = uaeDateStr.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) - 4 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - 4 * 60 * 60 * 1000);
  return { start, end };
};

// Helper to build schedule query filter for a coach
const getCoachScheduleFilter = (coachUserId, isSuperAdmin) => {
  if (isSuperAdmin) return {};
  if (!coachUserId) return { _id: null };
  return {
    $or: [
      { instructor: coachUserId },
      { captain: coachUserId },
      { assistantCoach: coachUserId },
      { supportStaff: coachUserId },
    ],
  };
};

// Helper to check if session is assigned to logged in coach (unless Admin)
const verifyCoachSessionAssignment = async (sessionId, coachUserId, isSuperAdmin) => {
  const session = await Schedule.findOne({
    $or: [{ _id: sessionId }, { calendarEvent: sessionId }],
  })
    .populate('student', 'fullName email phone')
    .populate('participants', 'fullName email phone')
    .populate('program', 'title category level code price calendarColor durationHours durationMinutes durationWeeks sessionsCount')
    .populate('branch', 'name code city address')
    .populate('instructor', 'fullName email phone')
    .populate('assistantCoach', 'fullName email phone')
    .populate('vessel', 'name registrationNumber');

  if (!session) {
    throw new AppError('Session not found', 404);
  }

  if (!isSuperAdmin) {
    const iId = session.instructor?._id || session.instructor;
    const cId = session.captain?._id || session.captain;
    const aId = session.assistantCoach?._id || session.assistantCoach;
    const ssIds = (session.supportStaff || []).map((s) => s._id?.toString() || s.toString());
    const cUid = coachUserId.toString();

    if (
      (!iId || iId.toString() !== cUid) &&
      (!cId || cId.toString() !== cUid) &&
      (!aId || aId.toString() !== cUid) &&
      !ssIds.includes(cUid)
    ) {
      throw new AppError('Access denied. You are not assigned to this session.', 403);
    }
  }

  return session;
};

// 1. GET /api/v1/coach/dashboard
exports.getCoachDashboard = async (req, res, next) => {
  try {
    const coachUserId = req.user?._id || req.user?.id;
    const roleSlug = req.user?.role?.slug || (typeof req.user?.role === 'string' ? req.user.role : '');
    const isSuperAdmin = roleSlug === 'super-admin' || roleSlug === 'admin';

    const baseFilter = getCoachScheduleFilter(coachUserId, isSuperAdmin);

    // UAE Timezone Bounds
    const { start: startOfToday, end: endOfToday } = getUaeDayBounds();

    const [todaySessions, upcomingSessions, pendingReports, certs] = await Promise.all([
      Schedule.find({
        ...baseFilter,
        startTime: { $gte: startOfToday, $lte: endOfToday },
      })
        .populate('student', 'fullName email phone')
        .populate('participants', 'fullName email phone')
        .populate('program', 'title category level code price calendarColor durationHours durationMinutes')
        .populate('branch', 'name code city address')
        .populate('instructor', 'fullName email phone')
        .populate('assistantCoach', 'fullName email phone')
        .sort({ startTime: 1 }),

      Schedule.find({
        ...baseFilter,
        startTime: { $gt: endOfToday },
      })
        .populate('student', 'fullName email phone')
        .populate('participants', 'fullName email phone')
        .populate('program', 'title category level code price calendarColor durationHours durationMinutes')
        .populate('branch', 'name code city address')
        .populate('instructor', 'fullName email phone')
        .populate('assistantCoach', 'fullName email phone')
        .sort({ startTime: 1 })
        .limit(10),

      SessionReport.find({ coach: coachUserId }).select('session'),
      CoachCertification.find({ coach: coachUserId }),
    ]);

    // Calculate metrics
    const reportedSessionIds = new Set(pendingReports.map((r) => r.session?.toString()));
    const completedSessionsWithoutReport = todaySessions.filter(
      (s) => s.status === 'Completed' && !reportedSessionIds.has(s._id.toString())
    );

    const pendingAttendance = todaySessions.filter((s) => s.attendance === 'Pending' || s.attendance === 'Not Marked');
    
    // Extract unique assigned students from single student and group participants
    const studentIdSet = new Set();
    const allAssignedSessions = await Schedule.find(baseFilter).select('student participants');
    allAssignedSessions.forEach((s) => {
      if (s.student?._id) studentIdSet.add(s.student._id.toString());
      else if (s.student) studentIdSet.add(s.student.toString());
      if (Array.isArray(s.participants)) {
        s.participants.forEach((p) => {
          if (p?._id) studentIdSet.add(p._id.toString());
          else if (p) studentIdSet.add(p.toString());
        });
      }
    });

    const assignedStudentIds = Array.from(studentIdSet);

    // Fetch assigned student safety alerts (medical notes / allergies)
    const studentProfiles = await StudentProfile.find({ user: { $in: assignedStudentIds } })
      .populate('user', 'fullName email phone')
      .select('user medicalNotes dietaryNotes skillLevel emergencyContact mediaConsent waiverSigned');

    const safetyAlerts = studentProfiles.filter(
      (sp) => sp.medicalNotes && !sp.medicalNotes.toLowerCase().includes('no known')
    );

    // Certifications expiry warning check
    const now = new Date();
    const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringCerts = certs.filter((c) => c.expiryDate <= thirtyDaysFromNow);

    res.status(200).json({
      success: true,
      data: {
        todaySessionsCount: todaySessions.length,
        upcomingSessionsCount: upcomingSessions.length,
        assignedStudentsCount: assignedStudentIds.length,
        pendingAttendanceCount: pendingAttendance.length,
        pendingReportsCount: completedSessionsWithoutReport.length,
        expiringCertsCount: expiringCerts.length,
        todaySessions,
        upcomingSessions,
        safetyAlerts,
        expiringCerts,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 2. GET /api/v1/coach/sessions
exports.getAssignedSessions = async (req, res, next) => {
  try {
    const coachUserId = req.user?._id || req.user?.id;
    const roleSlug = req.user?.role?.slug || (typeof req.user?.role === 'string' ? req.user.role : '');
    const isSuperAdmin = roleSlug === 'super-admin' || roleSlug === 'admin';
    const { status, date, type } = req.query;

    const filter = getCoachScheduleFilter(coachUserId, isSuperAdmin);

    if (status && status !== 'All') {
      filter.status = status;
    }

    if (type && type !== 'All') {
      filter.sessionType = type;
    }

    if (date) {
      const { start, end } = getUaeDayBounds(date);
      filter.startTime = { $gte: start, $lte: end };
    }

    const sessions = await Schedule.find(filter)
      .populate('student', 'fullName email phone')
      .populate('participants', 'fullName email phone')
      .populate('program', 'title category level code price calendarColor durationHours durationMinutes')
      .populate('branch', 'name code city address')
      .populate('instructor', 'fullName email phone')
      .populate('assistantCoach', 'fullName email phone')
      .populate('vessel', 'name registrationNumber')
      .sort({ startTime: -1 });

    res.status(200).json({
      success: true,
      count: sessions.length,
      data: sessions,
    });
  } catch (err) {
    console.error('getAssignedSessions Error:', err);
    res.status(500).json({ success: false, message: err.message, stack: err.stack });
  }
};

// 3. GET /api/v1/coach/sessions/:id
exports.getAssignedSessionById = async (req, res, next) => {
  try {
    const coachUserId = req.user._id;
    const isSuperAdmin = req.user.role?.slug === 'super-admin' || req.user.role?.slug === 'admin';

    const session = await verifyCoachSessionAssignment(req.params.id, coachUserId, isSuperAdmin);

    // Fetch detailed student profile for assigned student
    let studentProfile = null;
    if (session.student) {
      const sId = session.student._id || session.student;
      studentProfile = await StudentProfile.findOne({ user: sId })
        .populate('user', 'fullName email phone avatarUrl')
        .populate('primaryBranch', 'name code');

      if (!studentProfile) {
        // Fall back to customer record if student profile not yet generated
        const customer = await Customer.findById(sId);
        if (customer) {
          studentProfile = {
            _id: customer._id,
            user: {
              _id: customer._id,
              fullName: customer.fullName,
              email: customer.email,
              phone: customer.phone,
            },
            studentCode: customer.phone ? `STD-${customer.phone.slice(-4)}` : 'STD-GUEST',
            skillLevel: 'Beginner',
            medicalNotes: customer.hasBehaviouralNeeds ? customer.behaviouralNeedsDetails : 'No known allergies or medical restrictions.',
            emergencyContact: {
              name: customer.parentFullName || 'Parent On Record',
              phone: customer.parentPhone || customer.phone,
            },
            mediaConsent: customer.socialMediaConsent !== false,
          };
        }
      }
    }

    // Fetch existing progress notes & session reports for this session
    const [progressNotes, sessionReport, mediaList] = await Promise.all([
      ProgressNote.find({ session: session._id }).populate('coach', 'fullName'),
      SessionReport.findOne({ session: session._id }),
      Document.find({ $or: [{ session: session._id }, { uploadedBy: coachUserId, student: session.student?._id }] }),
    ]);

    res.status(200).json({
      success: true,
      data: {
        session,
        studentProfile,
        progressNotes,
        sessionReport,
        mediaList,
      },
    });
  } catch (err) {
    next(err);
  }
};

// 4. PUT /api/v1/coach/sessions/:id/attendance
exports.updateAttendance = async (req, res, next) => {
  try {
    const coachUserId = req.user._id;
    const isSuperAdmin = req.user.role?.slug === 'super-admin' || req.user.role?.slug === 'admin';
    const { attendance, notes } = req.body;

    if (!['Present', 'Absent', 'Rescheduled', 'No-show', 'Late', 'Excused', 'Pending'].includes(attendance)) {
      return next(new AppError('Invalid attendance status provided', 400));
    }

    const session = await verifyCoachSessionAssignment(req.params.id, coachUserId, isSuperAdmin);

    session.attendance = attendance;
    if (notes !== undefined) session.notes = notes;
    await session.save();

    // Sync back to CalendarEvent if linked
    if (session.calendarEvent) {
      try {
        const calEvent = await CalendarEvent.findById(session.calendarEvent);
        if (calEvent && Array.isArray(calEvent.registrations)) {
          calEvent.registrations.forEach((r) => {
            r.attendance = attendance.toLowerCase();
          });
          await calEvent.save();
        }
      } catch (ce) {
        console.warn('Could not sync attendance back to CalendarEvent:', ce.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Attendance recorded successfully.',
      data: session,
    });
  } catch (err) {
    next(err);
  }
};

// 5. POST /api/v1/coach/progress
exports.createProgressNote = async (req, res, next) => {
  try {
    const coachUserId = req.user._id;
    const isSuperAdmin = req.user.role?.slug === 'super-admin' || req.user.role?.slug === 'admin';
    const { studentId, sessionId, programId, skillLevel, skillsRating, safetyAwareness, behaviorNotes, remarks } = req.body;

    if (!studentId || !remarks) {
      return next(new AppError('Student ID and progress remarks are required', 400));
    }

    if (!isSuperAdmin) {
      // Verify that this student is assigned to at least one of the coach's sessions
      const coachFilter = getCoachScheduleFilter(coachUserId, false);
      const isStudentAssigned = await Schedule.exists({
        ...coachFilter,
        $or: [{ student: studentId }, { participants: studentId }],
      });

      if (!isStudentAssigned) {
        return next(new AppError('Access denied. You can only record progress notes for your assigned students.', 403));
      }
    }

    if (sessionId) {
      await verifyCoachSessionAssignment(sessionId, coachUserId, isSuperAdmin);
    }

    const progressNote = await ProgressNote.create({
      student: studentId,
      coach: coachUserId,
      session: sessionId || null,
      program: programId || null,
      skillLevel: skillLevel || 'Beginner',
      skillsRating: skillsRating || 4,
      safetyAwareness: safetyAwareness || 'Good adherence to water safety.',
      behaviorNotes: behaviorNotes || 'Enthusiastic participant.',
      remarks,
    });

    // Also update StudentProfile skillLevel if updated
    if (skillLevel) {
      await StudentProfile.findOneAndUpdate(
        { user: studentId },
        { skillLevel },
        { upsert: true }
      );
    }

    const populated = await ProgressNote.findById(progressNote._id)
      .populate('student', 'fullName email')
      .populate('coach', 'fullName email')
      .populate('program', 'title');

    res.status(201).json({
      success: true,
      message: 'Progress note recorded successfully.',
      data: populated,
    });
  } catch (err) {
    next(err);
  }
};

// 6. GET /api/v1/coach/students
exports.getAssignedStudents = async (req, res, next) => {
  try {
    const coachUserId = req.user._id;
    const isSuperAdmin = req.user.role?.slug === 'super-admin' || req.user.role?.slug === 'admin';

    const filter = getCoachScheduleFilter(coachUserId, isSuperAdmin);

    // Get all sessions assigned to coach
    const sessions = await Schedule.find(filter).select('student participants');
    
    // Extract unique assigned students from single student and group participants array
    const studentIdSet = new Set();
    sessions.forEach((s) => {
      if (s.student) studentIdSet.add(s.student.toString());
      if (Array.isArray(s.participants)) {
        s.participants.forEach((p) => {
          if (p) studentIdSet.add(p.toString());
        });
      }
    });

    const assignedUserIds = Array.from(studentIdSet);

    // 1. Fetch StudentProfiles for registered users
    const studentProfiles = await StudentProfile.find({
      user: { $in: assignedUserIds },
    })
      .populate('user', 'fullName email phone avatarUrl')
      .populate('primaryBranch', 'name code')
      .populate('enrolledPrograms', 'title code')
      .sort({ createdAt: -1 });

    const existingUserIds = new Set(studentProfiles.map((sp) => sp.user?._id?.toString()));
    const missingIds = assignedUserIds.filter((id) => !existingUserIds.has(id));

    // 2. Fetch Customer records for any CRM students not in StudentProfile
    let customerProfiles = [];
    if (missingIds.length > 0) {
      const customers = await Customer.find({ _id: { $in: missingIds } });
      customerProfiles = customers.map((c) => ({
        _id: c._id,
        user: {
          _id: c._id,
          fullName: c.fullName,
          email: c.email,
          phone: c.phone,
        },
        studentCode: c.phone ? `STD-${c.phone.slice(-4)}` : 'STD-GUEST',
        skillLevel: 'Beginner',
        primaryBranch: null,
        medicalNotes: c.hasBehaviouralNeeds ? c.behaviouralNeedsDetails : 'No known allergies or medical restrictions.',
        dietaryNotes: 'Standard diet.',
        emergencyContact: {
          name: c.parentFullName || 'Parent On Record',
          phone: c.parentPhone || c.phone,
          relationship: c.parentRelationship || 'Guardian',
        },
        mediaConsent: c.socialMediaConsent !== false,
      }));
    }

    const combined = [...studentProfiles, ...customerProfiles];

    res.status(200).json({
      success: true,
      count: combined.length,
      data: combined,
    });
  } catch (err) {
    next(err);
  }
};

// 7. POST /api/v1/coach/reports
exports.submitSessionReport = async (req, res, next) => {
  try {
    const coachUserId = req.user._id;
    const isSuperAdmin = req.user.role?.slug === 'super-admin' || req.user.role?.slug === 'admin';
    const { sessionId, deliveryStatus, summary, studentObservations, safetyIncidents, followUpRequired, upsellOpportunity, remarks } = req.body;

    if (!sessionId || !summary) {
      return next(new AppError('Session ID and summary are required for session report', 400));
    }

    const session = await verifyCoachSessionAssignment(sessionId, coachUserId, isSuperAdmin);

    const report = await SessionReport.findOneAndUpdate(
      { session: session._id },
      {
        session: session._id,
        coach: coachUserId,
        deliveryStatus: deliveryStatus || 'Completed',
        summary,
        attendanceCompleted: true,
        studentObservations: studentObservations || '',
        safetyIncidents: safetyIncidents || 'No incidents.',
        followUpRequired: !!followUpRequired,
        upsellOpportunity: upsellOpportunity || '',
        remarks: remarks || '',
      },
      { upsert: true, new: true, runValidators: true }
    );

    // Update Session status to Completed
    session.status = 'Completed';
    await session.save();

    // Sync status to CalendarEvent if linked
    if (session.calendarEvent) {
      try {
        await CalendarEvent.findByIdAndUpdate(session.calendarEvent, { status: 'completed' });
      } catch (ce) {
        console.warn('Could not sync status back to CalendarEvent:', ce.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Session completion report submitted successfully.',
      data: report,
    });
  } catch (err) {
    next(err);
  }
};

// 8. POST /api/v1/coach/media
exports.uploadSessionMedia = async (req, res, next) => {
  try {
    const coachUserId = req.user._id;
    const isSuperAdmin = req.user.role?.slug === 'super-admin' || req.user.role?.slug === 'admin';
    const { studentId, sessionId, title, fileUrl, mimeType } = req.body;

    if (!studentId || !fileUrl) {
      return next(new AppError('Student ID and file URL/data are required for media upload', 400));
    }

    // Verify media consent
    const studentProfile = await StudentProfile.findOne({ user: studentId });
    if (studentProfile && studentProfile.mediaConsent === false) {
      return next(new AppError('Media upload blocked: Student/Parent has declined media consent.', 403));
    }

    if (sessionId) {
      await verifyCoachSessionAssignment(sessionId, coachUserId, isSuperAdmin);
    }

    const mediaDoc = await Document.create({
      title: title || 'Session Photo / Media Upload',
      documentType: 'Other',
      student: studentId,
      uploadedBy: coachUserId,
      fileUrl,
      fileSize: '2.5 MB',
      mimeType: mimeType || 'image/jpeg',
      status: 'Approved',
    });

    res.status(201).json({
      success: true,
      message: 'Session media uploaded successfully.',
      data: mediaDoc,
    });
  } catch (err) {
    next(err);
  }
};

// 9. POST /api/v1/coach/achievements
exports.issueAchievement = async (req, res, next) => {
  try {
    const coachUserId = req.user._id;
    const isSuperAdmin = req.user.role?.slug === 'super-admin' || req.user.role?.slug === 'admin';
    const { studentId, title, badgeType, remarks } = req.body;

    if (!studentId || !title) {
      return next(new AppError('Student ID and badge title are required', 400));
    }

    if (!isSuperAdmin) {
      const coachFilter = getCoachScheduleFilter(coachUserId, false);
      const isStudentAssigned = await Schedule.exists({
        ...coachFilter,
        $or: [{ student: studentId }, { participants: studentId }],
      });

      if (!isStudentAssigned) {
        return next(new AppError('Access denied. You can only issue badges to your assigned students.', 403));
      }
    }

    const achievement = await Achievement.create({
      student: studentId,
      issuedBy: coachUserId,
      title,
      badgeType: badgeType || 'Knot Tying Specialist',
      remarks: remarks || 'Demonstrated outstanding fishing performance.',
      issuedDate: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Achievement badge awarded successfully.',
      data: achievement,
    });
  } catch (err) {
    next(err);
  }
};

// 10. GET /api/v1/coach/my-certifications
exports.getCoachCertifications = async (req, res, next) => {
  try {
    const coachUserId = req.user._id;
    const certs = await CoachCertification.find({ coach: coachUserId }).sort({ expiryDate: 1 });
    res.status(200).json({ success: true, count: certs.length, data: certs });
  } catch (err) {
    next(err);
  }
};

// 11. GET /api/v1/coach/admin/all-coaches
exports.getAllCoaches = async (req, res, next) => {
  try {
    const coachRoles = await Role.find({ slug: { $in: ['coach', 'instructor', 'head-coach'] } });
    const coachRoleIds = coachRoles.map((r) => r._id);

    const coaches = await User.find({ role: { $in: coachRoleIds } })
      .populate('role', 'name slug')
      .populate('branch', 'name code')
      .select('fullName email phone avatarUrl status role branch');

    res.status(200).json({ success: true, count: coaches.length, data: coaches });
  } catch (err) {
    next(err);
  }
};
