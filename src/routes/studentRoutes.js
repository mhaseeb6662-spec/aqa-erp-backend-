const express = require('express');
const studentProfileController = require('../controllers/studentProfileController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/profile', studentProfileController.getStudentProfile);
router.put('/profile', studentProfileController.updateStudentProfile);

router.get('/all', restrictTo('super-admin', 'admin', 'management', 'operations-manager', 'coach', 'instructor', 'head-coach'), studentProfileController.getAllStudents);
router.post('/migrate', restrictTo('super-admin', 'admin'), studentProfileController.migrateStudents);
router.get('/profile/:userId', studentProfileController.getStudentProfile);
router.put('/profile/:userId', studentProfileController.updateStudentProfile);

module.exports = router;
