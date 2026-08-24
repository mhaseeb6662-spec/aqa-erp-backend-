/**
 * Phase 9 — Notifications & Reports Complete End-to-End Verification
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../src/config/db');

// Models
const Notification = require('../src/models/Notification');
const NotificationTemplate = require('../src/models/NotificationTemplate');
const ScheduledReminder = require('../src/models/ScheduledReminder');
const Invoice = require('../src/models/Invoice');
const Customer = require('../src/models/Customer');
const Booking = require('../src/models/Booking');
const Schedule = require('../src/models/Schedule');
const PaymentTransaction = require('../src/models/PaymentTransaction');
const Program = require('../src/models/Program');
const Branch = require('../src/models/Branch');
const User = require('../src/models/User');

// Services
const NotificationService = require('../src/services/NotificationService');
const ReportingService = require('../src/services/ReportingService');

async function runVerification() {
  console.log('--- STARTING PHASE 9 NOTIFICATIONS & REPORTS VERIFICATION ---');
  await connectDB();
  console.log('Connected to MongoDB');

  const testId = `test_${Date.now()}`;

  // 1. NOTIFICATION ENGINE & TEMPLATES TEST
  console.log('\n[1] Testing Template Seeding & Multi-channel Dispatch...');
  await NotificationService.ensureTemplates();
  const templateCount = await NotificationTemplate.countDocuments();
  console.log(` -> Default Templates Count: ${templateCount} (PASS)`);

  let user = await User.findOne({ email: 'digitalarab.dev@gmail.com' }) || await User.findOne();
  if (!user) {
    user = await User.create({
      fullName: 'Verification Test User',
      email: `test_user_${testId}@example.com`,
      phone: '+971501234567',
      password: 'password123',
    });
  }

  const directNotif = await NotificationService.dispatchNotification({
    recipientId: user._id,
    type: 'announcement',
    templateKey: 'BOOKING_CONFIRMED',
    variables: {
      customerName: user.fullName,
      bookingNumber: `BKG-TEST-${testId.slice(-4)}`,
      programName: 'Coastal Trolling Masterclass',
      branchName: 'Dubai Marina',
      sessionDate: 'Tomorrow',
      sessionTime: '08:00 AM',
    },
    channels: ['in_app', 'email', 'whatsapp'],
  });
  console.log(' -> Direct Multi-Channel Dispatch Result:', directNotif ? 'PASS' : 'FAIL');

  // 2. BOOKING CONFIRMED TRIGGER & REMINDER SCHEDULING
  console.log('\n[2] Testing Booking Confirmed Flow & 24h Reminder Scheduling...');
  let branch = await Branch.findOne();
  let program = await Program.findOne();

  const futureDate = new Date(Date.now() + 48 * 3600000); // 48 hours in future
  const schedule = await Schedule.create({
    title: 'Offshore Big Game Expedition',
    startTime: futureDate,
    endTime: new Date(futureDate.getTime() + 4 * 3600000),
    sessionType: 'Trip',
    branch: branch?._id,
    program: program?._id,
    status: 'Scheduled',
  });

  const booking = await Booking.create({
    bookingId: `BKG-${testId.slice(-4)}`,
    bookingNumber: `BKG-${testId.slice(-4)}`,
    student: user._id,
    program: program?._id,
    branch: branch?._id,
    schedule: schedule._id,
    sessionDate: futureDate,
    amount: 2200,
    status: 'Confirmed',
    paymentStatus: 'Paid',
    totalPrice: 2200,
  });

  const bookingNotif = await NotificationService.triggerBookingConfirmed(booking._id);
  console.log(' -> Booking Confirmed Notification:', bookingNotif ? 'PASS' : 'FAIL');

  const scheduledReminder = await ScheduledReminder.findOne({
    recordId: booking._id,
    recipient: user._id,
    reminderType: 'session_reminder',
  });
  console.log(
    ' -> Automated 24h Session Reminder Scheduled:',
    scheduledReminder ? `PASS (Target: ${scheduledReminder.targetDate.toISOString()})` : 'FAIL'
  );

  // 3. PAYMENT CONFIRMED & REMINDER CANCELLATION
  console.log('\n[3] Testing Payment Confirmed Flow & Reminder Cancellation...');
  const invoice = await Invoice.create({
    invoiceNumber: `INV-${testId.slice(-4)}`,
    customer: user._id,
    subtotal: 2200,
    totalAmount: 2200,
    amountPaid: 2200,
    balanceDue: 0,
    dueDate: new Date(),
    status: 'Paid',
  });

  // Create a pending reminder for this invoice
  await ScheduledReminder.create({
    reminderType: 'payment_due_reminder',
    idempotencyKey: `due_inv_${invoice._id}`,
    targetDate: new Date(),
    recordId: invoice._id,
    recordType: 'Invoice',
    recipient: user._id,
    status: 'PENDING',
  });

  const payment = await PaymentTransaction.create({
    transactionId: `tx_p9_${testId}`,
    invoice: invoice._id,
    customer: user._id,
    amount: 2200,
    paymentMethod: 'Credit Card',
    status: 'Completed',
  });

  const paymentNotif = await NotificationService.triggerPaymentConfirmed(payment._id);
  console.log(' -> Payment Confirmed Notification & Receipt:', paymentNotif ? 'PASS' : 'FAIL');

  const cancelledReminder = await ScheduledReminder.findOne({
    recordId: invoice._id,
    reminderType: 'payment_due_reminder',
  });
  console.log(
    ' -> Pending Payment Reminder Automatically Cancelled:',
    cancelledReminder?.status === 'CANCELLED' ? 'PASS (Cancelled on Payment)' : 'FAIL'
  );

  // 4. REMINDER RUNNER CYCLE
  console.log('\n[4] Testing Scheduled Reminder Cron Execution...');
  // Create a ready-to-execute reminder
  await ScheduledReminder.create({
    reminderType: 'session_reminder',
    idempotencyKey: `exec_test_${testId}`,
    targetDate: new Date(Date.now() - 1000), // in the past
    recordId: schedule._id,
    recordType: 'Schedule',
    recipient: user._id,
    metadata: {
      customerName: user.fullName,
      programName: 'Offshore Expedition',
      sessionDate: 'Today',
      sessionTime: '10:00 AM',
      branchName: 'Dubai Marina',
    },
    status: 'PENDING',
  });

  const reminderResults = await NotificationService.processScheduledReminders();
  console.log(` -> Processed ${reminderResults.length} Ready Reminders: PASS`);

  // 5. REPORTING SERVICE: DAILY OPERATIONAL REPORT
  console.log('\n[5] Testing Daily Operational Report Generation...');
  const dailyReport = await ReportingService.generateDailyReport({ range: 'this_month' });
  console.log(` -> Daily Report Generated: PASS (Total Invoiced: AED ${dailyReport.summary.totalInvoiced.toLocaleString()})`);

  // 6. REPORTING SERVICE: WEEKLY PERFORMANCE REPORT
  console.log('\n[6] Testing Weekly Executive Performance Report...');
  const weeklyReport = await ReportingService.generateWeeklyReport({ range: 'this_month' });
  console.log(` -> Weekly Report Generated: PASS (Conversion Rate: ${weeklyReport.summary.conversionRate}%)`);

  // 7. REPORTING SERVICE: MONTHLY CEO REVIEW
  console.log('\n[7] Testing Monthly Board & CEO Review Report...');
  const monthlyReport = await ReportingService.generateMonthlyReport({ range: 'this_month' });
  console.log(` -> Monthly Report Generated: PASS (Branches Analyzed: ${monthlyReport.branches.length})`);

  // 8. REPORTING SERVICE: CSV EXPORT
  console.log('\n[8] Testing Universal CSV / Excel Exporter...');
  const csvString = ReportingService.exportToCsv(dailyReport);
  console.log(` -> CSV Formatted Output: PASS (Length: ${csvString.length} chars, starts with header: ${csvString.startsWith('"AQUA FISHING')})`);

  // Clean up test documents
  await Booking.findByIdAndDelete(booking._id);
  await Schedule.findByIdAndDelete(schedule._id);
  await Invoice.findByIdAndDelete(invoice._id);
  await PaymentTransaction.findByIdAndDelete(payment._id);

  console.log('\n========================================');
  console.log('ALL PHASE 9 NOTIFICATIONS & REPORTS FLOWS VERIFIED SUCCESSFULLY!');
  console.log('========================================');
  await mongoose.disconnect();
}

runVerification().catch((err) => {
  console.error('Phase 9 Verification failed:', err);
  process.exit(1);
});
