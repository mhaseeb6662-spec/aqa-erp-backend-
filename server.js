const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config();

const app = require('./src/app');
const connectDB = require('./src/config/db');
const config = require('./src/config/config');
const ensureCoreData = require('./src/seed/ensureCoreData');

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message);
  process.exit(1);
});

const start = async () => {
  await connectDB();

  // Guarantees default roles + a Super Admin always exist, even on a
  // brand-new/empty database, so "Add user" and "Assign lead" never
  // silently fail just because nobody ran `npm run seed` by hand.
  // Safe to run on every boot — it's a no-op once the data exists.
  try {
    await ensureCoreData();
  } catch (err) {
    console.error('[Seed] Failed to ensure default roles/Super Admin:', err.message);
  }

  const server = app.listen(config.port, () => {
    console.log(`Aqua Fishing Academy ERP API running in ${config.env} mode on port ${config.port}`);
  });

  process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! Shutting down...');
    console.error(err.name, err.message);
    server.close(() => process.exit(1));
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => console.log('Process terminated.'));
  });
};

start();
