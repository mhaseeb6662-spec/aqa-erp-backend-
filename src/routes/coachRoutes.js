const express = require('express');
const coachController = require('../controllers/coachController');
const { protect, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Protect all coach endpoints
router.use(protect);

// Coach Dashboard
router.get('/dashboard', coachController.getCoachDashboard);

// Sessions
router.get('/sessions', coachController.getAssignedSessions);
router.get('/sessions/:id', coachController.getAssignedSessionById);
router.put('/sessions/:id/attendance', coachController.updateAttendance);

// Progress Notes & Students
router.get('/students', coachController.getAssignedStudents);
router.post('/progress', coachController.createProgressNote);

// Session Reports
router.post('/reports', coachController.submitSessionReport);

// Media & Achievements
router.post('/media', coachController.uploadSessionMedia);
router.post('/achievements', coachController.issueAchievement);

// Coach Certifications
router.get('/my-certifications', coachController.getCoachCertifications);

// Super Admin Management View
router.get('/admin/all-coaches', coachController.getAllCoaches);

module.exports = router;
