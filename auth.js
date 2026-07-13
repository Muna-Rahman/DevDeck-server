import "dotenv/config";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { MongoClient } from "mongodb";

// Grab  database connection string from .env
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  throw new Error("System Crash: MONGODB_URI environment variable is completely missing!");
}

// mongodb r connection establish kora
const client = new MongoClient(mongoUri);
const db = client.db();

// betterauth configuration and initialization
export const auth = betterAuth({
    // mongodb adapter use kora jate user data and session data store kora jay
    database: mongodbAdapter(db),
    
    // email password verification entryr jonno j part e enable hoy
    emailAndPassword: {  
        enabled: true
    },
    
    
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3001/api/auth",
    
    // authentication e j domain gula allowed thakbe
    trustedOrigins: [
        "http://localhost:3000",             
        "https://devdeck-two.vercel.app",   
        "https://devdeck-server.vercel.app" 
    ],
    
    // vercel serverless deployment e cookie secure thakbe

    advanced: {
      defaultCookieAttributes: {
        sameSite: "none", 
        secure: true      
    }
  }
});