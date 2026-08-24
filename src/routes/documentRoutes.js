const express = require('express');
const documentController = require('../controllers/documentController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(documentController.getDocuments)
  .post(documentController.uploadDocument);

router.put('/:id/review', requirePermission(PERMISSIONS.PORTAL_DOCUMENTS_MANAGE), documentController.reviewDocument);

module.exports = router;
