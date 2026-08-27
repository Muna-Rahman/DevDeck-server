import "dotenv/config"; 
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { getMongoClient } from "./db.js";

// Share the existing connection pool instead of opening a duplicate client
const client = getMongoClient();
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
      enabled: true, // allows authClient.deleteUser()

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
          // The auth record is already removed, so log and continue rather than throwing
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