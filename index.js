// CRITICAL: Initialize environment variables before importing anything else
import "dotenv/config"; 
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import crypto from "crypto";
import { MongoClient, ObjectId } from "mongodb"; // Import native MongoDB driver and utility tools

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
   USER-ISOLATED MONGODB ACCOUNT DATA PORTS (CRUD MATRICES)
   ========================================================================== */

// GET Endpoint: Stream cards belonging ONLY to the logged-in user account session
app.get("/api/cards", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    const cardsCollection = db.collection("cards");
    const workspaceCards = await cardsCollection
      .find({ userId: currentUserId })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json(workspaceCards);
  } catch (error) {
    console.error("Database read anomaly:", error);
    return res.status(500).json({ error: "Failed to stream user workspace profiles." });
  }
});

// POST Endpoint: Commit rich card documents mapped explicitly to individual account identities
app.post("/api/cards", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Operation aborted. Unauthenticated session layer." });
    }

    const { title, type, category, tags, metadata } = req.body;
    
    // Strict schema field validation
    if (!title || !type || !category) {
      return res.status(400).json({ error: "Invalid operational parameters. Title, type, and category required." });
    }

    const allowedTypes = ['Resource Link', 'GitHub Repository', 'Snippet', 'Markdown Note', 'API Endpoint', 'Project Idea'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid card type. Must be one of: ${allowedTypes.join(', ')}` });
    }

    const currentUserId = session.user.id;

    // Structuring native Mongo document tracking to fully capture custom fields
    const cardDocument = {
      _id: new ObjectId(), // Generates standard primary key natively
      id: crypto.randomUUID(), // Secondary layout identifier for backward layout systems
      userId: currentUserId,
      title,
      type,
      category,
      isBookmarked: false, // Defaults to un-bookmarked on creation initialization
      tags: Array.isArray(tags) ? tags : [],
      metadata: {
        url: metadata?.url || "",
        description: metadata?.description || "",
        language: metadata?.language || "",
        stars: Number(metadata?.stars) || 0,
        code: metadata?.code || "",
        httpMethod: metadata?.httpMethod || "",
        status: metadata?.status || "Draft" // Default mapping status for tracking parameters
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    const cardsCollection = db.collection("cards");
    await cardsCollection.insertOne(cardDocument);

    console.log(`🚀 Atlas DB Connected: Mounted new [${type.toUpperCase()}] card to user account [${currentUserId}]`);
    return res.status(201).json(cardDocument);
  } catch (error) {
    console.error("Database save anomaly:", error);
    return res.status(500).json({ error: "Failed to securely write configuration data metrics." });
  }
});



// GET Endpoint: Stream exclusively bookmarked configuration items
app.get("/api/cards/bookmarks", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    const cardsCollection = db.collection("cards");
    const bookmarkedCards = await cardsCollection
      .find({ userId: currentUserId, isBookmarked: true })
      .sort({ updatedAt: -1 })
      .toArray();

    return res.status(200).json(bookmarkedCards);
  } catch (error) {
    console.error("Bookmark data stream anomaly:", error);
    return res.status(500).json({ error: "Failed to fetch bookmarked workspace profiles." });
  }
});

// PATCH Endpoint: Atomic state toggles for individual system layouts
app.patch("/api/cards/:id/bookmark", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Operation aborted. Unauthenticated session layer." });
    }

    const currentUserId = session.user.id;
    const cardId = req.params.id;
    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    const cardsCollection = db.collection("cards");

    // Dynamic fallback checking allowing resource isolation mapping across query variants
    let query = { userId: currentUserId };
    if (ObjectId.isValid(cardId)) {
      query._id = new ObjectId(cardId);
    } else {
      query.id = cardId;
    }

    const targetCard = await cardsCollection.findOne(query);
    if (!targetCard) {
      return res.status(404).json({ error: "Workspace card matching constraints not found." });
    }

    // Toggle logic update operation execution state cleanly
    const nextBookmarkState = !targetCard.isBookmarked;
    await cardsCollection.updateOne(
      query,
      { 
        $set: { 
          isBookmarked: nextBookmarkState,
          updatedAt: new Date()
        } 
      }
    );

    // Capture response footprint cleanly for immediate local cache synchronization layouts
    const updatedCard = { ...targetCard, isBookmarked: nextBookmarkState, updatedAt: new Date() };
    
    console.log(`✨ System Metric Shift: Toggled card [${cardId}] bookmark status setting to -> ${nextBookmarkState}`);
    return res.status(200).json(updatedCard);
  } catch (error) {
    console.error("Bookmark atomic transactional state update crash:", error);
    return res.status(500).json({ error: "Failed to process target workspace updates safely." });
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