const express = require('express');
const programController = require('../controllers/programController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(programController.getPrograms)
  .post(requirePermission(PERMISSIONS.PORTAL_PROGRAMS_MANAGE), programController.createProgram);

router
  .route('/:id')
  .get(programController.getProgram)
  .put(requirePermission(PERMISSIONS.PORTAL_PROGRAMS_MANAGE), programController.updateProgram)
  .delete(requirePermission(PERMISSIONS.PORTAL_PROGRAMS_MANAGE), programController.deleteProgram);

module.exports = router;
