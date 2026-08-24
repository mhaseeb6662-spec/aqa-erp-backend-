const Booking = require('../models/Booking');
const Program = require('../models/Program');
const Branch = require('../models/Branch');
const Schedule = require('../models/Schedule');
const Notification = require('../models/Notification');
const AppError = require('../utils/appError');

const ParentProfile = require('../models/ParentProfile');
const StudentProfile = require('../models/StudentProfile');

// Create new booking (Trial or Standard Class)
exports.createBooking = async (req, res, next) => {
  try {
    const { programId, branchId, sessionDate, slotTime, bookingType, notes, studentId } = req.body;

    const program = await Program.findById(programId);
    if (!program) return next(new AppError('Program not found', 404));

    const branch = await Branch.findById(branchId);
    if (!branch) return next(new AppError('Branch not found', 404));

    let targetStudentId = req.user.id;

    if (req.user.role?.slug === 'student') {
      targetStudentId = req.user.id;
    } else if (req.user.role?.slug === 'parent') {
      const parentProf = await ParentProfile.findOne({ user: req.user.id });
      const linkedChildren = (parentProf?.children || []).map((c) => c.toString());

      if (studentId) {
        if (!linkedChildren.includes(studentId.toString())) {
          const isParentOfStudent = await StudentProfile.exists({ user: studentId, parentUser: req.user.id });
          if (!isParentOfStudent) {
            return next(new AppError('Unauthorized: You can only book sessions for your linked children.', 403));
          }
        }
        targetStudentId = studentId;
      } else if (linkedChildren.length > 0) {
        targetStudentId = linkedChildren[0];
      } else {
        return next(new AppError('Please register or link a student account before making a booking.', 400));
      }
    } else if (studentId) {
      targetStudentId = studentId;
    }

    const bookingId = 'BK-' + Math.floor(100000 + Math.random() * 900000);

    const booking = await Booking.create({
      bookingId,
      student: targetStudentId,
      parent: req.user.role?.slug === 'parent' ? req.user.id : null,
      program: program._id,
      branch: branch._id,
      sessionDate: new Date(sessionDate),
      slotTime: slotTime || '09:00 AM - 11:00 AM',
      bookingType: bookingType || 'Standard Class',
      amount: bookingType === 'Trial Session' ? 0 : program.price,
      paymentStatus: bookingType === 'Trial Session' ? 'Paid' : 'Pending',
      status: bookingType === 'Trial Session' ? 'Confirmed' : 'Pending',
      notes: notes || '',
    });

    // Capacity Management: Prevent booking if program/slot is full
    const existingBookings = await Booking.countDocuments({
      program: program._id,
      sessionDate: new Date(sessionDate),
      slotTime: slotTime || '09:00 AM - 11:00 AM',
      status: { $in: ['Confirmed', 'Pending'] }
    });
    
    const maxCapacity = program.capacity || 10;
    if (existingBookings > maxCapacity) {
      return next(new AppError('Booking failed: Capacity exceeded for this session.', 400));
    }

    // Create schedule item automatically for the student
    const startTime = new Date(sessionDate);
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000); // 2 hours duration

    await Schedule.create({
      student: targetStudentId,
      booking: booking._id,
      program: program._id,
      branch: branch._id,
      title: `${program.title} (${bookingType || 'Class'})`,
      startTime,
      endTime,
      location: `${branch.name} - ${branch.address}`,
      status: 'Scheduled',
    });

    // Send notification to student & parent
    await Notification.create({
      recipient: targetStudentId,
      title: 'Booking Confirmed!',
      message: `Your booking for ${program.title} at ${branch.name} on ${new Date(sessionDate).toDateString()} is confirmed!`,
      type: 'booking_alert',
      link: '/bookings',
    });

    if (req.user.role?.slug === 'parent' && targetStudentId !== req.user.id) {
      await Notification.create({
        recipient: req.user.id,
        title: 'Child Booking Confirmed!',
        message: `Booking for your child for ${program.title} at ${branch.name} is confirmed!`,
        type: 'booking_alert',
        link: '/parent/bookings',
      });
    }

    // Auto-generate invoice in Finance module (Step 5 of blueprint booking journey)
    const Invoice = require('../models/Invoice');
    const invoiceNumber = 'INV-' + Math.floor(100000 + Math.random() * 900000);
    const itemAmount = bookingType === 'Trial Session' ? 0 : program.price;
    const taxAmount = (itemAmount * 5) / 100;
    const totalAmount = itemAmount + taxAmount;

    const invoice = await Invoice.create({
      invoiceNumber,
      customer: req.user.id,
      student: targetStudentId,
      booking: booking._id,
      program: program._id,
      branch: branch._id,
      lineItems: [
        {
          description: `${program.title} (${bookingType || 'Standard Class'})`,
          quantity: 1,
          unitPrice: itemAmount,
          amount: itemAmount,
        },
      ],
      subtotal: itemAmount,
      taxRate: 5,
      taxAmount,
      discount: 0,
      totalAmount,
      amountPaid: bookingType === 'Trial Session' ? totalAmount : 0,
      balanceDue: bookingType === 'Trial Session' ? 0 : totalAmount,
      status: bookingType === 'Trial Session' ? 'Paid' : 'Sent',
      dueDate: new Date(Date.now() + 15 * 86400000),
      notes: `Invoice generated for ${program.title} booking ${bookingId}`,
    });

    const populated = await Booking.findById(booking._id)
      .populate('student', 'fullName email phone')
      .populate('program', 'title category price level')
      .populate('branch', 'name city address');

    res.status(201).json({
      success: true,
      message: 'Booking created and invoice generated successfully',
      data: {
        booking: populated,
        invoice,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Get user bookings (Student/Parent or Admin)
exports.getBookings = async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role?.slug === 'student') {
      filter.student = req.user.id;
    } else if (req.user.role?.slug === 'parent') {
      const parentProf = await ParentProfile.findOne({ user: req.user.id });
      const childrenIds = (parentProf?.children || []).map((c) => (c._id ? c._id : c));

      if (req.query.studentId) {
        if (!childrenIds.map((id) => id.toString()).includes(req.query.studentId.toString())) {
          return next(new AppError('Unauthorized: You can only view bookings for your linked children.', 403));
        }
        filter.student = req.query.studentId;
      } else {
        filter.$or = [{ parent: req.user.id }, { student: { $in: childrenIds } }];
      }
    } else if (req.query.studentId) {
      filter.student = req.query.studentId;
    }

    const bookings = await Booking.find(filter)
      .populate('student', 'fullName email phone')
      .populate('program', 'title category price level code')
      .populate('branch', 'name code city address')
      .sort({ sessionDate: -1 });

    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings,
    });
  } catch (err) {
    next(err);
  }
};

// Cancel booking
exports.cancelBooking = async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return next(new AppError('Booking not found', 404));

    booking.status = 'Cancelled';
    await booking.save();

    await Schedule.updateMany({ booking: booking._id }, { status: 'Cancelled' });

    await Notification.create({
      recipient: booking.student,
      title: 'Booking Cancelled',
      message: `Your booking (${booking.bookingId}) has been cancelled.`,
      type: 'booking_alert',
      link: '/bookings',
    });

    res.status(200).json({ success: true, message: 'Booking cancelled successfully', data: booking });
  } catch (err) {
    next(err);
  }
};
