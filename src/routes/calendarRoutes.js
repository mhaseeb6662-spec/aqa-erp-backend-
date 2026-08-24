const express = require('express');
const { body } = require('express-validator');
const calendarController = require('../controllers/calendarController');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

// Static sub-routes before the generic "/:id" so they never get swallowed by it.
router.get('/teachers', requirePermission(PERMISSIONS.CALENDAR_VIEW), calendarController.getTeacherOptions);
router.get('/locations', requirePermission(PERMISSIONS.CALENDAR_VIEW), calendarController.getLocationOptions);
router.get('/subjects', requirePermission(PERMISSIONS.CALENDAR_VIEW), calendarController.getSubjectOptions);
router.post('/quick-student', requirePermission(PERMISSIONS.CALENDAR_CREATE), calendarController.quickCreateStudent);

router.get('/', requirePermission(PERMISSIONS.CALENDAR_VIEW), calendarController.getCalendarEvents);

router.post(
  '/',
  requirePermission(PERMISSIONS.CALENDAR_CREATE),
  [
    body('date').notEmpty().withMessage('Date is required.'),
    body('startTime')
      .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
      .withMessage('Start time must be in HH:mm format.'),
    body('endTime')
      .optional({ checkFalsy: true })
      .matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
      .withMessage('End time must be in HH:mm format.'),
  ],
  validate,
  calendarController.createCalendarEvent
);

router.get('/:id', requirePermission(PERMISSIONS.CALENDAR_VIEW), calendarController.getCalendarEvent);
router.patch('/:id', requirePermission(PERMISSIONS.CALENDAR_UPDATE), calendarController.updateCalendarEvent);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.CALENDAR_UPDATE),
  calendarController.updateCalendarEventStatus
);
router.delete('/:id', requirePermission(PERMISSIONS.CALENDAR_DELETE), calendarController.deleteCalendarEvent);

// ---- Event roster: Enrollments / Trials / Waitlist ----
router.post(
  '/:id/registrations',
  requirePermission(PERMISSIONS.CALENDAR_UPDATE),
  [
    body('kind').isIn(['enrolled', 'trial', 'waitlist']).withMessage('kind must be "enrolled", "trial" or "waitlist".'),
  ],
  validate,
  calendarController.addRegistration
);
router.delete(
  '/:id/registrations/:regId',
  requirePermission(PERMISSIONS.CALENDAR_UPDATE),
  calendarController.removeRegistration
);
router.patch(
  '/:id/registrations/:regId/attendance',
  requirePermission(PERMISSIONS.CALENDAR_UPDATE),
  calendarController.updateRegistrationAttendance
);
router.patch(
  '/:id/registrations/:regId/payment-status',
  requirePermission(PERMISSIONS.CALENDAR_UPDATE),
  calendarController.updateRegistrationPaymentStatus
);

module.exports = router;
