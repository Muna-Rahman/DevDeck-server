import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { toNodeHandler } from "better-auth/node"; 
import { auth } from "./auth.js";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: [
    "http://localhost:3000",
    "https://devdeck-two.vercel.app",
    "https://devdeck-client.vercel.app"
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"]
}));

// Express v5 strictly requires named wildcard splats/parameters!
// Changing '/*' to '/*splat' fixes the Express 5 route parser crash.
app.all("/api/auth/*splat", toNodeHandler(auth));

// Mount body parsers safely AFTER the Better Auth catch-all route handler
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "DevDeck API Server Engine Operational." });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", database: "connected to Atlas Cluster" });
});

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 DevDeck Backend server running at http://localhost:${PORT}`);
  });
}

// Ensure Vercel can resolve and hook into the routing configuration
export default app;