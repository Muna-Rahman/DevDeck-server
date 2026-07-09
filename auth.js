import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb"; 
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

if (!process.env.MONGODB_URI) {
  throw new Error("Missing MONGODB_URI environment variable");
}

// Serverless global database caching layer
let client;
let db;

if (process.env.NODE_ENV === "production") {
  client = new MongoClient(process.env.MONGODB_URI);
  db = client.db();
} else {
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(process.env.MONGODB_URI);
  }
  client = global._mongoClient;
  db = global._mongoClient.db();
}

const isProduction = process.env.NODE_ENV === "production" || (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost"));

export const auth = betterAuth({
  database: mongodbAdapter(db, {
    client: client
  }), 
  
  emailAndPassword: {
    enabled: true
  },

  trustHost: true, // Tells Better Auth to trust Vercel's internal reverse-proxy headers

  trustedOrigins: [
    process.env.FRONTEND_URL || "http://localhost:3000",
    "https://devdeck-two.vercel.app",
    "https://devdeck-client.vercel.app"
  ],

  advanced: {
    crossSubDomainCookie: false 
  },
  
  cookie: isProduction ? {
    secure: true,
    sameSite: "none"
  } : undefined
});