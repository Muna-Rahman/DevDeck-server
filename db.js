// Shared Mongo client setup to avoid duplicate connection pools
// between better-auth and standard API routes.

import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error("MONGODB_URI environment variable is missing!");
}

let cachedClient = null;
let cachedDb = null;
let indexesReadyPromise = null;

// Safe to call synchronously during module init (e.g., in auth config).
// The driver handles lazy connection on the first operation.
export function getMongoClient() {
  if (!cachedClient) {
    cachedClient = new MongoClient(mongoUri, {
      maxPoolSize: 10,
      minPoolSize: 1, // keep a warm connection ready for subsequent requests
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("💾 MongoDB Atlas: Shared connection pool created.");
  }
  return cachedClient;
}

// Main database accessor for route handlers. Connects if needed and ensures indexes exist.
export async function getDatabase() {
  if (cachedDb) return cachedDb;

  const client = getMongoClient();
  await client.connect(); // No-op if already connected

  cachedDb = client.db();

  // Run index setup once per container instance and cache the promise to prevent duplicate runs
  if (!indexesReadyPromise) {
    indexesReadyPromise = Promise.all([
      cachedDb.collection("cards").createIndex({ userId: 1, createdAt: -1 }),
      cachedDb.collection("cards").createIndex({ userId: 1, isBookmarked: 1 }),
      cachedDb.collection("cards").createIndex({ userId: 1, type: 1 }),
      cachedDb.collection("snippets").createIndex({ userId: 1, createdAt: -1 }),
      cachedDb.collection("snippets").createIndex({ userId: 1, bookmarked: 1 }),
      cachedDb.collection("categories").createIndex({ userId: 1, createdAt: -1 }),
      cachedDb.collection("categories").createIndex({ userId: 1, nameLower: 1 }, { unique: true }),
    ]).catch((idxErr) => {
      console.warn("Index initialization notice:", idxErr.message);
    });
  }
  await indexesReadyPromise;

  return cachedDb;
}