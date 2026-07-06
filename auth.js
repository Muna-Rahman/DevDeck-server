// auth.js
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb"; // Imported directly from the core adapters path
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.MONGODB_URI) {
  throw new Error("Missing MONGODB_URI environment variable");
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db();

export const auth = betterAuth({
  // Wrap your database instance with the mongodbAdapter function and pass the client
  database: mongodbAdapter(db, {
    client: client
  }), 
  
  emailAndPassword: {
    enabled: true
  },
  trustedOrigins: [process.env.FRONTEND_URL || "http://localhost:3000"]
});