const mongoose = require('mongoose');
const Schedule = require('./models/Schedule');
const User = require('./models/User');
const dotenv = require('dotenv');
dotenv.config({ path: '../.env' }); // load backend/.env

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const schedules = await Schedule.find().select('title instructor captain assistantCoach startTime').limit(5);
    console.log("Total schedules:", await Schedule.countDocuments());
    console.log("Sample schedules:", JSON.stringify(schedules, null, 2));

    const coaches = await User.find({ status: 'active' }).populate('role');
    const coachUsers = coaches.filter(c => c.role?.slug === 'coach').map(c => ({id: c._id, name: c.fullName}));
    console.log("Available coaches:", coachUsers);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
