const express = require('express');
const parentProfileController = require('../controllers/parentProfileController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/profile', parentProfileController.getParentProfile);
router.get('/all', restrictTo('super-admin', 'admin', 'management'), parentProfileController.getAllParents);
router.put('/profile', parentProfileController.updateParentProfile);
router.post('/link-child', parentProfileController.linkChild);
router.post('/create-child', parentProfileController.createChild);

module.exports = router;
