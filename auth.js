import { betterAuth } from "better-auth";
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
  database: {
    db: db,
    type: "mongodb"
  },
  emailAndPassword: {
    enabled: true
  },
  trustedOrigins: [process.env.FRONTEND_URL || "http://localhost:3000"]
});