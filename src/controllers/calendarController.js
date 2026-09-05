const CalendarEvent = require('../models/CalendarEvent');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
const Program = require('../models/Program');
const Branch = require('../models/Branch');
const Vessel = require('../models/Vessel');
const Schedule = require('../models/Schedule');
const Booking = require('../models/Booking');
const Invoice = require('../models/Invoice');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const { syncCalendarEventToSchedule, removeCalendarEventSchedule } = require('../utils/syncCalendarSchedule');

function addMinutesToTime(timeStr, minutes) {
  if (!timeStr || !timeStr.includes(':')) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const totalMins = (h * 60 + m + Number(minutes)) % (24 * 60);
  const newH = Math.floor(totalMins / 60);
  const newM = totalMins % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

function calculateMinutesDiff(startTime, endTime) {
  if (!startTime || !endTime || !startTime.includes(':') || !endTime.includes(':')) return 60;
  const [h1, m1] = startTime.split(':').map(Number);
  const [h2, m2] = endTime.split(':').map(Number);
  let diff = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (diff < 0) diff += 24 * 60;
  return diff > 0 ? diff : 60;
}

const POPULATE_FIELDS = [
  { path: 'lead', select: 'fullName phone email source stage' },
  { path: 'student', select: 'fullName phone email' },
  { path: 'teacher', select: 'fullName email branch' },
  { path: 'teachers', select: 'fullName email branch' },
  { path: 'program', select: 'title code category level price calendarColor durationWeeks sessionsCount' },
  { path: 'branch', select: 'name code city address' },
  { path: 'boat', select: 'name vesselId registrationNumber vesselType operationalStatus capacity branch' },
  { path: 'vessel', select: 'name vesselId registrationNumber vesselType operationalStatus capacity branch' },
  { path: 'createdBy', select: 'fullName email' },
  { path: 'registrations.lead', select: 'fullName phone email source stage' },
  { path: 'registrations.student', select: 'fullName phone email' },
];

const CATEGORY_COLOR_MAP = {
  'Fishing Essentials': 'blue',
  'Offshore & Deep Sea': 'emerald',
  'Kayak & Boating': 'teal',
  'Junior Angler': 'rose',
  'Spearfishing & Diving': 'purple',
  'Custom Private': 'amber',
};

const getCategoryColor = (category, programColor) => {
  if (programColor) return programColor;
  if (!category) return 'blue';
  return CATEGORY_COLOR_MAP[category] || 'blue';
};

const toDayStart = (value) => {
  if (!value) return new Date();
  const dateStr = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}T00:00:00.000Z`);
  }
  const d = new Date(value);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const toDayEnd = (value) => {
  if (!value) return new Date();
  const dateStr = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}T23:59:59.999Z`);
  }
  const d = new Date(value);
  d.setUTCHours(23, 59, 59, 999);
  return d;
};

const parseUtcDate = (value) => {
  if (!value) return new Date();
  const dateStr = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Date(`${dateStr}T00:00:00.000Z`);
  }
  return new Date(value);
};

/**
 * Helper to enrich calendar events with:
 * 1. Matching Program data and Color Theme
 * 2. Automated Financial / Invoice / Payment calculations
 */
const enrichEventsWithFinancials = async (events) => {
  if (!events || events.length === 0) return [];

  // 1. Fetch all programs to match subject/title if program ref isn't set
  const allPrograms = await Program.find().lean();
  const programMapById = new Map();
  const programMapByTitle = new Map();
  const programMapByCategory = new Map();

  allPrograms.forEach((p) => {
    programMapById.set(String(p._id), p);
    if (p.title) programMapByTitle.set(p.title.trim().toLowerCase(), p);
    if (p.code) programMapByTitle.set(p.code.trim().toLowerCase(), p);
    if (p.category) {
      if (!programMapByCategory.has(p.category.trim().toLowerCase())) {
        programMapByCategory.set(p.category.trim().toLowerCase(), p);
      }
    }
  });

  // 2. Collect all student/customer/lead IDs to batch query Invoices & Bookings
  const studentIds = new Set();
  const leadIds = new Set();

  events.forEach((ev) => {
    if (ev.student) studentIds.add(String(ev.student._id || ev.student));
    if (ev.lead) leadIds.add(String(ev.lead._id || ev.lead));
    if (Array.isArray(ev.registrations)) {
      ev.registrations.forEach((r) => {
        if (r.student) studentIds.add(String(r.student._id || r.student));
        if (r.lead) leadIds.add(String(r.lead._id || r.lead));
      });
    }
  });

  // Query Invoices for all involved students / customers
  const invoiceQuery = [];
  if (studentIds.size > 0) {
    const sIdList = Array.from(studentIds);
    invoiceQuery.push({ student: { $in: sIdList } });
    invoiceQuery.push({ customer: { $in: sIdList } });
  }

  let invoices = [];
  if (invoiceQuery.length > 0) {
    invoices = await Invoice.find({ $or: invoiceQuery })
      .select('invoiceNumber student customer booking program totalAmount amountPaid balanceDue status dueDate createdAt')
      .lean();
  }

  // Map invoices by student and program/booking
  const invoicesByStudent = new Map();
  invoices.forEach((inv) => {
    const sKey = String(inv.student || inv.customer);
    if (!invoicesByStudent.has(sKey)) invoicesByStudent.set(sKey, []);
    invoicesByStudent.get(sKey).push(inv);
  });

  // 3. Process each event
  const enriched = events.map((eventObj) => {
    const ev = eventObj.toObject ? eventObj.toObject() : { ...eventObj };

    // Resolve Program
    let matchedProgram = null;
    if (ev.program) {
      matchedProgram = typeof ev.program === 'object' ? ev.program : programMapById.get(String(ev.program));
    }

    const programCategory = matchedProgram?.category || 'Fishing Essentials';
    const baseColor = getCategoryColor(programCategory, matchedProgram?.calendarColor);
    const calendarColor = ev.calendarColor || baseColor;

    ev.programDetails = {
      _id: matchedProgram?._id || null,
      title: matchedProgram?.title || ev.title || 'Academy Program',
      code: matchedProgram?.code || 'PROG',
      category: programCategory,
      level: matchedProgram?.level || 'All Levels',
      calendarColor,
      price: matchedProgram?.price || 0,
      durationWeeks: matchedProgram?.durationWeeks || 4,
      sessionsCount: matchedProgram?.sessionsCount || 8,
    };

    // Calculate duration in hours
    let durationMinutes = 120; // default 2 hours
    if (ev.startTime && ev.endTime) {
      const [sh, sm] = ev.startTime.split(':').map(Number);
      const [eh, em] = ev.endTime.split(':').map(Number);
      if (!isNaN(sh) && !isNaN(eh)) {
        durationMinutes = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
        if (durationMinutes <= 0) durationMinutes = 120;
      }
    }
    const durationHours = Math.round((durationMinutes / 60) * 10) / 10;
    ev.duration = `${durationHours}h`;

    // Process Registrations & Automated Invoice / Payment Status
    const regs = Array.isArray(ev.registrations) ? ev.registrations : [];
    let paidCount = 0;
    let partiallyPaidCount = 0;
    let overdueCount = 0;
    let invoicedCount = 0;
    let pendingCount = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;

    const enrichedRegistrations = regs.map((reg) => {
      const regObj = { ...reg };
      const sId = reg.student?._id ? String(reg.student._id) : (reg.student ? String(reg.student) : null);
      let regInvoice = null;

      if (sId && invoicesByStudent.has(sId)) {
        const candidateInvoices = invoicesByStudent.get(sId);
        // Find exact invoice for this program or recent invoice
        if (matchedProgram) {
          regInvoice = candidateInvoices.find((inv) => String(inv.program) === String(matchedProgram._id));
        }
        if (!regInvoice && candidateInvoices.length > 0) {
          regInvoice = candidateInvoices[0];
        }
      }

      // Automated Payment Calculation
      let autoPaymentStatus = 'Pending';
      const now = new Date();

      if (regInvoice) {
        regObj.invoice = {
          _id: regInvoice._id,
          invoiceNumber: regInvoice.invoiceNumber,
          totalAmount: regInvoice.totalAmount,
          amountPaid: regInvoice.amountPaid,
          balanceDue: regInvoice.balanceDue,
          status: regInvoice.status,
          dueDate: regInvoice.dueDate,
        };
        totalCollected += regInvoice.amountPaid || 0;
        totalOutstanding += regInvoice.balanceDue || 0;

        if (regInvoice.status === 'Refunded') {
          autoPaymentStatus = 'Refunded';
        } else if (regInvoice.status === 'Partially Refunded') {
          autoPaymentStatus = 'Partially Refunded';
        } else if (regInvoice.status === 'Paid' || regInvoice.balanceDue <= 0) {
          autoPaymentStatus = 'Paid';
        } else if (regInvoice.status === 'Partially Paid' || (regInvoice.amountPaid > 0 && regInvoice.balanceDue > 0)) {
          autoPaymentStatus = 'Partially Paid';
        } else if (regInvoice.status === 'Overdue' || (regInvoice.dueDate && new Date(regInvoice.dueDate) < now && regInvoice.balanceDue > 0)) {
          autoPaymentStatus = 'Overdue';
        } else if (regInvoice.status === 'Cancelled') {
          autoPaymentStatus = 'Cancelled';
        } else {
          autoPaymentStatus = 'Invoiced';
        }
      } else if (reg.paymentStatus === 'Paid') {
        autoPaymentStatus = 'Paid';
      } else {
        autoPaymentStatus = 'Pending';
      }

      regObj.autoPaymentStatus = autoPaymentStatus;

      if (autoPaymentStatus === 'Paid') paidCount++;
      else if (autoPaymentStatus === 'Partially Paid') partiallyPaidCount++;
      else if (autoPaymentStatus === 'Overdue') overdueCount++;
      else if (autoPaymentStatus === 'Invoiced') invoicedCount++;
      else pendingCount++;

      return regObj;
    });

    ev.registrations = enrichedRegistrations;
    const totalRegs = enrichedRegistrations.length;

    // Determine overall session financial status
    let aggregateStatus = 'PENDING';
    let statusLabel = 'PENDING';

    if (totalRegs === 0) {
      aggregateStatus = 'SCHEDULED';
      statusLabel = 'NO STUDENTS';
    } else if (overdueCount > 0) {
      aggregateStatus = 'OVERDUE';
      statusLabel = overdueCount === totalRegs ? 'OVERDUE' : `${overdueCount}/${totalRegs} OVERDUE`;
    } else if (paidCount === totalRegs && totalRegs > 0) {
      aggregateStatus = 'PAID';
      statusLabel = totalRegs > 1 ? `PAID (${totalRegs}/${totalRegs})` : 'PAID';
    } else if (partiallyPaidCount > 0 || (paidCount > 0 && paidCount < totalRegs)) {
      aggregateStatus = 'PARTIALLY PAID';
      statusLabel = `${paidCount}/${totalRegs} PAID`;
    } else if (invoicedCount > 0) {
      aggregateStatus = 'INVOICED';
      statusLabel = 'INVOICED';
    } else {
      aggregateStatus = 'PENDING';
      statusLabel = 'PENDING';
    }

    ev.financialSummary = {
      aggregateStatus,
      statusLabel,
      totalRegistrations: totalRegs,
      paidCount,
      partiallyPaidCount,
      overdueCount,
      invoicedCount,
      pendingCount,
      totalCollected,
      totalOutstanding,
    };

    return ev;
  });

  return enriched;
};

/**
 * GET /api/v1/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD&teacher=&subject=&location=&type=&eventType=&publishedStatus=&capacity=
 * Powers the calendar view (month/week/day/list).
 */
exports.getCalendarEvents = catchAsync(async (req, res, next) => {
  const { start, end, teacher, staff, type, eventType, status, publishedStatus, location, subject, capacity } = req.query;

  const filter = {};

  if (start || end) {
    filter.date = {};
    if (start) filter.date.$gte = toDayStart(start);
    if (end) filter.date.$lte = toDayEnd(end);
  }

  const userId = req.user?._id || req.user?.id;
  const roleSlug = req.user?.role?.slug || (typeof req.user?.role === 'string' ? req.user.role : '');
  const isCoach = roleSlug === 'coach' || roleSlug === 'instructor' || roleSlug === 'head-coach';

  const staffQuery = isCoach ? String(userId) : (teacher || staff);
  if (staffQuery) {
    const teacherIds = String(staffQuery).split(',').map((s) => s.trim()).filter(Boolean);
    if (teacherIds.length) {
      filter.$or = [
        { teacher: teacherIds.length > 1 ? { $in: teacherIds } : teacherIds[0] },
        { teachers: teacherIds.length > 1 ? { $in: teacherIds } : teacherIds[0] },
      ];
    }
  }

  if (location) {
    const locations = String(location).split(',').map((s) => s.trim()).filter(Boolean);
    if (locations.length) filter.location = locations.length > 1 ? { $in: locations } : locations[0];
  }

  if (subject) {
    const subjects = String(subject).split(',').map((s) => s.trim()).filter(Boolean);
    if (subjects.length) filter.subject = subjects.length > 1 ? { $in: subjects } : subjects[0];
  }

  if (type) filter.type = type;
  if (eventType) filter.eventType = eventType;
  if (status) filter.status = status;
  if (publishedStatus) filter.publishedStatus = publishedStatus;

  if (capacity) {
    if (capacity === 'limited') filter.seatType = 'limited';
    else if (capacity === 'unlimited') filter.seatType = 'unlimited';
  }

  const rawEvents = await CalendarEvent.find(filter)
    .populate(POPULATE_FIELDS)
    .sort({ date: 1, startTime: 1 });

  // Also query active Schedule sessions in date range to ensure full calendar coverage
  const scheduleFilter = {};
  if (start || end) {
    scheduleFilter.startTime = {};
    if (start) scheduleFilter.startTime.$gte = toDayStart(start);
    if (end) scheduleFilter.startTime.$lte = toDayEnd(end);
  }
  if (isCoach) {
    scheduleFilter.$or = [
      { instructor: userId },
      { captain: userId },
      { assistantCoach: userId },
      { supportStaff: userId },
    ];
  } else if (staffQuery) {
    const teacherIds = String(staffQuery).split(',').map((s) => s.trim()).filter(Boolean);
    if (teacherIds.length) {
      scheduleFilter.$or = [
        { instructor: teacherIds.length > 1 ? { $in: teacherIds } : teacherIds[0] },
        { assistantCoach: teacherIds.length > 1 ? { $in: teacherIds } : teacherIds[0] },
        { supportStaff: teacherIds.length > 1 ? { $in: teacherIds } : teacherIds[0] },
      ];
    }
  }

  const rawSchedules = await Schedule.find(scheduleFilter)
    .populate('program branch instructor student participants booking')
    .sort({ startTime: 1 })
    .lean();

  // Deduplicate schedules that are already represented as CalendarEvents
  const existingEventIds = new Set(rawEvents.map((e) => String(e._id)));
  const standaloneSchedules = rawSchedules.filter(
    (sch) => !sch.calendarEvent || !existingEventIds.has(String(sch.calendarEvent))
  );

  const convertedSchedules = standaloneSchedules.map((sch) => {
    const sDate = new Date(sch.startTime);
    const eDate = sch.endTime ? new Date(sch.endTime) : new Date(sDate.getTime() + 2 * 3600 * 1000);
    const pad = (n) => String(n).padStart(2, '0');
    const startStr = `${pad(sDate.getHours())}:${pad(sDate.getMinutes())}`;
    const endStr = `${pad(eDate.getHours())}:${pad(eDate.getMinutes())}`;

    const initialRegs = [];
    if (sch.student) {
      initialRegs.push({
        _id: sch.student._id || sch.student,
        kind: 'enrolled',
        student: sch.student,
        attendance: sch.attendance?.toLowerCase() || 'pending',
        paymentStatus: 'No Invoice',
      });
    }
    if (Array.isArray(sch.participants)) {
      sch.participants.forEach((p) => {
        initialRegs.push({
          _id: p._id || p,
          kind: 'enrolled',
          student: p,
          attendance: 'pending',
          paymentStatus: 'No Invoice',
        });
      });
    }

    return {
      _id: sch._id,
      type: sch.sessionType ? sch.sessionType.toLowerCase() : 'class',
      eventType: 'one-time',
      subject: sch.program?.category || sch.program?.title || 'Fishing Essentials',
      title: sch.title,
      program: sch.program,
      branch: sch.branch,
      date: sDate,
      startTime: startStr,
      endTime: endStr,
      teacher: sch.instructor || null,
      teachers: sch.instructor ? [sch.instructor] : [],
      location: sch.location || sch.branch?.name || '',
      seatType: 'limited',
      capacity: sch.maxCapacity || 10,
      status: sch.status === 'Completed' ? 'completed' : sch.status === 'Cancelled' ? 'cancelled' : 'scheduled',
      registrations: initialRegs,
      isScheduleModel: true,
    };
  });

  const combinedRaw = [...rawEvents, ...convertedSchedules];

  // Enrich with Program colors and automated Financial calculations
  const events = await enrichEventsWithFinancials(combinedRaw);

  return sendResponse(res, 200, 'Calendar events fetched successfully.', events);
});

/**
 * GET /api/v1/calendar/teachers
 */
exports.getTeacherOptions = catchAsync(async (req, res) => {
  const teachers = await User.find({ status: 'active' })
    .populate('role', 'name slug')
    .select('fullName email role branch')
    .sort({ fullName: 1 });

  return sendResponse(res, 200, 'Teacher options fetched successfully.', teachers);
});

/**
 * GET /api/v1/calendar/locations
 */
exports.getLocationOptions = catchAsync(async (req, res) => {
  const Branch = require('../models/Branch');
  const activeBranches = await Branch.find({ isActive: true }).select('name').sort({ name: 1 });
  const locations = activeBranches.map((b) => b.name);

  return sendResponse(res, 200, 'Location options fetched successfully.', locations);
});

/**
 * GET /api/v1/calendar/subjects
 */

/**
 * GET /api/v1/calendar/:id
 */
exports.getCalendarEvent = catchAsync(async (req, res, next) => {
  const event = await CalendarEvent.findById(req.params.id).populate(POPULATE_FIELDS);
  if (!event) return next(new AppError('Calendar event not found.', 404));

  const [enriched] = await enrichEventsWithFinancials([event]);
  return sendResponse(res, 200, 'Calendar event fetched successfully.', enriched || event);
});

/**
 * POST /api/v1/calendar
 */
exports.createCalendarEvent = catchAsync(async (req, res, next) => {
  const {
    type = 'class',
    eventType = 'one-time',
    subject = '',
    durationMinutes,
    title,
    program,
    branch,
    classDescription = '',
    internalNotes = '',
    date,
    startTime,
    endTime,
    lead,
    student,
    teacher,
    teachers = [],
    isOnline = false,
    location = '',
    seatType = 'unlimited',
    capacity = null,
    publishedStatus = 'published',
    notes = '',
    calendarColor = '',
    venue = 'Classroom',
    boat = null,
    vessel = null,
    transportationRequired = false,
    transportation = false,
  } = req.body;

  if (!date) return next(new AppError('Date is required.', 400));
  if (!startTime) return next(new AppError('Start time is required.', 400));

  let validatedBranchId = null;
  let branchName = '';
  if (branch) {
    const Branch = require('../models/Branch');
    const branchDoc = await Branch.findById(branch);
    if (!branchDoc || !branchDoc.isActive) {
      return next(new AppError('Invalid or inactive branch selected.', 400));
    }
    validatedBranchId = branchDoc._id;
    branchName = branchDoc.name;
  }

  const normalizedVenue = String(venue || 'Classroom').toLowerCase() === 'boat' ? 'Boat' : 'Classroom';
  let selectedBoatId = null;

  if (normalizedVenue === 'Boat') {
    selectedBoatId = boat || vessel || req.body.boat || req.body.vessel || null;
    if (!selectedBoatId) {
      return next(new AppError('Please select a Boat for this boat session.', 400));
    }
    const boatDoc = await Vessel.findById(selectedBoatId);
    if (!boatDoc) {
      return next(new AppError('Selected boat not found.', 404));
    }
    if (['Maintenance', 'Out of Service', 'Unavailable'].includes(boatDoc.operationalStatus)) {
      return next(new AppError(`Boat "${boatDoc.name}" is currently ${boatDoc.operationalStatus} and cannot be assigned.`, 400));
    }
  }

  let programDoc = null;
  if (program) {
    programDoc = await Program.findById(program);
    if (programDoc && programDoc.status === 'inactive') {
      return next(new AppError('This program is archived and cannot be used for new events.', 400));
    }
  }

  // Determine duration and end time
  const defaultDuration = programDoc ? (programDoc.durationHours || 0) * 60 + (programDoc.durationMinutes || 0) : 60;
  let finalDuration = durationMinutes ? Number(durationMinutes) : (defaultDuration || 60);
  let finalEndTime = endTime;

  if (!finalEndTime && startTime && finalDuration) {
    finalEndTime = addMinutesToTime(startTime, finalDuration);
  } else if (startTime && finalEndTime && !durationMinutes) {
    finalDuration = calculateMinutesDiff(startTime, finalEndTime);
  }

  let autoTitle = title;
  let leadDoc = null;
  let studentDoc = null;

  if (lead) {
    leadDoc = await Lead.findById(lead);
    if (!autoTitle && leadDoc) autoTitle = `Demo class — ${leadDoc.fullName}`;
  }
  if (student) {
    studentDoc = await Customer.findById(student);
    if (!autoTitle && studentDoc) autoTitle = `Class — ${studentDoc.fullName}`;
  }

  if (!autoTitle) {
    autoTitle = programDoc ? `${programDoc.title} Session` : 'New Event';
  }

  const assignedTeachers = Array.isArray(teachers) ? teachers.filter(Boolean) : [];
  const primaryTeacher = teacher || assignedTeachers[0] || null;
  if (primaryTeacher && !assignedTeachers.includes(primaryTeacher)) {
    assignedTeachers.unshift(primaryTeacher);
  }

  let teacherDoc = null;
  if (primaryTeacher) {
    teacherDoc = await User.findById(primaryTeacher);
  }

  const initialRegistrations = [];
  if (lead) initialRegistrations.push({ kind: 'trial', lead, student: null });
  else if (student) initialRegistrations.push({ kind: 'enrolled', lead: null, student });

  if (normalizedVenue === 'Boat' && selectedBoatId) {
    const eventDate = parseUtcDate(date);
    const eventStart = startTime;
    const eventEnd = finalEndTime || (startTime && finalDuration ? addMinutesToTime(startTime, finalDuration) : '');

    if (eventDate && eventStart && eventEnd) {
      const overlap = await CalendarEvent.findOne({
        date: eventDate,
        status: { $ne: 'cancelled' },
        venue: 'Boat',
        $or: [{ boat: selectedBoatId }, { vessel: selectedBoatId }],
        startTime: { $lt: eventEnd },
        endTime: { $gt: eventStart },
      });

      if (overlap) {
        const boatDoc = await Vessel.findById(selectedBoatId);
        return next(new AppError(`Boat "${boatDoc?.name || 'Selected Boat'}" is already assigned to overlapping event "${overlap.title}" (${overlap.startTime} - ${overlap.endTime}).`, 400));
      }
    }
  }

  const isTrans = Boolean(transportationRequired || transportation || req.body.transportationRequired || req.body.transportation);

  const event = await CalendarEvent.create({
    type,
    eventType,
    durationMinutes: finalDuration,
    title: autoTitle,
    program: program || null,
    calendarColor,
    branch: validatedBranchId,
    venue: normalizedVenue,
    boat: normalizedVenue === 'Boat' ? selectedBoatId : null,
    vessel: normalizedVenue === 'Boat' ? selectedBoatId : null,
    transportationRequired: isTrans,
    transportation: isTrans,
    classDescription,
    internalNotes,
    date: parseUtcDate(date),
    startTime,
    endTime: finalEndTime || '',
    lead: lead || null,
    student: student || null,
    teacher: primaryTeacher,
    teachers: assignedTeachers,
    isOnline: Boolean(isOnline),
    location: isOnline ? '' : location || branchName || teacherDoc?.branch || '',
    seatType,
    capacity: seatType === 'limited' ? Number(capacity) || 10 : null,
    publishedStatus,
    notes: notes || internalNotes || '',
    registrations: initialRegistrations,
    createdBy: req.user._id,
  });

  await event.populate(POPULATE_FIELDS);
  await syncCalendarEventToSchedule(event);
  const [enriched] = await enrichEventsWithFinancials([event]);

  return sendResponse(res, 201, 'Added to the calendar.', enriched || event);
});

/**
 * PATCH /api/v1/calendar/:id
 */
exports.updateCalendarEvent = catchAsync(async (req, res, next) => {
  const disallowed = ['createdBy', 'registrations'];
  disallowed.forEach((field) => delete req.body[field]);

  if (req.body.date) {
    req.body.date = parseUtcDate(req.body.date);
  }

  if (req.body.startTime && req.body.durationMinutes && !req.body.endTime) {
    req.body.endTime = addMinutesToTime(req.body.startTime, Number(req.body.durationMinutes));
  } else if (req.body.startTime && req.body.endTime && !req.body.durationMinutes) {
    req.body.durationMinutes = calculateMinutesDiff(req.body.startTime, req.body.endTime);
  }

  if (req.body.teachers && Array.isArray(req.body.teachers)) {
    req.body.teacher = req.body.teachers[0] || req.body.teacher || null;
  } else if (req.body.teacher) {
    req.body.teachers = [req.body.teacher];
  }

  if (req.body.isOnline) {
    req.body.location = '';
  }

  if (req.body.seatType === 'unlimited') {
    req.body.capacity = null;
  }

  if (req.body.internalNotes) {
    req.body.notes = req.body.internalNotes;
  }

  const existingEvent = await CalendarEvent.findById(req.params.id);
  if (!existingEvent) return next(new AppError('Calendar event not found.', 404));

  if (req.body.venue !== undefined) {
    const normVenue = String(req.body.venue).toLowerCase() === 'boat' ? 'Boat' : 'Classroom';
    req.body.venue = normVenue;

    if (normVenue === 'Boat') {
      const bId = req.body.boat || req.body.vessel || existingEvent.boat || existingEvent.vessel;
      if (!bId) {
        return next(new AppError('Please select a Boat for this boat session.', 400));
      }
      const boatDoc = await Vessel.findById(bId);
      if (!boatDoc) {
        return next(new AppError('Selected boat not found.', 404));
      }
      if (['Maintenance', 'Out of Service', 'Unavailable'].includes(boatDoc.operationalStatus)) {
        return next(new AppError(`Boat "${boatDoc.name}" is currently ${boatDoc.operationalStatus} and cannot be assigned.`, 400));
      }

      const eventDate = req.body.date ? parseUtcDate(req.body.date) : existingEvent.date;
      const eventStart = req.body.startTime || existingEvent.startTime;
      const eventEnd = req.body.endTime || existingEvent.endTime;

      if (eventDate && eventStart && eventEnd) {
        const overlap = await CalendarEvent.findOne({
          _id: { $ne: req.params.id },
          date: eventDate,
          status: { $ne: 'cancelled' },
          venue: 'Boat',
          $or: [{ boat: bId }, { vessel: bId }],
          startTime: { $lt: eventEnd },
          endTime: { $gt: eventStart },
        });

        if (overlap) {
          return next(new AppError(`Boat "${boatDoc.name}" is already assigned to overlapping event "${overlap.title}" (${overlap.startTime} - ${overlap.endTime}).`, 400));
        }
      }
      req.body.boat = bId;
      req.body.vessel = bId;
    } else {
      req.body.boat = null;
      req.body.vessel = null;
    }
  }

  if (req.body.transportationRequired !== undefined || req.body.transportation !== undefined) {
    const transVal = Boolean(req.body.transportationRequired || req.body.transportation);
    req.body.transportationRequired = transVal;
    req.body.transportation = transVal;
  }

  if (req.body.program && String(req.body.program) !== String(existingEvent.program)) {
    const programDoc = await Program.findById(req.body.program);
    if (programDoc && programDoc.status === 'inactive') {
      return next(new AppError('This program is archived and cannot be used for events.', 400));
    }
  }

  if (req.body.branch !== undefined) {
    if (req.body.branch) {
      const Branch = require('../models/Branch');
      const branchDoc = await Branch.findById(req.body.branch);
      if (!branchDoc || !branchDoc.isActive) {
        return next(new AppError('Invalid or inactive branch selected.', 400));
      }
      req.body.branch = branchDoc._id;
      if (!req.body.location) req.body.location = branchDoc.name;
    } else {
      req.body.branch = null;
    }
  }

  const event = await CalendarEvent.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate(POPULATE_FIELDS);

  if (!event) return next(new AppError('Calendar event not found.', 404));

  await syncCalendarEventToSchedule(event);
  const [enriched] = await enrichEventsWithFinancials([event]);
  return sendResponse(res, 200, 'Calendar event updated.', enriched || event);
});

/**
 * PATCH /api/v1/calendar/:id/status
 */
exports.updateCalendarEventStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  if (!['scheduled', 'completed', 'cancelled', 'no_show'].includes(status)) {
    return next(new AppError('Invalid status.', 400));
  }

  const event = await CalendarEvent.findByIdAndUpdate(req.params.id, { status }, { new: true }).populate(
    POPULATE_FIELDS
  );

  if (!event) return next(new AppError('Calendar event not found.', 404));
  await syncCalendarEventToSchedule(event);
  return sendResponse(res, 200, 'Calendar event status updated.', event);
});

/**
 * DELETE /api/v1/calendar/:id
 */
exports.deleteCalendarEvent = catchAsync(async (req, res, next) => {
  const event = await CalendarEvent.findByIdAndDelete(req.params.id);
  if (!event) return next(new AppError('Calendar event not found.', 404));
  await removeCalendarEventSchedule(req.params.id);
  return sendResponse(res, 200, 'Calendar event removed.');
});

/**
 * POST /api/v1/calendar/:id/registrations
 */
exports.addRegistration = catchAsync(async (req, res, next) => {
  const { kind, studentId, leadId } = req.body;

  if (!['enrolled', 'trial', 'waitlist'].includes(kind)) {
    return next(new AppError('kind must be "enrolled", "trial" or "waitlist".', 400));
  }
  if (!studentId && !leadId) return next(new AppError('Select a student or a lead to add.', 400));
  if (studentId && leadId) return next(new AppError('Select only one of student or lead.', 400));

  const event = await CalendarEvent.findById(req.params.id);
  if (!event) return next(new AppError('Calendar event not found.', 404));

  if (event.seatType === 'limited' && event.capacity && event.registrations.length >= event.capacity) {
    return next(new AppError(`Event capacity reached (${event.capacity} seats max).`, 400));
  }

  if (studentId) {
    const studentDoc = await Customer.findById(studentId);
    if (!studentDoc) return next(new AppError('Student not found.', 404));
  }
  if (leadId) {
    const leadDoc = await Lead.findById(leadId);
    if (!leadDoc) return next(new AppError('Lead not found.', 404));
  }

  const alreadyOn = event.registrations.some(
    (r) =>
      (studentId && r.student && String(r.student) === String(studentId)) ||
      (leadId && r.lead && String(r.lead) === String(leadId))
  );
  if (alreadyOn) return next(new AppError('This person is already on this event.', 400));

  event.registrations.push({
    kind,
    student: studentId || null,
    lead: leadId || null,
    attendance: 'pending',
    paymentStatus: 'No Invoice',
  });
  await event.save();
  await event.populate(POPULATE_FIELDS);
  await syncCalendarEventToSchedule(event);

  return sendResponse(res, 201, 'Added to the event.', event);
});

/**
 * DELETE /api/v1/calendar/:id/registrations/:regId
 */
exports.removeRegistration = catchAsync(async (req, res, next) => {
  const event = await CalendarEvent.findById(req.params.id);
  if (!event) return next(new AppError('Calendar event not found.', 404));

  const registration = event.registrations.id(req.params.regId);
  if (!registration) return next(new AppError('Registration not found.', 404));

  registration.deleteOne();
  await event.save();
  await event.populate(POPULATE_FIELDS);
  await syncCalendarEventToSchedule(event);

  return sendResponse(res, 200, 'Removed from the event.', event);
});

/**
 * PATCH /api/v1/calendar/:id/registrations/:regId/attendance
 */
exports.updateRegistrationAttendance = catchAsync(async (req, res, next) => {
  const { attendance } = req.body;
  if (!['pending', 'present', 'absent'].includes(attendance)) {
    return next(new AppError('Invalid attendance value.', 400));
  }

  const event = await CalendarEvent.findById(req.params.id);
  if (!event) return next(new AppError('Calendar event not found.', 404));

  const registration = event.registrations.id(req.params.regId);
  if (!registration) return next(new AppError('Registration not found.', 404));

  registration.attendance = attendance;
  await event.save();
  await event.populate(POPULATE_FIELDS);
  await syncCalendarEventToSchedule(event);

  return sendResponse(res, 200, 'Attendance updated.', event);
});

/**
 * PATCH /api/v1/calendar/:id/registrations/:regId/payment-status
 */
exports.updateRegistrationPaymentStatus = catchAsync(async (req, res, next) => {
  const { paymentStatus } = req.body;
  if (!['Paid', 'Invoice Generated', 'No Invoice'].includes(paymentStatus)) {
    return next(new AppError('Invalid payment status value.', 400));
  }

  const event = await CalendarEvent.findById(req.params.id);
  if (!event) return next(new AppError('Calendar event not found.', 404));

  const registration = event.registrations.id(req.params.regId);
  if (!registration) return next(new AppError('Registration not found.', 404));

  registration.paymentStatus = paymentStatus;
  await event.save();
  await event.populate(POPULATE_FIELDS);

  return sendResponse(res, 200, 'Payment status updated.', event);
});

/**
 * POST /api/v1/calendar/quick-student
 * Creates a quick student (Customer) directly from the calendar drawer
 */
exports.quickCreateStudent = catchAsync(async (req, res, next) => {
  const { fullName, phone, email, notes } = req.body;
  if (!fullName) return next(new AppError('Student name is required.', 400));

  const cleanPhone = phone ? phone.trim() : `+1${Date.now().toString().slice(-9)}`;
  
  const student = await Customer.create({
    fullName: fullName.trim(),
    phone: cleanPhone,
    email: email ? email.trim() : '',
    notes: notes || 'Quick added via Calendar',
    status: 'active',
  });

  return sendResponse(res, 201, 'Student created successfully.', student);
});
