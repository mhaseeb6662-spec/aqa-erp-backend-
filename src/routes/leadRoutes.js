const express = require('express');
const { body } = require('express-validator');
const leadController = require('../controllers/leadController');
const leadImportController = require('../controllers/leadImportController');
const csvUpload = require('../middleware/csvUpload');
const validate = require('../middleware/validate');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

// Static/collection routes must be declared before "/:id" routes.
router.get('/pipeline', requirePermission(PERMISSIONS.PIPELINE_VIEW), leadController.getPipeline);
router.get('/export', requirePermission(PERMISSIONS.LEADS_VIEW), leadController.exportLeads);

// CSV Lead Import Endpoints (Permission-guarded, supports multipart file or JSON)
router.post(
  '/import/upload',
  requirePermission(PERMISSIONS.LEADS_IMPORT, PERMISSIONS.LEADS_CREATE),
  csvUpload.single('file'),
  leadImportController.uploadCsvFile
);

router.post(
  '/import/validate',
  requirePermission(PERMISSIONS.LEADS_IMPORT, PERMISSIONS.LEADS_CREATE),
  csvUpload.single('file'),
  leadImportController.validateCsvData
);

router.post(
  '/import/execute',
  requirePermission(PERMISSIONS.LEADS_IMPORT, PERMISSIONS.LEADS_CREATE),
  csvUpload.single('file'),
  leadImportController.executeCsvImport
);

router.get(
  '/import/batches',
  requirePermission(PERMISSIONS.LEADS_IMPORT, PERMISSIONS.LEADS_VIEW),
  leadImportController.getImportBatches
);

router.get(
  '/import/batches/:id',
  requirePermission(PERMISSIONS.LEADS_IMPORT, PERMISSIONS.LEADS_VIEW),
  leadImportController.getImportBatchDetails
);

router.get(
  '/import/template',
  requirePermission(PERMISSIONS.LEADS_IMPORT, PERMISSIONS.LEADS_VIEW),
  leadImportController.downloadCsvTemplate
);

router.patch(
  '/bulk-assign',
  requirePermission(PERMISSIONS.LEADS_ASSIGN),
  [
    body('leadIds').isArray({ min: 1 }).withMessage('At least one lead must be selected.'),
    body('assignedTo').notEmpty().withMessage('A sales representative must be selected.'),
  ],
  validate,
  leadController.bulkAssign
);

router.get('/', requirePermission(PERMISSIONS.LEADS_VIEW), leadController.getLeads);

router.post(
  '/',
  requirePermission(PERMISSIONS.LEADS_CREATE),
  [
    body('fullName').trim().notEmpty().withMessage('Full name is required.'),
    body('phone').trim().notEmpty().withMessage('Phone number is required.'),
  ],
  validate,
  leadController.createLead
);

router.get('/:id', requirePermission(PERMISSIONS.LEADS_VIEW), leadController.getLead);
router.patch('/:id', requirePermission(PERMISSIONS.LEADS_UPDATE), leadController.updateLead);
router.delete('/:id', requirePermission(PERMISSIONS.LEADS_DELETE), leadController.deleteLead);

router.patch(
  '/:id/assign',
  requirePermission(PERMISSIONS.LEADS_ASSIGN),
  [body('assignedTo').notEmpty().withMessage('A sales representative must be selected.')],
  validate,
  leadController.assignLead
);

router.patch(
  '/:id/stage',
  requirePermission(PERMISSIONS.PIPELINE_UPDATE),
  [body('stage').notEmpty().withMessage('A pipeline stage is required.')],
  validate,
  leadController.updateStage
);

router.post('/:id/convert', requirePermission(PERMISSIONS.LEADS_CONVERT), leadController.convertLead);

module.exports = router;
