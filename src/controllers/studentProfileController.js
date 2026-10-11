const StudentProfile = require('../models/StudentProfile');
const ParentProfile = require('../models/ParentProfile');
const Branch = require('../models/Branch');
const Program = require('../models/Program');
const User = require('../models/User');
const Role = require('../models/Role');
const AppError = require('../utils/appError');

// Helper to validate student access authorization
const validateStudentAccess = async (req, targetUserId) => {
  const currentUserId = req.user.id.toString();
  const roleSlug = req.user.role?.slug;

  // Own profile
  if (currentUserId === targetUserId.toString()) {
    return true;
  }

  // Admin & Staff roles
  if (['super-admin', 'admin', 'management', 'operations-manager', 'coach', 'instructor', 'head-coach'].includes(roleSlug)) {
    return true;
  }

  // Parent role: check if target is linked child
  if (roleSlug === 'parent') {
    const parent = await ParentProfile.findOne({ user: req.user.id });
    const childrenIds = (parent?.children || []).map((c) => (c._id ? c._id.toString() : c.toString()));
    if (childrenIds.includes(targetUserId.toString())) {
      return true;
    }
    const studentProfile = await StudentProfile.findOne({ user: targetUserId, parentUser: req.user.id });
    if (studentProfile) {
      return true;
    }
    throw new AppError('Unauthorized: You can only access profiles of your linked children.', 403);
  }

  // Student trying to access another student
  throw new AppError('Unauthorized: You can only access your own student profile.', 403);
};

// 1. Get current logged-in student profile or specific student by ID/user ID
exports.getStudentProfile = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId || req.user.id;
    await validateStudentAccess(req, targetUserId);

    let profile = await StudentProfile.findOne({ user: targetUserId })
      .populate('user', 'fullName email phone branch avatarUrl')
      .populate('parentUser', 'fullName email phone')
      .populate('primaryBranch', 'name code city address')
      .populate('enrolledPrograms');

    if (!profile) {
      // Auto-create profile if missing for student user
      const studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
      profile = await StudentProfile.create({
        user: targetUserId,
        studentCode,
      });
      profile = await StudentProfile.findById(profile._id)
        .populate('user', 'fullName email phone branch avatarUrl')
        .populate('parentUser', 'fullName email phone')
        .populate('primaryBranch', 'name code city address')
        .populate('enrolledPrograms');
    }

    if (!profile) return next(new AppError('Student profile not found', 404));

    res.status(200).json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
};

// 2. Update student profile
exports.updateStudentProfile = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId || req.user.id;
    await validateStudentAccess(req, targetUserId);

    let profile = await StudentProfile.findOne({ user: targetUserId });

    if (!profile) {
      const studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
      profile = await StudentProfile.create({
        user: targetUserId,
        studentCode,
        ...req.body,
      });
    } else {
      profile = await StudentProfile.findOneAndUpdate({ user: targetUserId }, req.body, {
        new: true,
        runValidators: true,
      });
    }

    // Also update User branch if primaryBranch updated
    if (req.body.fullName || req.body.phone) {
      await User.findByIdAndUpdate(targetUserId, {
        fullName: req.body.fullName,
        phone: req.body.phone,
      });
    }

    const updated = await StudentProfile.findById(profile._id)
      .populate('user', 'fullName email phone branch avatarUrl')
      .populate('parentUser', 'fullName email phone')
      .populate('primaryBranch')
      .populate('enrolledPrograms');

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
};

// 3. Admin list all students
exports.getAllStudents = async (req, res, next) => {
  try {
    const students = await StudentProfile.find()
      .populate('user', 'fullName email phone branch status')
      .populate('parentUser', 'fullName email phone')
      .populate('primaryBranch', 'name code city')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, count: students.length, data: students });
  } catch (err) {
    next(err);
  }
};

// 4. Bulk Migrate / Import Students
exports.migrateStudents = async (req, res, next) => {
  try {
    const { students = [], dryRun = false } = req.body;

    if (!Array.isArray(students) || students.length === 0) {
      return next(new AppError('Please provide an array of student records to migrate.', 400));
    }

    const studentRole = await Role.findOne({ slug: 'student' });
    const parentRole = await Role.findOne({ slug: 'parent' });
    const defaultBranch = await Branch.findOne();
    const allBranches = await Branch.find();
    const allPrograms = await Program.find();

    const summary = {
      totalRecords: students.length,
      isDryRun: Boolean(dryRun),
      validCount: 0,
      importedCount: 0,
      duplicateCount: 0,
      rejectedCount: 0,
      errors: [],
      importedSamples: [],
      duplicates: [],
    };

    // Helper to find value from row using multiple potential column aliases
    const getVal = (row, ...keys) => {
      for (const k of keys) {
        if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
          return String(row[k]).trim();
        }
        // Also check case-insensitive match
        const foundKey = Object.keys(row).find(
          (rk) => rk.toLowerCase().replace(/[\s_-]/g, '') === k.toLowerCase().replace(/[\s_-]/g, '')
        );
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && String(row[foundKey]).trim() !== '') {
          return String(row[foundKey]).trim();
        }
      }
      return '';
    };

    for (let i = 0; i < students.length; i++) {
      const row = students[i];
      const rowNum = i + 1;

      try {
        const fullName = getVal(row, 'fullName', 'studentName', 'name', 'full_name', 'student_name', 'Student Name', 'Name');
        const email = getVal(row, 'email', 'studentEmail', 'student_email', 'Student Email', 'Email').toLowerCase();
        const phone = getVal(row, 'phone', 'studentPhone', 'student_phone', 'Student Phone', 'Phone', 'Mobile', 'contact');
        const legacyId = getVal(row, 'legacyStudentId', 'studentCode', 'studentId', 'student_code', 'student_id', 'Student Code', 'Student ID', 'Legacy ID', 'id');
        const parentName = getVal(row, 'parentName', 'guardianName', 'parent_name', 'guardian_name', 'Parent Name', 'Father Name', 'Guardian');
        const parentEmail = getVal(row, 'parentEmail', 'guardianEmail', 'parent_email', 'guardian_email', 'Parent Email', 'Guardian Email').toLowerCase();
        const parentPhone = getVal(row, 'parentPhone', 'guardianPhone', 'parent_phone', 'guardian_phone', 'Parent Phone', 'Guardian Phone');
        const dobRaw = getVal(row, 'dateOfBirth', 'dob', 'date_of_birth', 'Date of Birth', 'DOB', 'Birth Date');
        const genderRaw = getVal(row, 'gender', 'sex', 'Gender', 'Sex');
        const skillRaw = getVal(row, 'skillLevel', 'level', 'skill_level', 'Skill Level', 'Level', 'Rank');
        const branchRaw = getVal(row, 'branch', 'branchName', 'branch_name', 'Branch', 'Branch Name', 'Location', 'City');
        const progRaw = getVal(row, 'program', 'programName', 'program_name', 'Program', 'Program Name', 'Course');
        const emergencyName = getVal(row, 'emergencyContactName', 'emergency_contact_name', 'emergencyName', 'Emergency Contact', 'Emergency Name');
        const emergencyPhone = getVal(row, 'emergencyContactPhone', 'emergency_contact_phone', 'emergencyPhone', 'Emergency Phone', 'Emergency Contact Phone');
        const medicalNotes = getVal(row, 'medicalNotes', 'medical_notes', 'Medical Notes', 'Medical', 'Allergies');

        // 1. Basic Validation: Must have at least a student name
        if (!fullName) {
          summary.rejectedCount++;
          summary.errors.push({ row: rowNum, error: 'Missing Student Name', data: row });
          continue;
        }

        const studentEmail = email || undefined;

        // 2. Check Duplicates by Student Code
        let existingProfile = null;
        if (legacyId) {
          existingProfile = await StudentProfile.findOne({ studentCode: legacyId });
        }

        // Also check if student with exact same name and phone already exists
        if (!existingProfile && phone) {
          const userMatch = await User.findOne({ fullName, phone, isStudent: true });
          if (userMatch) {
            existingProfile = await StudentProfile.findOne({ user: userMatch._id });
          }
        }

        // Check if email belongs to staff
        let staffEmailConflict = false;
        if (studentEmail) {
          const staffUser = await User.findOne({ email: studentEmail, isStudent: false }).populate('role');
          if (staffUser && staffUser.role?.slug !== 'parent') {
            staffEmailConflict = true;
          }
        }

        if (existingProfile || staffEmailConflict) {
          summary.duplicateCount++;
          summary.duplicates.push({
            row: rowNum,
            studentName: fullName,
            email: studentEmail || 'N/A',
            legacyId: legacyId || existingProfile?.studentCode,
            reason: staffEmailConflict ? 'Email belongs to active staff account' : 'Student already exists in system',
          });
          continue;
        }

        // 3. Branch Mapping
        let branchId = defaultBranch?._id;
        if (branchRaw) {
          const qBranch = branchRaw.toLowerCase();
          const matched = allBranches.find(
            (b) =>
              b.name?.toLowerCase().includes(qBranch) ||
              b.city?.toLowerCase().includes(qBranch) ||
              (b.code && b.code.toLowerCase() === qBranch) ||
              String(b._id) === branchRaw
          );
          if (matched) branchId = matched._id;
        }

        // 4. Program Mapping
        const enrolledProgramIds = [];
        if (progRaw) {
          const qProg = progRaw.toLowerCase();
          const matchedProg = allPrograms.find(
            (p) =>
              p.title?.toLowerCase().includes(qProg) ||
              (p.code && p.code.toLowerCase() === qProg) ||
              String(p._id) === progRaw
          );
          if (matchedProg) enrolledProgramIds.push(matchedProg._id);
        }

        summary.validCount++;

        // If dry run, do not write to database
        if (dryRun) {
          if (summary.importedSamples.length < 5) {
            summary.importedSamples.push({
              row: rowNum,
              fullName,
              email: studentEmail,
              studentCode: legacyId || 'AUTO-GENERATED',
              parentName: parentName || 'N/A',
              branch: branchId,
            });
          }
          continue;
        }

        // 5. Parent Resolution or Creation
        let parentUserId = null;
        if (parentEmail || parentPhone) {
          let parentUser = null;
          if (parentEmail) {
            parentUser = await User.findOne({ email: parentEmail });
          }
          if (!parentUser && parentPhone) {
            parentUser = await User.findOne({ phone: parentPhone, isStudent: false });
          }

          if (!parentUser) {
            parentUser = await User.create({
              fullName: parentName || `${fullName}'s Parent`,
              email: parentEmail || undefined,
              phone: parentPhone || '',
              role: parentRole?._id,
              branch: branchId,
              password: 'Password@12345',
            });
            await ParentProfile.create({
              user: parentUser._id,
              children: [],
            });
          }
          parentUserId = parentUser._id;
        }

        // 6. Generate Clean Student Code
        let studentCode = legacyId;
        if (!studentCode) {
          let isUnique = false;
          while (!isUnique) {
            studentCode = 'STU-' + Math.floor(100000 + Math.random() * 900000);
            const exists = await StudentProfile.findOne({ studentCode });
            if (!exists) isUnique = true;
          }
        }

        // 7. Parse Gender & Skill Level
        let gender = 'Prefer not to say';
        if (genderRaw) {
          const gLow = genderRaw.toLowerCase();
          if (gLow.startsWith('m') || gLow === 'boy') gender = 'Male';
          else if (gLow.startsWith('f') || gLow === 'girl') gender = 'Female';
          else if (['Male', 'Female', 'Other', 'Prefer not to say'].includes(genderRaw)) gender = genderRaw;
        }

        let skillLevel = 'Beginner';
        if (skillRaw) {
          const sLow = skillRaw.toLowerCase();
          if (sLow.includes('inter')) skillLevel = 'Intermediate';
          else if (sLow.includes('adv')) skillLevel = 'Advanced';
          else if (sLow.includes('mas')) skillLevel = 'Master';
          else if (['Beginner', 'Intermediate', 'Advanced', 'Master'].includes(skillRaw)) skillLevel = skillRaw;
        }

        let parsedDob = null;
        if (dobRaw) {
          const d = new Date(dobRaw);
          if (!isNaN(d.getTime())) parsedDob = d;
        }

        // 8. Create Student User
        const studentUser = await User.create({
          fullName,
          email: studentEmail,
          phone: phone || '',
          role: studentRole?._id,
          branch: branchId,
          password: 'Student@12345',
          studentCode,
          isStudent: true,
        });

        // 9. Create Student Profile
        const studentProfile = await StudentProfile.create({
          user: studentUser._id,
          parentUser: parentUserId,
          studentCode,
          dateOfBirth: parsedDob,
          gender,
          skillLevel,
          primaryBranch: branchId,
          enrolledPrograms: enrolledProgramIds,
          emergencyContact: {
            name: emergencyName || parentName || '',
            phone: emergencyPhone || parentPhone || phone || '',
            relationship: 'Parent/Guardian',
          },
          medicalNotes: medicalNotes || 'No known allergies or medical restrictions.',
          dietaryNotes: 'Standard diet.',
        });

        // 10. Link child to parent profile
        if (parentUserId) {
          await ParentProfile.findOneAndUpdate(
            { user: parentUserId },
            { $addToSet: { children: studentUser._id } }
          );
        }

        summary.importedCount++;
        if (summary.importedSamples.length < 5) {
          summary.importedSamples.push({
            id: studentProfile._id,
            studentCode,
            fullName,
            email: studentEmail,
            parentLinked: Boolean(parentUserId),
          });
        }
      } catch (rowErr) {
        summary.rejectedCount++;
        summary.errors.push({
          row: rowNum,
          studentName: row.fullName || row.name || 'Unknown',
          error: rowErr.message || 'Validation or database error',
        });
      }
    }

    res.status(200).json({
      success: true,
      message: dryRun
        ? `Migration Dry-Run complete: ${summary.validCount} valid records, ${summary.duplicateCount} duplicates, ${summary.rejectedCount} rejected.`
        : `Migration successfully imported ${summary.importedCount} students (${summary.duplicateCount} duplicates skipped, ${summary.rejectedCount} rejected).`,
      data: summary,
    });
  } catch (err) {
    next(err);
  }
};
