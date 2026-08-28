// Share one Mongo client everywhere (better-auth + API routes) so we don't 
// blow past connection limits or cause connection storms.

import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error("MONGODB_URI environment variable is missing!");
}

let cachedClient = null;
let cachedDb = null;
let indexesReadyPromise = null;

export function getMongoClient() {
  if (!cachedClient) {
    cachedClient = new MongoClient(mongoUri, {
      maxPoolSize: 10,
      minPoolSize: 1, // Keep a connection warm so cold starts don't feel sluggish
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("💾 MongoDB Atlas: Shared connection pool created.");
  }
  return cachedClient;
}

// Grab the db instance. Connects if needed and sets up our indexes the 
// first time anyone calls this.
export async function getDatabase() {
  if (cachedDb) return cachedDb;

  const client = getMongoClient();
  await client.connect(); // Safe to call even if we're already connected

  cachedDb = client.db();

  // Spin up all our indexes once per container lifetime. We cache the promise 
  // so concurrent requests don't end up duplicating index creation work.
  if (!indexesReadyPromise) {
    indexesReadyPromise = Promise.all([
      cachedDb.collection("cards").createIndex({ userId: 1, createdAt: -1 }),
      cachedDb.collection("cards").createIndex({ userId: 1, isBookmarked: 1 }),
      cachedDb.collection("cards").createIndex({ userId: 1, type: 1 }),
      
      // Index by (userId, clientRequestId) instead of globally. 
      // Keeps everything strictly isolated per user (just like contentHash) 
      // and prevents a rare random UUID collision from leaking or touching someone else's data during a retry.
      cachedDb.collection("cards").createIndex(
        { userId: 1, clientRequestId: 1 },
        { unique: true, sparse: true }
      ),
      
      cachedDb.collection("cards").createIndex(
        { userId: 1, contentHash: 1 },
        { unique: true, partialFilterExpression: { contentHash: { $exists: true } } }
      ),
      cachedDb.collection("snippets").createIndex({ userId: 1, createdAt: -1 }),
      cachedDb.collection("snippets").createIndex({ userId: 1, bookmarked: 1 }),
      cachedDb.collection("snippets").createIndex(
        { userId: 1, clientRequestId: 1 },
        { unique: true, sparse: true }
      ),
      cachedDb.collection("snippets").createIndex(
        { userId: 1, contentHash: 1 },
        { unique: true, partialFilterExpression: { contentHash: { $exists: true } } }
      ),
      cachedDb.collection("categories").createIndex({ userId: 1, createdAt: -1 }),
      cachedDb.collection("categories").createIndex({ userId: 1, nameLower: 1 }, { unique: true }),
    ]).catch((idxErr) => {
      console.warn("Index initialization notice:", idxErr.message);
    });
  }
  await indexesReadyPromise;

  return cachedDb;
}