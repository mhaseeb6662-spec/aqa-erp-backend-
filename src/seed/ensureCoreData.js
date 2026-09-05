const Role = require('../models/Role');
const User = require('../models/User');
const Branch = require('../models/Branch');
const Program = require('../models/Program');
const StudentProfile = require('../models/StudentProfile');
const ParentProfile = require('../models/ParentProfile');
const Booking = require('../models/Booking');
const Schedule = require('../models/Schedule');
const Document = require('../models/Document');
const Notification = require('../models/Notification');
const config = require('../config/config');
const { DEFAULT_ROLES } = require('../config/rbac.constants');

/**
 * ensureCoreData
 * ----------------------------------------------------------------
 * Guarantees the default system roles and a Super Admin account
 * exist, every time the API boots — not just when someone
 * remembers to run `npm run seed` by hand.
 *
 * This is what used to bite people in production: deploy fresh to
 * a new/empty database, forget the manual seed step, and then
 * "Add user" / "Assign lead" quietly fail because their dropdowns
 * have nothing to select (no roles => no role options; no roles =>
 * no sales-team users => no assignee options). Running this on
 * every boot removes that failure mode entirely — it's a no-op on
 * an already-seeded database.
 */
const ensureCoreData = async () => {
  const roleMap = {};

  for (const roleDef of DEFAULT_ROLES) {
    // System roles are re-synced on every boot so new permissions added
    // in a later phase reach roles that were already created earlier.
    // Non-system / custom roles created by an admin are left untouched.
    const role = await Role.findOneAndUpdate(
      { slug: roleDef.slug },
      {
        $setOnInsert: { name: roleDef.name, slug: roleDef.slug, isSystem: roleDef.isSystem },
        $set: { description: roleDef.description, permissions: roleDef.permissions },
      },
      { upsert: true, new: true }
    );
    roleMap[roleDef.slug] = role;
  }

  let adminUser = await User.findOne({ email: config.superAdmin.email }).select('+password');

  if (!adminUser) {
    adminUser = await User.create({
      fullName: config.superAdmin.name,
      email: config.superAdmin.email,
      password: config.superAdmin.password,
      role: roleMap['super-admin']._id,
      status: 'active',
      isEmailVerified: true,
    });
    console.log(`[Seed] Super Admin created: ${config.superAdmin.email}`);
  } else {
    const isPassMatch = await adminUser.comparePassword(config.superAdmin.password);
    if (!isPassMatch) {
      adminUser.password = config.superAdmin.password;
    }
    adminUser.status = 'active';
    adminUser.loginAttempts = 0;
    adminUser.lockUntil = undefined;
    await adminUser.save();
    console.log(`[Seed] Super Admin synced & active: ${config.superAdmin.email}`);
  }

  // Seed Default Demo Coach User
  if (roleMap['coach']) {
    let coachUser = await User.findOne({ email: 'coach@aquafishing.academy' }).select('+password');
    if (!coachUser) {
      coachUser = await User.create({
        fullName: 'Captain Tariq Mansoor (Head Fishing Coach)',
        email: 'coach@aquafishing.academy',
        password: 'CoachPassword123!',
        role: roleMap['coach']._id,
        status: 'active',
        isEmailVerified: true,
      });
      console.log('[Seed] Default Coach created: coach@aquafishing.academy');
    } else {
      coachUser.password = 'CoachPassword123!';
      coachUser.status = 'active';
      coachUser.loginAttempts = 0;
      coachUser.lockUntil = undefined;
      await coachUser.save();
      console.log('[Seed] Default Coach synced: coach@aquafishing.academy');
    }
    // Assign unassigned schedules to default coach
    await Schedule.updateMany(
      { $or: [{ instructor: null }, { instructor: { $exists: false } }] },
      { instructor: coachUser._id }
    );
  }

  const Branch = require('../models/Branch');
  const Program = require('../models/Program');

  // Seed default branches if empty, or ensure Dubai, Fujairah, and W&B exist
  const branchCount = await Branch.countDocuments();
  let defaultBranches = [];
  if (branchCount === 0) {
    defaultBranches = await Branch.insertMany([
      {
        name: 'Dubai',
        code: 'DXB',
        address: 'Dubai Marina Hub, Dubai, UAE',
        city: 'Dubai',
        phone: '+971 4 399 1234',
        email: 'dubai@aquafishing.academy',
        facilities: ['Deep Sea Simulator', 'Boat Dock', 'Equipment Rental', 'Pro Shop', 'Locker Room'],
        operatingHours: 'Mon-Sat: 07:00 AM - 08:00 PM',
        capacity: 100,
        isActive: true,
      },
      {
        name: 'Fujairah',
        code: 'FUJ',
        address: 'Fujairah Port & Marine Club, Fujairah, UAE',
        city: 'Fujairah',
        phone: '+971 9 222 5678',
        email: 'fujairah@aquafishing.academy',
        facilities: ['Kayak Launch', 'Junior Training Tank', 'Seminar Hall', 'Cafeteria'],
        operatingHours: 'Tue-Sun: 08:00 AM - 06:00 PM',
        capacity: 60,
        isActive: true,
      },
      {
        name: 'W&B',
        code: 'WNB',
        address: 'Water & Beyond Marine Base, Dubai, UAE',
        city: 'Dubai',
        phone: '+971 4 388 9012',
        email: 'wb@aquafishing.academy',
        facilities: ['Charter Boat Fleet', 'Spearfishing Vault', 'Night Rigging Lab'],
        operatingHours: 'Mon-Sun: 06:00 AM - 09:00 PM',
        capacity: 80,
        isActive: true,
      },
    ]);
    console.log('[Seed] Default active branches created: Dubai, Fujairah, W&B.');
  } else {
    // In-place migration for legacy demo branch names if any exist
    await Branch.updateOne(
      { $or: [{ name: 'Main Marina Branch' }, { code: 'BR-MARINA' }] },
      { $set: { name: 'Dubai', code: 'DXB', city: 'Dubai', address: 'Dubai Marina Hub, Dubai, UAE', phone: '+971 4 399 1234', email: 'dubai@aquafishing.academy', isActive: true } }
    );
    await Branch.updateOne(
      { $or: [{ name: 'Coastal Bay Academy' }, { code: 'BR-BAY' }] },
      { $set: { name: 'Fujairah', code: 'FUJ', city: 'Fujairah', address: 'Fujairah Port & Marine Club, Fujairah, UAE', phone: '+971 9 222 5678', email: 'fujairah@aquafishing.academy', isActive: true } }
    );
    await Branch.updateOne(
      { $or: [{ name: 'Deep Blue Pier Center' }, { code: 'BR-PIER' }] },
      { $set: { name: 'W&B', code: 'WNB', city: 'Dubai', address: 'Water & Beyond Marine Base, Dubai, UAE', phone: '+971 4 388 9012', email: 'wb@aquafishing.academy', isActive: true } }
    );

    defaultBranches = await Branch.find({ isActive: true });

    // Normalize legacy user branch strings to native ObjectIds
    const dubaiBranch = defaultBranches.find((b) => b.code === 'DXB');
    if (dubaiBranch) {
      await User.updateMany(
        { branch: { $in: ['Main Branch', 'Palm', 'Main Marina Branch'] } },
        { $set: { branch: dubaiBranch._id } }
      );
      const hexUsers = await User.collection.find({ branch: { $type: 'string' } }).toArray();
      for (const u of hexUsers) {
        if (mongoose.Types.ObjectId.isValid(u.branch)) {
          await User.collection.updateOne({ _id: u._id }, { $set: { branch: new mongoose.Types.ObjectId(u.branch) } });
        }
      }
    }
  }

  // Seed default programs if empty
  const programCount = await Program.countDocuments();
  if (programCount === 0 && defaultBranches.length > 0) {
    const branchIds = defaultBranches.map((b) => b._id);
    await Program.insertMany([
      {
        title: 'Little Angler Academy',
        code: 'PROG-LITTLE',
        category: 'Little Angler',
        description: 'Introductory hands-on academy for young kids. Basic safety, knot tying, line casting, and marine ecology.',
        level: 'Beginner',
        ageGroup: 'Kids (4-8)',
        durationWeeks: 2,
        sessionsCount: 6,
        price: 249,
        branches: branchIds,
        status: 'active',
      },
      {
        title: 'Angler Core Development',
        code: 'PROG-ANGLER',
        category: 'Angler',
        description: 'Comprehensive fishing techniques covering tackle selection, lure action, water reading, and boat handling.',
        level: 'Beginner',
        ageGroup: 'Kids & Teens (8-15)',
        durationWeeks: 4,
        sessionsCount: 8,
        price: 349,
        branches: branchIds,
        status: 'active',
      },
      {
        title: 'Discovery Marine & Coastal Fishing',
        code: 'PROG-DISCOVERY',
        category: 'Discovery',
        description: 'Explore coastal ecosystems, fish species identification, tidal movements, and lure casting.',
        level: 'Intermediate',
        ageGroup: 'All Ages',
        durationWeeks: 4,
        sessionsCount: 8,
        price: 399,
        branches: [branchIds[0], branchIds[1]],
        status: 'active',
      },
      {
        title: 'Advanced Offshore & Tournament Camp',
        code: 'PROG-ADVANCED',
        category: 'Advanced Camp',
        description: 'Master pelagic fish behavior, outrigger setup, live bait rigging, heavy-tackle fish fighting, and GPS navigation.',
        level: 'Advanced',
        ageGroup: 'Teens & Adults (15+)',
        durationWeeks: 6,
        sessionsCount: 12,
        price: 599,
        branches: branchIds,
        status: 'active',
      },
      {
        title: 'Deep Sea & Coastal Fishing Expedition Trip',
        code: 'PROG-TRIPS',
        category: 'Trips',
        description: 'Full-day charter fishing trips on open waters with certified academy coaches and captains.',
        level: 'All Levels',
        ageGroup: 'All Ages',
        durationWeeks: 1,
        sessionsCount: 2,
        price: 499,
        branches: branchIds,
        status: 'active',
      },
    ]);
    console.log('[Seed] Blueprint programs created (Little Angler, Angler, Discovery, Advanced Camp, Trips).');
  }

  // Seed default finance invoices and payments if empty
  const Invoice = require('../models/Invoice');
  const PaymentTransaction = require('../models/PaymentTransaction');
  const Receipt = require('../models/Receipt');

  const invoiceCount = await Invoice.countDocuments();
  if (invoiceCount === 0 && adminUser) {
    const inv1 = await Invoice.create({
      invoiceNumber: 'INV-100281',
      customer: adminUser._id,
      student: adminUser._id,
      lineItems: [
        { description: 'Angling Essentials & Knot Tying 101 - Course Fee', quantity: 1, unitPrice: 299, amount: 299 },
        { description: 'Equipment Rental & Safety Gear', quantity: 1, unitPrice: 50, amount: 50 },
      ],
      subtotal: 349,
      taxRate: 5,
      taxAmount: 17.45,
      discount: 0,
      totalAmount: 366.45,
      amountPaid: 366.45,
      balanceDue: 0,
      status: 'Paid',
      dueDate: new Date(),
    });

    const tx1 = await PaymentTransaction.create({
      transactionId: 'TXN-901823',
      invoice: inv1._id,
      customer: adminUser._id,
      amount: 366.45,
      paymentMethod: 'Credit Card',
      status: 'Completed',
      gatewayReference: 'GW-STRIPE-8912',
      cardLast4: '4242',
    });

    await Receipt.create({
      receiptNumber: 'RCT-501928',
      payment: tx1._id,
      invoice: inv1._id,
      customer: adminUser._id,
      amountPaid: 366.45,
      paymentMethod: 'Credit Card',
    });

    // Unpaid/Overdue invoice sample
    await Invoice.create({
      invoiceNumber: 'INV-100282',
      customer: adminUser._id,
      student: adminUser._id,
      lineItems: [
        { description: 'Advanced Offshore Trolling & Big Game - Course Deposit', quantity: 1, unitPrice: 599, amount: 599 },
      ],
      subtotal: 599,
      taxRate: 5,
      taxAmount: 29.95,
      discount: 0,
      totalAmount: 628.95,
      amountPaid: 0,
      balanceDue: 628.95,
      status: 'Overdue',
      dueDate: new Date(Date.now() - 5 * 86400000), // 5 days overdue
    });

    console.log('[Seed] Default finance invoices & receipts created.');
  }

  return roleMap;
};

module.exports = ensureCoreData;
