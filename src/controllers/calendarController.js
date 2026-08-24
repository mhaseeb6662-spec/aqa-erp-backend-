const CalendarEvent = require('../models/CalendarEvent');
const Lead = require('../models/Lead');
const Customer = require('../models/Customer');
const User = require('../models/User');
const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const sendResponse = require('../utils/apiResponse');
const { CALENDAR_SUBJECT_OPTIONS } = require('../config/crm.constants');

const POPULATE_FIELDS = [
  { path: 'lead', select: 'fullName phone email source stage' },
  { path: 'student', select: 'fullName phone email' },
  { path: 'teacher', select: 'fullName email branch' },
  { path: 'teachers', select: 'fullName email branch' },
  { path: 'createdBy', select: 'fullName email' },
  { path: 'registrations.lead', select: 'fullName phone email source stage' },
  { path: 'registrations.student', select: 'fullName phone email' },
];

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

  const staffQuery = teacher || staff;
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

  const events = await CalendarEvent.find(filter)
    .populate(POPULATE_FIELDS)
    .sort({ date: 1, startTime: 1 });

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
  const branches = await User.distinct('branch', { status: 'active' });
  const locations = branches.filter(Boolean).sort((a, b) => a.localeCompare(b));

  return sendResponse(res, 200, 'Location options fetched successfully.', locations);
});

/**
 * GET /api/v1/calendar/subjects
 */
exports.getSubjectOptions = catchAsync(async (req, res) => {
  const dbSubjects = await CalendarEvent.distinct('subject');
  const combined = Array.from(new Set([...CALENDAR_SUBJECT_OPTIONS, ...dbSubjects]))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  return sendResponse(res, 200, 'Subject options fetched successfully.', combined);
});

/**
 * GET /api/v1/calendar/:id
 */
exports.getCalendarEvent = catchAsync(async (req, res, next) => {
  const event = await CalendarEvent.findById(req.params.id).populate(POPULATE_FIELDS);
  if (!event) return next(new AppError('Calendar event not found.', 404));
  return sendResponse(res, 200, 'Calendar event fetched successfully.', event);
});

/**
 * POST /api/v1/calendar
 */
exports.createCalendarEvent = catchAsync(async (req, res, next) => {
  const {
    type = 'class',
    eventType = 'one-time',
    subject = '',
    title,
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
  } = req.body;

  if (!date) return next(new AppError('Date is required.', 400));
  if (!startTime) return next(new AppError('Start time is required.', 400));

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
    autoTitle = subject ? `${subject} Session` : 'New Event';
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

  const event = await CalendarEvent.create({
    type,
    eventType,
    subject,
    title: autoTitle,
    classDescription,
    internalNotes,
    date: parseUtcDate(date),
    startTime,
    endTime: endTime || '',
    lead: lead || null,
    student: student || null,
    teacher: primaryTeacher,
    teachers: assignedTeachers,
    isOnline: Boolean(isOnline),
    location: isOnline ? '' : location || teacherDoc?.branch || '',
    seatType,
    capacity: seatType === 'limited' ? Number(capacity) || 10 : null,
    publishedStatus,
    notes: notes || internalNotes || '',
    registrations: initialRegistrations,
    createdBy: req.user._id,
  });

  await event.populate(POPULATE_FIELDS);

  return sendResponse(res, 201, 'Added to the calendar.', event);
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

  const event = await CalendarEvent.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate(POPULATE_FIELDS);

  if (!event) return next(new AppError('Calendar event not found.', 404));
  return sendResponse(res, 200, 'Calendar event updated.', event);
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
  return sendResponse(res, 200, 'Calendar event status updated.', event);
});

/**
 * DELETE /api/v1/calendar/:id
 */
exports.deleteCalendarEvent = catchAsync(async (req, res, next) => {
  const event = await CalendarEvent.findByIdAndDelete(req.params.id);
  if (!event) return next(new AppError('Calendar event not found.', 404));
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
