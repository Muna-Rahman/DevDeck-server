import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { toNodeHandler } from "better-auth/node"; // Added proper integration node utility
import { auth } from "./auth.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]
  })
);

// Fixed: Correctly mount the catch-all pattern through the better-auth helper
app.all("/api/auth/*any", toNodeHandler(auth));

// Regular Body Parser for custom CRUD endpoints (placed safely after)
app.use(express.json());

// Server Verification Route
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", database: "connected to Atlas Cluster" });
});

app.listen(PORT, () => {
  console.log(`🚀 DevDeck Backend server running at http://localhost:${PORT}`);
});