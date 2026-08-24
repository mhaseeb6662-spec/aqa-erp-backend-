const express = require('express');
const branchController = require('../controllers/branchController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(branchController.getAllBranches)
  .post(requirePermission(PERMISSIONS.PORTAL_BRANCHES_MANAGE), branchController.createBranch);

router
  .route('/:id')
  .get(branchController.getBranch)
  .put(requirePermission(PERMISSIONS.PORTAL_BRANCHES_MANAGE), branchController.updateBranch)
  .delete(requirePermission(PERMISSIONS.PORTAL_BRANCHES_MANAGE), branchController.deleteBranch);

module.exports = router;
