// Share one Mongo client across better-auth and our API routes to prevent extra connection pools.

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
      minPoolSize: 1, // Keep at least one connection warm so cold starts don't drag
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("💾 MongoDB Atlas: Shared connection pool created.");
  }
  return cachedClient;
}

// Helper to grab the db instance; handles connecting and setting up indexes on first call.
export async function getDatabase() {
  if (cachedDb) return cachedDb;

  const client = getMongoClient();
  await client.connect(); // Safe to call even if we're already connected

  cachedDb = client.db();

  // Create indexes once per container lifecycle, caching the promise so concurrent calls don't duplicate work.
  if (!indexesReadyPromise) {
    indexesReadyPromise = Promise.all([
      cachedDb.collection("cards").createIndex({ userId: 1, createdAt: -1 }),
      cachedDb.collection("cards").createIndex({ userId: 1, isBookmarked: 1 }),
      cachedDb.collection("cards").createIndex({ userId: 1, type: 1 }),
      
      // Index by (userId, clientRequestId) rather than clientRequestId globally.
      // This matches our per-user uniqueness model (like contentHash and nameLower)
      // and prevents rare UUID collisions from leaking another user's document during retries.
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