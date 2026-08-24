const Notification = require('../models/Notification');
const NotificationTemplate = require('../models/NotificationTemplate');
const ScheduledReminder = require('../models/ScheduledReminder');
const NotificationService = require('../services/NotificationService');
const AppError = require('../utils/appError');

// 1. Get user notifications inbox
exports.getUserNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 30, type } = req.query;
    const filter = { recipient: req.user.id };
    if (type && type !== 'all') filter.type = type;

    const total = await Notification.countDocuments(filter);
    const notifications = await Notification.find(filter)
      .populate('sender', 'fullName avatarUrl')
      .populate('student', 'fullName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const unreadCount = await Notification.countDocuments({ recipient: req.user.id, isRead: false });

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      unreadCount,
      data: notifications,
    });
  } catch (err) {
    next(err);
  }
};

// 2. Mark notification as read
exports.markAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    if (!notification) return next(new AppError('Notification not found', 404));
    res.status(200).json({ success: true, data: notification });
  } catch (err) {
    next(err);
  }
};

// 3. Mark all as read
exports.markAllAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany({ recipient: req.user.id, isRead: false }, { isRead: true, readAt: new Date() });
    res.status(200).json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    next(err);
  }
};

// 4. Admin delivery activity & telemetry logs
exports.getDeliveryLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 25, type, status, channel } = req.query;
    const filter = {};

    if (type) filter.type = type;
    if (status) filter.status = status;
    if (channel) filter.channels = channel;

    const total = await Notification.countDocuments(filter);
    const logs = await Notification.find(filter)
      .populate('recipient', 'fullName email phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
      data: logs,
    });
  } catch (err) {
    next(err);
  }
};

// 5. Template Management (CRUD)
exports.getTemplates = async (req, res, next) => {
  try {
    await NotificationService.ensureTemplates();
    const templates = await NotificationTemplate.find().sort({ category: 1 });
    res.status(200).json({ success: true, count: templates.length, data: templates });
  } catch (err) {
    next(err);
  }
};

exports.updateTemplate = async (req, res, next) => {
  try {
    const { subject, inAppBody, emailHtml, whatsAppBody, isActive } = req.body;
    const template = await NotificationTemplate.findByIdAndUpdate(
      req.params.id,
      {
        ...(subject && { subject }),
        ...(inAppBody && { inAppBody }),
        ...(emailHtml && { emailHtml }),
        ...(whatsAppBody && { whatsAppBody }),
        ...(isActive !== undefined && { isActive }),
      },
      { new: true }
    );
    if (!template) return next(new AppError('Template not found', 404));
    res.status(200).json({ success: true, data: template });
  } catch (err) {
    next(err);
  }
};

// 6. Manual Retry Dispatch
exports.retryNotification = async (req, res, next) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return next(new AppError('Notification record not found', 404));

    notif.retryCount += 1;
    notif.status = 'SENT';
    notif.sentAt = new Date();
    await notif.save();

    res.status(200).json({ success: true, message: 'Notification redelivery queued.', data: notif });
  } catch (err) {
    next(err);
  }
};

// 7. Manual Trigger Reminder Cycle
exports.runReminderCycle = async (req, res, next) => {
  try {
    const results = await NotificationService.processScheduledReminders();
    res.status(200).json({
      success: true,
      message: `Processed ${results.length} pending reminders.`,
      data: results,
    });
  } catch (err) {
    next(err);
  }
};

// 8. Broadcast announcement (Admin)
exports.broadcastAnnouncement = async (req, res, next) => {
  try {
    const { title, message, link } = req.body;
    if (!title || !message) {
      return next(new AppError('Title and message are required for announcement', 400));
    }

    const User = require('../models/User');
    const users = await User.find({ status: 'active' }).select('_id');

    const notificationDocs = users.map((u) => ({
      recipient: u._id,
      sender: req.user.id,
      title,
      message,
      type: 'announcement',
      channels: ['in_app'],
      link: link || '/notifications',
      status: 'SENT',
      sentAt: new Date(),
    }));

    await Notification.insertMany(notificationDocs);

    res.status(201).json({
      success: true,
      message: `Announcement broadcast to ${users.length} active users.`,
    });
  } catch (err) {
    next(err);
  }
};
