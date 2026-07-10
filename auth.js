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
    // Dynamically uses environment variables
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001/api/auth",
    trustedOrigins: [
        "http://localhost:3000",
        "https://devdeck-two.vercel.app",
        "https://devdeck-server.vercel.app"
      ]
      // Note: We completely omitted the advanced.cookie block.
      // Better Auth will now automatically manage secure/lax cookies correctly 
      // for both local HTTP and production HTTPS environments.
});