const express = require('express');
const router = express.Router();
const subjectController = require('../controllers/subjectController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

router.use(protect);

router
  .route('/')
  .get(subjectController.getSubjects)
  .post(
    requirePermission(
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.PORTAL_PROGRAMS_MANAGE,
      PERMISSIONS.CALENDAR_CREATE
    ),
    subjectController.createSubject
  );

router
  .route('/:id')
  .get(subjectController.getSubject)
  .patch(
    requirePermission(
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.PORTAL_PROGRAMS_MANAGE,
      PERMISSIONS.CALENDAR_UPDATE
    ),
    subjectController.updateSubject
  )
  .delete(
    requirePermission(
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.PORTAL_PROGRAMS_MANAGE,
      PERMISSIONS.CALENDAR_DELETE
    ),
    subjectController.deleteSubject
  );

module.exports = router;
