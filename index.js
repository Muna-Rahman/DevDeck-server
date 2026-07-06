import express from "express";
import cors from "cors";
import dotenv from "dotenv";
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

// Better Auth Route Interceptor (Must be placed BEFORE express.json())
app.all("/api/auth/*any", (req, res) => {
  auth.handler(req, res);
});

// Regular Body Parser for custom CRUD endpoints
app.use(express.json());

// Server Verification Route
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", database: "connected to Atlas Cluster" });
});

app.listen(PORT, () => {
  console.log(`🚀 DevDeck Backend server running at http://localhost:${PORT}`);
});