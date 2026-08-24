const express = require('express');
const scheduleController = require('../controllers/scheduleController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router.get('/', scheduleController.getSchedules);
router.put('/:id/status', scheduleController.updateScheduleStatus);
router.put('/:id', scheduleController.updateSchedule);

module.exports = router;
