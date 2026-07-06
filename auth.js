// auth.js
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb"; 
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.MONGODB_URI) {
  throw new Error("Missing MONGODB_URI environment variable");
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db();

// Detect if we are running live on Vercel or locally
const isProduction = process.env.NODE_ENV === "production" || (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost"));

export const auth = betterAuth({
  database: mongodbAdapter(db, {
    client: client
  }), 
  
  emailAndPassword: {
    enabled: true
  },

  trustedOrigins: [
    process.env.FRONTEND_URL || "http://localhost:3000",
    "https://devdeck-client.vercel.app" // Add explicit fallback for your Vercel url string
  ],

  // Dynamically configure cookie handling depending on environment context
 advanced: {
    // Disable crossSubDomainCookie if you are using default .vercel.app URLs
    crossSubDomainCookie: false 
  },
  cookie: isProduction ? {
    secure: true,
    sameSite: "none"
  } : undefined
});
  