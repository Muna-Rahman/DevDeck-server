// CRITICAL: Initialize environment variables before importing anything else
import "dotenv/config"; 
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";

const app = express();
const PORT = process.env.PORT || 3001;

// Allowed application origins array matching your environments perfectly
const allowedOrigins = [
  "http://localhost:3000",
  "https://devdeck-two.vercel.app",
  "https://devdeck-server.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    // Allows requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allows session cookies to pass cross-origin on localhost
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"]
}));

// CRITICAL FIX: Mount the Better Auth route handler BEFORE express.json()
// Better Auth must read the raw unparsed request stream to handle authentication flows.
app.use("/api/auth", (req, res) => {
  return toNodeHandler(auth)(req, res);
});

// Any json parsing middleware must strictly live below the Better Auth route
app.use(express.json());

app.get("/", (req, res) => {
  res.send("DevDeck Server is running successfully.");
});

// Run standard listen mode if not on Vercel/Production serverless context
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 DevDeck Backend server running at http://localhost:${PORT}`);
  });
} else {
  console.log("DevDeck Backend loaded in Serverless Production Mode.");
}

// Ensure Vercel can resolve and hook into the routing configuration
export default app;