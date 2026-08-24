/**
 * Seeds the default system roles and a Super Admin account.
 * Run with: npm run seed
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const ensureCoreData = require('./ensureCoreData');

const seed = async () => {
  await connectDB();

  console.log('Seeding default roles and Super Admin...');
  await ensureCoreData();

  console.log('Seeding complete.');
  await mongoose.connection.close();
  process.exit(0);
};

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
