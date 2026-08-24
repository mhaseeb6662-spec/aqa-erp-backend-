const express = require('express');
const notificationController = require('../controllers/notificationController');
const { protect, restrictTo } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../config/rbac.constants');

const router = express.Router();

router.use(protect);

// 1. User In-App Inbox Endpoints
router.get('/', notificationController.getUserNotifications);
router.put('/read-all', notificationController.markAllAsRead);
router.put('/:id/read', notificationController.markAsRead);

// 2. Admin Notification Delivery Logs & Monitoring
router.get('/logs', restrictTo('super-admin', 'admin'), notificationController.getDeliveryLogs);

// 3. Admin Template Management
router.get('/templates', restrictTo('super-admin', 'admin'), notificationController.getTemplates);
router.put('/templates/:id', restrictTo('super-admin', 'admin'), notificationController.updateTemplate);

// 4. Retry Redelivery & Reminder Cron Trigger
router.post('/:id/retry', restrictTo('super-admin', 'admin'), notificationController.retryNotification);
router.post('/reminders/run', restrictTo('super-admin', 'admin'), notificationController.runReminderCycle);

// 5. Broadcast Announcement
router.post('/broadcast', requirePermission(PERMISSIONS.PORTAL_NOTIFICATIONS_MANAGE), notificationController.broadcastAnnouncement);

module.exports = router;
