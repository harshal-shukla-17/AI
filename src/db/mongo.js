import mongoose from 'mongoose';

let connected = false;

export async function connectMongo(uri = process.env.MONGODB_URI, dbName = process.env.DB_NAME) {
  if (connected) return mongoose.connection;
  if (!uri) {
    console.warn('[mongo] MONGODB_URI not set. Running in in-memory mode.');
    return null;
  }
  try {
    await mongoose.connect(uri, { dbName });
    connected = true;
    const cn = mongoose.connection;
    cn.on('disconnected', () => { connected = false; console.warn('[mongo] disconnected'); });
    console.log(`[mongo] connected to ${dbName}`);
    return cn;
  } catch (err) {
    console.error('[mongo] connection error:', err.message);
    return null;
  }
}

export function isMongoConnected() {
  return connected;
}
