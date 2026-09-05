const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/inventoryCategoryController');
const { protect, authorize } = require('../middlewares/authMiddleware');

router.use(protect);

router.get('/', categoryController.getCategories);

// Ensure only authorized people can create/edit categories
router.use(authorize('admin', 'superadmin', 'manager'));
router.post('/', categoryController.createCategory);
router.put('/:id', categoryController.updateCategory);
router.patch('/:id/archive', categoryController.archiveCategory);

module.exports = router;
