const Schedule = require('../models/Schedule');
const CalendarEvent = require('../models/CalendarEvent');
const Program = require('../models/Program');
const Branch = require('../models/Branch');
const User = require('../models/User');
const Customer = require('../models/Customer');

function combineDateAndTime(dateVal, timeStr, defaultHour = 9, defaultMinute = 0) {
  if (!dateVal) {
    const d = new Date();
    d.setUTCHours(defaultHour, defaultMinute, 0, 0);
    return d;
  }

  let datePart = '';
  if (typeof dateVal === 'string') {
    datePart = dateVal.slice(0, 10);
  } else if (dateVal instanceof Date) {
    const y = dateVal.getUTCFullYear();
    const m = String(dateVal.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateVal.getUTCDate()).padStart(2, '0');
    datePart = `${y}-${m}-${d}`;
  }

  let h = defaultHour;
  let m = defaultMinute;
  if (timeStr && typeof timeStr === 'string' && timeStr.includes(':')) {
    const [hPart, mPart] = timeStr.split(':').map(Number);
    if (!isNaN(hPart)) h = hPart;
    if (!isNaN(mPart)) m = mPart;
  }

  const result = new Date(`${datePart}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`);
  return isNaN(result.getTime()) ? new Date() : result;
}

function mapEventStatusToSchedule(eventStatus) {
  if (!eventStatus) return 'Scheduled';
  const s = String(eventStatus).toLowerCase();
  if (s === 'completed') return 'Completed';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'no_show' || s === 'no show') return 'No Show';
  if (s === 'rescheduled') return 'Rescheduled';
  return 'Scheduled';
}

function mapEventTypeToSessionType(type) {
  if (!type) return 'Class';
  const t = String(type).toLowerCase();
  if (t === 'camp') return 'Camp';
  if (t === 'trip') return 'Trip';
  return 'Class';
}

async function resolveStudentUserIds(eventDoc) {
  const userIds = new Set();

  const candidateCustomerIds = new Set();
  if (eventDoc.student) {
    candidateCustomerIds.add(String(eventDoc.student._id || eventDoc.student));
  }
  if (Array.isArray(eventDoc.registrations)) {
    eventDoc.registrations.forEach((r) => {
      if (r.student) candidateCustomerIds.add(String(r.student._id || r.student));
    });
  }

  if (candidateCustomerIds.size > 0) {
    const cIds = Array.from(candidateCustomerIds);
    // 1. Direct check if ID is already a User._id
    const matchingUsers = await User.find({ _id: { $in: cIds } }).select('_id');
    matchingUsers.forEach((u) => userIds.add(String(u._id)));

    // 2. If Customer documents, look up linked Users by email or phone
    const customers = await Customer.find({ _id: { $in: cIds } }).select('email phone');
    if (customers.length > 0) {
      const emails = customers.map((c) => c.email).filter(Boolean);
      const phones = customers.map((c) => c.phone).filter(Boolean);

      const orCond = [];
      if (emails.length > 0) orCond.push({ email: { $in: emails } });
      if (phones.length > 0) orCond.push({ phone: { $in: phones } });

      if (orCond.length > 0) {
        const users = await User.find({ $or: orCond }).select('_id');
        users.forEach((u) => userIds.add(String(u._id)));
      }
    }

    // 3. Fall back to the customer/student IDs themselves if no User record exists yet
    cIds.forEach((id) => userIds.add(id));
  }

  return Array.from(userIds);
}

/**
 * Synchronizes a CalendarEvent document into its counterpart Schedule document.
 */
async function syncCalendarEventToSchedule(eventDoc) {
  if (!eventDoc || !eventDoc._id) return null;

  try {
    // Resolve primary coach / assistant coach / support staff
    let primaryTeacher = eventDoc.teacher?._id || eventDoc.teacher || null;
    let teachersList = [];
    if (Array.isArray(eventDoc.teachers) && eventDoc.teachers.length > 0) {
      teachersList = eventDoc.teachers.map((t) => t._id || t).filter(Boolean);
    }
    if (!primaryTeacher && teachersList.length > 0) {
      primaryTeacher = teachersList[0];
    }
    if (primaryTeacher && !teachersList.some((t) => String(t) === String(primaryTeacher))) {
      teachersList.unshift(primaryTeacher);
    }

    const assistantCoach = teachersList.length > 1 ? teachersList[1] : null;
    const supportStaff = teachersList.length > 2 ? teachersList.slice(2) : [];

    // Ensure Program relation exists for Schedule validation
    let programId = eventDoc.program?._id || eventDoc.program || null;
    if (!programId) {
      const defaultProg = await Program.findOne().select('_id');
      if (defaultProg) programId = defaultProg._id;
    }

    // Ensure Branch relation exists for Schedule validation
    let branchId = eventDoc.branch?._id || eventDoc.branch || null;
    if (!branchId) {
      const defaultBranch = await Branch.findOne().select('_id');
      if (defaultBranch) branchId = defaultBranch._id;
    }

    // Compute start & end Date objects
    const startTime = combineDateAndTime(eventDoc.date, eventDoc.startTime, 9, 0);
    let endTime;
    if (eventDoc.endTime) {
      endTime = combineDateAndTime(eventDoc.date, eventDoc.endTime, 10, 0);
    } else {
      const dur = Number(eventDoc.durationMinutes) || 60;
      endTime = new Date(startTime.getTime() + dur * 60 * 1000);
    }

    const studentUserIds = await resolveStudentUserIds(eventDoc);
    const primaryStudent = studentUserIds.length > 0 ? studentUserIds[0] : null;

    const scheduleData = {
      calendarEvent: eventDoc._id,
      program: programId,
      branch: branchId,
      vessel: eventDoc.boat?._id || eventDoc.boat || eventDoc.vessel?._id || eventDoc.vessel || null,
      instructor: primaryTeacher,
      assistantCoach,
      supportStaff,
      title: eventDoc.title || 'Academy Session',
      startTime,
      endTime,
      location: eventDoc.location || '',
      sessionType: mapEventTypeToSessionType(eventDoc.type),
      status: mapEventStatusToSchedule(eventDoc.status),
      maxCapacity: eventDoc.capacity || 10,
      student: primaryStudent,
      participants: studentUserIds,
      notes: eventDoc.notes || eventDoc.internalNotes || '',
    };

    const schedule = await Schedule.findOneAndUpdate(
      { calendarEvent: eventDoc._id },
      scheduleData,
      { upsert: true, new: true, runValidators: false }
    );

    return schedule;
  } catch (err) {
    console.error(`Error syncing CalendarEvent ${eventDoc._id} to Schedule:`, err);
    return null;
  }
}

/**
 * Removes the Schedule linked to a CalendarEvent when deleted.
 */
async function removeCalendarEventSchedule(eventId) {
  if (!eventId) return;
  try {
    await Schedule.deleteMany({ calendarEvent: eventId });
  } catch (err) {
    console.error(`Error removing Schedule for CalendarEvent ${eventId}:`, err);
  }
}

/**
 * Scans all CalendarEvents and ensures every event has a corresponding Schedule document.
 */
async function syncAllExistingCalendarEvents() {
  try {
    const events = await CalendarEvent.find();
    let synced = 0;
    for (const ev of events) {
      await syncCalendarEventToSchedule(ev);
      synced++;
    }
    console.log(`[Sync] Successfully synchronized ${synced} CalendarEvents with Schedule model.`);
  } catch (err) {
    console.error('[Sync] Failed to sync existing CalendarEvents:', err);
  }
}

module.exports = {
  combineDateAndTime,
  mapEventStatusToSchedule,
  mapEventTypeToSessionType,
  resolveStudentUserIds,
  syncCalendarEventToSchedule,
  removeCalendarEventSchedule,
  syncAllExistingCalendarEvents,
};
