const express = require('express');
const programCategoryController = require('../controllers/programCategoryController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(programCategoryController.getCategories)
  .post(requirePermission(PERMISSIONS.PORTAL_PROGRAMS_MANAGE), programCategoryController.createCategory);

router
  .route('/:id/dependencies')
  .get(requirePermission(PERMISSIONS.PORTAL_PROGRAMS_MANAGE), programCategoryController.checkCategoryDependencies);

router
  .route('/:id/archive')
  .patch(requirePermission(PERMISSIONS.PORTAL_PROGRAMS_MANAGE), programCategoryController.archiveCategory);

router
  .route('/:id')
  .put(requirePermission(PERMISSIONS.PORTAL_PROGRAMS_MANAGE), programCategoryController.updateCategory)
  .delete(requirePermission(PERMISSIONS.PORTAL_PROGRAMS_MANAGE), programCategoryController.deleteCategory);

module.exports = router;
