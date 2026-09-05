/**
 * Shared enums/constants for the Sales CRM & Lead Management module (Phase 2).
 * Kept in lockstep with the frontend's src/constants/crm.js so validation on
 * both sides always agrees.
 */

const LEAD_SOURCES = [
  'Website',
  'Referral',
  'Social Media',
  'Facebook Ads',
  'Google Ads',
  'WhatsApp',
  'Walk-in',
  'Phone Inquiry',
  'Email Campaign',
  'Event',
  'Advertisement',
  'Other',
];

// Sources that are populated automatically by the inbound lead webhooks
// (Meta/Facebook Lead Ads, Google Ads Lead Form, WhatsApp) rather than
// manually by a sales rep. Used to auto-assign & label these leads distinctly.
const AUTOMATED_LEAD_SOURCES = ['Facebook Ads', 'Google Ads', 'WhatsApp'];

// Ordered sales pipeline stages — order drives the Kanban board columns.
const PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

const PIPELINE_STAGE_CONFIG = [
  { key: 'new', label: 'New Lead', order: 1, active: true },
  { key: 'contacted', label: 'Contacted', order: 2, active: true },
  { key: 'qualified', label: 'Qualified', order: 3, active: true },
  { key: 'proposal', label: 'Proposal Sent', order: 4, active: true },
  { key: 'negotiation', label: 'Negotiation', order: 5, active: true },
  { key: 'won', label: 'Won', order: 6, active: true },
  { key: 'lost', label: 'Lost', order: 7, active: true },
];

const OPEN_STAGES = PIPELINE_STAGES.filter((s) => !['won', 'lost'].includes(s));

const FOLLOW_UP_TYPES = ['Call', 'Email', 'Meeting', 'WhatsApp', 'Site Visit'];

const FOLLOW_UP_STATUSES = ['pending', 'completed', 'overdue', 'cancelled'];

// Activity timeline entry types — system-generated events + manually logged interactions.
const ACTIVITY_TYPES = [
  'note',
  'call',
  'email',
  'meeting',
  'whatsapp',
  'stage_change',
  'assignment',
  'conversion',
  'payment_link',
];

// Manually-loggable interaction types (subset of ACTIVITY_TYPES exposed on the "Log interaction" modal).
const LOGGABLE_ACTIVITY_TYPES = ['note', 'call', 'email', 'meeting', 'whatsapp'];

const PAYMENT_STATUSES = ['pending', 'paid', 'expired', 'cancelled'];

const ENTITY_TYPES = ['lead', 'customer'];

// ---- Phase 2.2 — Calendar & Class Scheduling ----
// A calendar entry is either:
//  - "demo"  : a lead manually placed on the calendar (trial/demo class,
//              consultation, walk-in visit — booked before conversion)
//  - "class" : a real class session for an already-enrolled student
const CALENDAR_EVENT_TYPES = ['demo', 'class', 'camp', 'trip', 'workshop'];

const CALENDAR_EVENT_REPEAT_TYPES = ['one-time', 'repeating'];

const CALENDAR_SUBJECT_OPTIONS = [
  'Chemistry',
  'Mathematics',
  'English',
  'Physics',
  'Biology',
  'Computer Science',
  'General Science',
  'History',
  'Art & Craft',
  'Physical Training',
];

const CALENDAR_SEAT_TYPES = ['unlimited', 'limited'];

const CALENDAR_PUBLISHED_STATUSES = ['published', 'draft'];

const CALENDAR_EVENT_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];

// A single calendar event (a class/session/slot) can carry a roster of
// people attached to it, each in one of three buckets — mirrors the
// Enrollments / Trials / Waitlist tabs on the event detail panel.
const CALENDAR_REGISTRATION_KINDS = ['enrolled', 'trial', 'waitlist'];

// Per-registrant attendance for the session.
const CALENDAR_ATTENDANCE_STATUSES = ['pending', 'present', 'absent'];

const CALENDAR_REGISTRATION_PAYMENT_STATUSES = ['Paid', 'Invoice Generated', 'No Invoice'];

module.exports = {
  LEAD_SOURCES,
  AUTOMATED_LEAD_SOURCES,
  PIPELINE_STAGES,
  PIPELINE_STAGE_CONFIG,
  OPEN_STAGES,
  FOLLOW_UP_TYPES,
  FOLLOW_UP_STATUSES,
  ACTIVITY_TYPES,
  LOGGABLE_ACTIVITY_TYPES,
  PAYMENT_STATUSES,
  ENTITY_TYPES,
  CALENDAR_EVENT_TYPES,
  CALENDAR_EVENT_REPEAT_TYPES,
  CALENDAR_SUBJECT_OPTIONS,
  CALENDAR_SEAT_TYPES,
  CALENDAR_PUBLISHED_STATUSES,
  CALENDAR_EVENT_STATUSES,
  CALENDAR_REGISTRATION_KINDS,
  CALENDAR_ATTENDANCE_STATUSES,
  CALENDAR_REGISTRATION_PAYMENT_STATUSES,
};
