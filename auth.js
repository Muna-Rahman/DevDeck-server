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

   
      afterDelete: async (user) => {
        try {
          const userId = user.id;

          const [cardsResult, snippetsResult] = await Promise.all([
            db.collection("cards").deleteMany({ userId }),
            db.collection("snippets").deleteMany({ userId }),
          ]);

          console.log(
            `🧹 Cascade delete complete for user ${userId}: ` +
            `${cardsResult.deletedCount} card(s), ${snippetsResult.deletedCount} snippet(s) removed.`
          );
        } catch (err) {
          // Never let cleanup failure surface as a failed account deletion —
          // the auth record is already gone at this point. Just log it so
          // it can be investigated/cleaned up manually if it ever happens.
          console.error("⚠️ Failed to cascade delete user workspace data:", err);
        }
      },
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