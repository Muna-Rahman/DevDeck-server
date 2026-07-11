import "dotenv/config";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error("MONGODB_URI environment variable is missing!");
}

const client = new MongoClient(mongoUri);
const db = client.db();

export const auth = betterAuth({
    database: mongodbAdapter(db),
    emailAndPassword: {  
        enabled: true
    },
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001/api/auth",
    trustedOrigins: [
        "http://localhost:3000",
        "https://devdeck-two.vercel.app",
        "https://devdeck-server.vercel.app"
    ],
    // ADD THIS CRITICAL BLOCK BELOW TO ENABLE CROSS-SITE COOKIES ON VERCEL:
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true
      }
    }
});