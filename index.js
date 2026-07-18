// CRITICAL: Initialize environment variables before importing anything else
import "dotenv/config"; 
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import crypto from "crypto";
import { MongoClient } from "mongodb"; // Import native MongoDB driver client

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Native MongoDB Database Driver Instance Connection
const client = new MongoClient(process.env.MONGODB_URI);
let db;

async function connectToAtlas() {
  try {
    await client.connect();
    // Dynamically targets your database from your MONGODB_URI ("devdeck")
    db = client.db(); 
    console.log("💾 MongoDB Atlas: Direct data pipeline connection verified.");
  } catch (err) {
    console.error("🚨 MongoDB Connection Failure:", err);
  }
}
connectToAtlas();

// Allowed application origins array matching your environments perfectly
const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://192.168.0.100:3000",
  "https://devdeck-two.vercel.app",
  "https://devdeck-server.vercel.app"
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`🚨 CORS Restriction: Blocked traffic from origin -> ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allows session cookies to pass cross-origin on localhost
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"]
}));

// CRITICAL FIX: Mount the Better Auth route handler BEFORE express.json()
app.use("/api/auth", (req, res) => {
  return toNodeHandler(auth)(req, res);
});

// Any json parsing middleware must strictly live below the Better Auth route
app.use(express.json());

app.get("/", (req, res) => {
  res.send("DevDeck Server is running successfully.");
});

/* ==========================================================================
   USER-ISOLATED MONGODB ACCOUNT DATA PORTS
   ========================================================================== */

// GET Endpoint: Stream cards belonging ONLY to the logged-in user account session
app.get("/api/cards", async (req, res) => {
  try {
    // Verify user authorization parameters via request session validation tokens
    const session = await auth.api.getSession({
      headers: req.headers
    });

    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    
    if (!db) {
      return res.status(503).json({ error: "Database service temporarily offline." });
    }

    // Query the "cards" collection dynamically, tracking matches to the User
    const cardsCollection = db.collection("cards");
    const workspaceCards = await cardsCollection
      .find({ userId: currentUserId })
      .sort({ timestamp: -1 })
      .toArray();

    return res.status(200).json(workspaceCards);
  } catch (error) {
    console.error("Database read anomaly:", error);
    return res.status(500).json({ error: "Failed to stream user workspace profiles." });
  }
});

// POST Endpoint: Commit card fields mapped explicitly to individual account identities
app.post("/api/cards", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers
    });

    if (!session || !session.user) {
      return res.status(401).json({ error: "Operation aborted. Unauthenticated session layer." });
    }

    const { type, content } = req.body;
    if (!type || !content) {
      return res.status(400).json({ error: "Invalid operational parameters. Type and content required." });
    }

    const currentUserId = session.user.id;

    // Create the secure relational document footprint
    const cardDocument = {
      id: crypto.randomUUID(),
      userId: currentUserId, // Pins this entity record directly to their user account database profile
      type,
      content,
      timestamp: new Date().toISOString()
    };

    if (!db) {
      return res.status(503).json({ error: "Database service temporarily offline." });
    }

    // Direct insertion transaction into MongoDB collection "cards"
    const cardsCollection = db.collection("cards");
    await cardsCollection.insertOne(cardDocument);

    console.log(`🚀 Atlas DB Connected: Mounted new [${type.toUpperCase()}] card to user account [${currentUserId}]`);
    return res.status(201).json(cardDocument);
  } catch (error) {
    console.error("Database save anomaly:", error);
    return res.status(500).json({ error: "Failed to securely write configuration data metrics." });
  }
});

if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`🚀 DevDeck Backend server running at http://localhost:${PORT}`);
  });
} else {
  console.log("DevDeck Backend loaded in Serverless Production Mode.");
}

export default app;