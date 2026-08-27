// ==========================================================================
// SHARED MONGODB CONNECTION (single source of truth)
// --------------------------------------------------------------------------
// Previously, auth.js (better-auth session checks) and index.js (data
// queries) each created their OWN separate MongoClient. Since every single
// API request calls auth.api.getSession() first and then queries data,
// that meant every request paid for TWO separate connection pools / TLS
// handshakes instead of one shared, warmed-up pool. That's the main reason
// data loading felt slow, especially on cold starts in serverless (Vercel).
//
// This module creates ONE MongoClient, cached at module scope, and shares
// it (and its already-open connection pool) across both better-auth and
// all application routes.
// ==========================================================================

import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error("MONGODB_URI environment variable is missing!");
}

let cachedClient = null;
let cachedDb = null;
let indexesReadyPromise = null;

// Synchronous-safe accessor: returns the (possibly-not-yet-connected)
// MongoClient instance. Safe to call at module load time (e.g. from
// auth.js) — the driver lazily connects on first operation, and any
// later explicit .connect() call below is a safe no-op once connected.
export function getMongoClient() {
  if (!cachedClient) {
    cachedClient = new MongoClient(mongoUri, {
      maxPoolSize: 10,
      minPoolSize: 1, // keep at least one warm connection between requests on a warm lambda
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("💾 MongoDB Atlas: Shared connection pool created.");
  }
  return cachedClient;
}

// Async accessor used by data routes. Ensures the client is actually
// connected and indexes exist, then returns the cached Db handle.
export async function getDatabase() {
  if (cachedDb) return cachedDb;

  const client = getMongoClient();
  await client.connect(); // safe no-op if already connected/connecting

  cachedDb = client.db();

  // Ensure DB indexes exist for fast query matching. Only ever runs once
  // per warm lambda instance (guarded by the cachedDb check above), and
  // the promise itself is cached so concurrent cold-start requests don't
  // race to create the same indexes twice.
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