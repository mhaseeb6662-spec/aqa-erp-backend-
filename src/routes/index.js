const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const roleRoutes = require('./roleRoutes');
const branchRoutes = require('./branchRoutes');
const programRoutes = require('./programRoutes');

// CRM
const leadRoutes = require('./leadRoutes');
const customerRoutes = require('./customerRoutes');
const followUpRoutes = require('./followUpRoutes');
const activityRoutes = require('./activityRoutes');
const paymentLinkRoutes = require('./paymentLinkRoutes');
const salesTeamRoutes = require('./salesTeamRoutes');
const salesPerformanceRoutes = require('./salesPerformanceRoutes');
const leadWebhookRoutes = require('./leadWebhookRoutes');

// Operations
const calendarRoutes = require('./calendarRoutes');
const scheduleRoutes = require('./scheduleRoutes');
const bookingRoutes = require('./bookingRoutes');
const coachRoutes = require('./coachRoutes');
const studentRoutes = require('./studentRoutes');
const parentRoutes = require('./parentRoutes');
const documentRoutes = require('./documentRoutes');
const financeRoutes = require('./financeRoutes');
const notificationRoutes = require('./notificationRoutes');

router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Aqua Fishing Academy ERP API is running.',
    timestamp: new Date().toISOString(),
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/roles', roleRoutes);
router.use('/branches', branchRoutes);
router.use('/programs', programRoutes);

router.use('/leads', leadRoutes);
router.use('/customers', customerRoutes);
router.use('/follow-ups', followUpRoutes);
router.use('/activities', activityRoutes);
router.use('/payment-links', paymentLinkRoutes);
router.use('/sales-team', salesTeamRoutes);
router.use('/sales-performance', salesPerformanceRoutes);
router.use('/webhooks/leads', leadWebhookRoutes);

router.use('/calendar', calendarRoutes);
router.use('/schedule', scheduleRoutes);
router.use('/schedules', scheduleRoutes);

router.use('/bookings', bookingRoutes);
router.use('/booking', bookingRoutes);

router.use('/coach', coachRoutes);
router.use('/coaches', coachRoutes);

router.use('/students', studentRoutes);
router.use('/student', studentRoutes);

router.use('/parents', parentRoutes);
router.use('/parent', parentRoutes);

router.use('/documents', documentRoutes);
router.use('/document', documentRoutes);

router.use('/finance', financeRoutes);
router.use('/notifications', notificationRoutes);

// Phase 5 - Operations & Fleet
const operationsRoutes = require('./operationsRoutes');
router.use('/operations', operationsRoutes);
router.use('/operation', operationsRoutes);

// Phase 7 - Management Dashboard & Command Center
const managementRoutes = require('./managementRoutes');
router.use('/management', managementRoutes);

// Phase 8 - Third-Party Integrations
const integrationRoutes = require('./integrationRoutes');
router.use('/integrations', integrationRoutes);

// Phase 9 - Reports & Analytics
const reportRoutes = require('./reportRoutes');
router.use('/reports', reportRoutes);

module.exports = router;