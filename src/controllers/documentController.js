const Document = require('../models/Document');
const Notification = require('../models/Notification');
const AppError = require('../utils/appError');

const ParentProfile = require('../models/ParentProfile');
const StudentProfile = require('../models/StudentProfile');

// Upload document (Student or Parent)
exports.uploadDocument = async (req, res, next) => {
  try {
    const { title, documentType, fileUrl, fileSize, mimeType, studentId } = req.body;
    if (!title || !documentType || !fileUrl) {
      return next(new AppError('Please provide title, document type, and file content/URL', 400));
    }

    let targetStudentId = req.user.id;

    if (req.user.role?.slug === 'student') {
      targetStudentId = req.user.id;
    } else if (req.user.role?.slug === 'parent') {
      const parentProf = await ParentProfile.findOne({ user: req.user.id });
      const linkedChildren = (parentProf?.children || []).map((c) => c.toString());

      if (studentId) {
        if (!linkedChildren.includes(studentId.toString())) {
          return next(new AppError('Unauthorized: You can only upload documents for your linked children.', 403));
        }
        targetStudentId = studentId;
      } else if (linkedChildren.length > 0) {
        targetStudentId = linkedChildren[0];
      }
    } else if (studentId) {
      targetStudentId = studentId;
    }

    const doc = await Document.create({
      title,
      documentType,
      fileUrl,
      fileSize: fileSize || '1.2 MB',
      mimeType: mimeType || 'application/pdf',
      student: targetStudentId,
      uploadedBy: req.user.id,
      status: 'Pending Review',
    });

    const populated = await Document.findById(doc._id)
      .populate('student', 'fullName email')
      .populate('uploadedBy', 'fullName email');

    res.status(201).json({
      success: true,
      message: 'Document uploaded successfully and queued for review.',
      data: populated,
    });
  } catch (err) {
    next(err);
  }
};

// Get documents for user or student
exports.getDocuments = async (req, res, next) => {
  try {
    const filter = {};
    if (req.user.role?.slug === 'student') {
      filter.student = req.user.id;
    } else if (req.user.role?.slug === 'parent') {
      const parentProf = await ParentProfile.findOne({ user: req.user.id });
      const childrenIds = (parentProf?.children || []).map((c) => (c._id ? c._id : c));

      if (req.query.studentId) {
        if (!childrenIds.map((id) => id.toString()).includes(req.query.studentId.toString())) {
          return next(new AppError('Unauthorized: You can only view documents for your linked children.', 403));
        }
        filter.student = req.query.studentId;
      } else {
        filter.$or = [{ uploadedBy: req.user.id }, { student: { $in: childrenIds } }];
      }
    } else if (req.query.studentId) {
      filter.student = req.query.studentId;
    }

    const documents = await Document.find(filter)
      .populate('student', 'fullName email')
      .populate('uploadedBy', 'fullName email')
      .populate('reviewedBy', 'fullName')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: documents.length,
      data: documents,
    });
  } catch (err) {
    next(err);
  }
};

// Review document (Admin / Staff approve or reject)
exports.reviewDocument = async (req, res, next) => {
  try {
    const { status, reviewNotes } = req.body;
    if (!['Approved', 'Rejected', 'Pending Review'].includes(status)) {
      return next(new AppError('Invalid document status', 400));
    }

    const doc = await Document.findByIdAndUpdate(
      req.params.id,
      {
        status,
        reviewNotes: reviewNotes || '',
        reviewedBy: req.user.id,
        reviewedAt: Date.now(),
      },
      { new: true }
    ).populate('student', 'fullName email');

    if (!doc) return next(new AppError('Document not found', 404));

    // Send notification to student/parent
    await Notification.create({
      recipient: doc.student._id,
      title: `Document ${status}`,
      message: `Your uploaded document "${doc.title}" (${doc.documentType}) has been ${status.toLowerCase()}.${
        reviewNotes ? ' Notes: ' + reviewNotes : ''
      }`,
      type: 'document_status',
      link: '/documents',
    });

    res.status(200).json({
      success: true,
      message: `Document status updated to ${status}`,
      data: doc,
    });
  } catch (err) {
    next(err);
  }
};
