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
  user: {
    changeEmail: {
      enabled: true,
    },
    deleteUser: {
      enabled: true, // Enables authClient.deleteUser()
    },
  },
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001/api/auth",
  trustedOrigins: [
    "http://localhost:3000",
    "https://devdeck-two.vercel.app",
    "https://devdeck-server.vercel.app"
  ],
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true
    }
  }
});