const mongoose = require('mongoose');
const {
  CALENDAR_EVENT_TYPES,
  CALENDAR_EVENT_REPEAT_TYPES,
  CALENDAR_EVENT_STATUSES,
  CALENDAR_REGISTRATION_KINDS,
  CALENDAR_ATTENDANCE_STATUSES,
  CALENDAR_SEAT_TYPES,
  CALENDAR_PUBLISHED_STATUSES,
  CALENDAR_REGISTRATION_PAYMENT_STATUSES,
} = require('../config/crm.constants');

/**
 * One person (lead or student) attached to a calendar event, bucketed into
 * "enrolled" / "trial" / "waitlist" — mirrors the Enrollments / Trials /
 * Waitlist tabs on the event detail panel. Exactly one of `student`/`lead`
 * is set per registration.
 */
const registrationSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: CALENDAR_REGISTRATION_KINDS,
      required: [true, 'Registration kind is required'],
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    attendance: {
      type: String,
      enum: CALENDAR_ATTENDANCE_STATUSES,
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: CALENDAR_REGISTRATION_PAYMENT_STATUSES,
      default: 'No Invoice',
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const calendarEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: CALENDAR_EVENT_TYPES,
      default: 'class',
    },
    eventType: {
      type: String,
      enum: CALENDAR_EVENT_REPEAT_TYPES,
      default: 'one-time',
    },
    subject: {
      type: String,
      trim: true,
      default: '',
    },
    title: {
      type: String,
      trim: true,
      maxlength: 150,
      default: '',
    },
    classDescription: {
      type: String,
      trim: true,
      default: '',
    },
    internalNotes: {
      type: String,
      trim: true,
      default: '',
    },
    date: {
      type: Date,
      required: [true, 'Date is required'],
    },
    startTime: {
      type: String, // "HH:mm", 24-hour
      required: [true, 'Start time is required'],
      trim: true,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'Start time must be in HH:mm format'],
    },
    endTime: {
      type: String, // "HH:mm", 24-hour — optional
      trim: true,
      default: '',
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'End time must be in HH:mm format'],
    },
    lead: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    teachers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isOnline: {
      type: Boolean,
      default: false,
    },
    location: {
      type: String,
      trim: true,
      default: '',
    },
    seatType: {
      type: String,
      enum: CALENDAR_SEAT_TYPES,
      default: 'unlimited',
    },
    capacity: {
      type: Number,
      default: null,
    },
    publishedStatus: {
      type: String,
      enum: CALENDAR_PUBLISHED_STATUSES,
      default: 'published',
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: CALENDAR_EVENT_STATUSES,
      default: 'scheduled',
    },
    registrations: {
      type: [registrationSchema],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

calendarEventSchema.index({ date: 1, startTime: 1 });
calendarEventSchema.index({ teacher: 1, date: 1 });
calendarEventSchema.index({ teachers: 1, date: 1 });
calendarEventSchema.index({ subject: 1 });
calendarEventSchema.index({ location: 1 });

module.exports = mongoose.model('CalendarEvent', calendarEventSchema);
