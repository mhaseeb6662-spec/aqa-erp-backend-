const express = require('express');
const operationsController = require('../controllers/operationsController');
const { protect, restrictTo } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

// Protect all operations endpoints
router.use(protect);

// Dashboard
router.get('/dashboard', requirePermission(PERMISSIONS.OPERATIONS_DASHBOARD_VIEW, PERMISSIONS.PORTAL_SCHEDULE_VIEW), operationsController.getOperationsDashboard);

// Fleet
router.route('/vessels')
  .get(requirePermission(PERMISSIONS.OPERATIONS_FLEET_VIEW), operationsController.getAllVessels)
  .post(requirePermission(PERMISSIONS.OPERATIONS_FLEET_MANAGE), operationsController.createVessel);

router.route('/vessels/:id')
  .put(requirePermission(PERMISSIONS.OPERATIONS_FLEET_MANAGE), operationsController.updateVessel)
  .delete(requirePermission(PERMISSIONS.OPERATIONS_FLEET_MANAGE), operationsController.deleteVessel);

// Equipment & Inventory
const categoryController = require('../controllers/inventoryCategoryController');
router.route('/inventory-categories')
  .get(requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_VIEW), categoryController.getCategories)
  .post(requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_MANAGE), categoryController.createCategory);
router.route('/inventory-categories/:id')
  .put(requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_MANAGE), categoryController.updateCategory)
  .delete(requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_MANAGE), categoryController.deleteCategory);
router.patch('/inventory-categories/:id/archive', requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_MANAGE), categoryController.archiveCategory);

router.get('/equipment/metrics', requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_VIEW), operationsController.getInventoryMetrics);
router.post('/equipment/:id/movement', requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_MANAGE), operationsController.adjustEquipmentStock);

router.route('/equipment')
  .get(requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_VIEW), operationsController.getAllEquipment)
  .post(requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_MANAGE), operationsController.createEquipment);

router.route('/equipment/:id')
  .put(requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_MANAGE), operationsController.updateEquipment)
  .delete(requirePermission(PERMISSIONS.OPERATIONS_EQUIPMENT_MANAGE), operationsController.deleteEquipment);

// Incidents
router.route('/incidents')
  .get(requirePermission(PERMISSIONS.OPERATIONS_INCIDENTS_VIEW), operationsController.getAllIncidents)
  .post(requirePermission(PERMISSIONS.OPERATIONS_INCIDENTS_MANAGE), operationsController.createIncident);

router.route('/incidents/:id')
  .put(requirePermission(PERMISSIONS.OPERATIONS_INCIDENTS_MANAGE), operationsController.updateIncident)
  .delete(requirePermission(PERMISSIONS.OPERATIONS_INCIDENTS_MANAGE), operationsController.deleteIncident);

module.exports = router;
