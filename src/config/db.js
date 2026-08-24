const dns = require('dns');
const mongoose = require('mongoose');
const config = require('./config');

// Safe DNS server override for setups where SRV lookups fail
if (config.mongoUri && config.mongoUri.startsWith('mongodb+srv://')) {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch {
    // Ignore DNS override errors on restricted container environments
  }
}

const FALLBACK_DIRECT_URI = 'mongodb://mhaseeb6662_db_user:muneeb12@ac-nuxgdsj-shard-00-00.gkksdzf.mongodb.net:27017,ac-nuxgdsj-shard-00-01.gkksdzf.mongodb.net:27017,ac-nuxgdsj-shard-00-02.gkksdzf.mongodb.net:27017/app?ssl=true&replicaSet=atlas-13cchd-shard-0&authSource=admin&retryWrites=true&w=majority';
const LOCAL_FALLBACK_URI = 'mongodb://127.0.0.1:27017/aqua_fishing_academy_erp';

let isConnected = false;
let connectionPromise = null;

/**
 * Establishes and caches the MongoDB connection using Mongoose.
 * Reuses active connections and provides fallback handling.
 */
const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  mongoose.set('strictQuery', true);

  const options = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  };

  const targetUri = config.mongoUri || FALLBACK_DIRECT_URI;

  connectionPromise = (async () => {
    try {
      const conn = await mongoose.connect(targetUri, options);
      isConnected = true;
      console.log(`[MongoDB] Connected: ${conn.connection.host}/${conn.connection.name}`);

      mongoose.connection.on('error', (err) => {
        console.error(`[MongoDB] Connection error: ${err.message}`);
        isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        console.warn('[MongoDB] Disconnected.');
        isConnected = false;
      });

      return conn;
    } catch (primaryError) {
      console.warn(`[MongoDB] Atlas connection failed (${primaryError.message}). Trying Direct Fallback...`);
      try {
        const fallbackConn = await mongoose.connect(FALLBACK_DIRECT_URI, options);
        isConnected = true;
        console.log(`[MongoDB] Connected via Direct Replica Set: ${fallbackConn.connection.host}/${fallbackConn.connection.name}`);
        return fallbackConn;
      } catch (fallbackError) {
        console.warn('[MongoDB] Atlas blocked by IP Whitelist. Attempting local MongoDB fallback...');
        try {
          const localConn = await mongoose.connect(LOCAL_FALLBACK_URI, options);
          isConnected = true;
          console.log(`[MongoDB] Connected to Local Database: ${localConn.connection.host}/${localConn.connection.name}`);
          return localConn;
        } catch {
          connectionPromise = null;
          console.error('\n======================================================');
          console.error('[MongoDB Atlas IP Whitelist Error]');
          console.error('MongoDB Atlas rejected the connection because your current IP is not whitelisted.');
          console.error('FIX: Log in to cloud.mongodb.com -> Network Access -> Add IP Address -> Select "ALLOW ACCESS FROM ANYWHERE" (0.0.0.0/0).');
          console.error('======================================================\n');
          throw primaryError;
        }
      }
    }
  })();

  return connectionPromise;
};

module.exports = connectDB;
