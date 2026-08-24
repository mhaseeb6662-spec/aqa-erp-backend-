const mongoose = require('mongoose');
const Role = require('./models/Role');
const dotenv = require('dotenv');
dotenv.config();

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to DB');
    
    const roles = await Role.find();
    console.log(`Found ${roles.length} roles.`);
    for (let role of roles) {
      if (role.slug === 'super-admin' || role.slug === 'admin' || role.slug === 'operations-manager') {
        const newPerms = ['operations:view', 'operations:manage', 'operations:create', 'operations:edit'];
        const perms = new Set([...role.permissions, ...newPerms]);
        role.permissions = Array.from(perms);
        await role.save();
        console.log(`Updated permissions for ${role.slug}`);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
run();
