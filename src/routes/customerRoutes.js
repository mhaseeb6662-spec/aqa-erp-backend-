const express = require('express');
const customerController = require('../controllers/customerController');
const { protect } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

router.get('/', requirePermission(PERMISSIONS.CUSTOMERS_VIEW), customerController.getCustomers);
router.post('/', requirePermission(PERMISSIONS.CUSTOMERS_CREATE), customerController.createCustomer);
router.get('/:id', requirePermission(PERMISSIONS.CUSTOMERS_VIEW), customerController.getCustomer);
router.patch('/:id', requirePermission(PERMISSIONS.CUSTOMERS_UPDATE), customerController.updateCustomer);
router.delete('/:id', requirePermission(PERMISSIONS.CUSTOMERS_DELETE), customerController.deleteCustomer);

module.exports = router;
