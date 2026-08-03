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
   USER-ISOLATED MONGODB ACCOUNT DATA PORTS (CARDS CRUD MATRICES)
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

    const { title, type, category, tags, metadata, content } = req.body;
    
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
      content: content || {},
      metadata: {
        url: metadata?.url || content?.url || content?.repoUrl || "",
        description: metadata?.description || content?.notes || "",
        language: metadata?.language || content?.language || "",
        stars: Number(metadata?.stars) || 0,
        code: metadata?.code || content?.code || "",
        httpMethod: metadata?.httpMethod || content?.method || "",
        status: metadata?.status || "Draft" 
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

// DELETE Endpoint: Remove a specific card belonging to the user
app.delete("/api/cards/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const cardId = req.params.id;

    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    const cardsCollection = db.collection("cards");

    // Match either by ObjectId _id or string id
    let query = { userId: currentUserId };
    if (ObjectId.isValid(cardId)) {
      query._id = new ObjectId(cardId);
    } else {
      query.id = cardId;
    }

    const deleteResult = await cardsCollection.deleteOne(query);

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: "Target card not found or unauthorized." });
    }

    console.log(`🗑️ Atlas DB: Purged card [${cardId}] for user [${currentUserId}]`);
    return res.status(200).json({ message: "Card deleted successfully", cardId });
  } catch (error) {
    console.error("Database delete anomaly:", error);
    return res.status(500).json({ error: "Failed to delete target workspace card." });
  }
});

// PUT Endpoint: Update an existing card
app.put("/api/cards/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const cardId = req.params.id;
    const { title, content, tags, metadata } = req.body;

    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    const cardsCollection = db.collection("cards");

    let query = { userId: currentUserId };
    if (ObjectId.isValid(cardId)) {
      query._id = new ObjectId(cardId);
    } else {
      query.id = cardId;
    }

    const updateFields = {
      updatedAt: new Date(),
    };

    if (title) updateFields.title = title;
    if (content) updateFields.content = content;
    if (tags) updateFields.tags = tags;
    if (metadata) updateFields.metadata = metadata;

    const result = await cardsCollection.findOneAndUpdate(
      query,
      { $set: updateFields },
      { returnDocument: "after" }
    );

    if (!result) {
      return res.status(404).json({ error: "Card not found or unauthorized." });
    }

    console.log(`✏️ Atlas DB: Updated card [${cardId}] for user [${currentUserId}]`);
    return res.status(200).json(result);
  } catch (error) {
    console.error("Database update anomaly:", error);
    return res.status(500).json({ error: "Failed to update workspace card." });
  }
});

// GET Endpoint: Stream exclusively bookmarked items from BOTH cards and snippets collections
app.get("/api/cards/bookmarks", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    // 1. Fetch bookmarked items from "cards" collection
    const cardsCollection = db.collection("cards");
    const bookmarkedCards = await cardsCollection
      .find({ userId: currentUserId, isBookmarked: true })
      .toArray();

    // 2. Fetch bookmarked items from "snippets" collection
    const snippetsCollection = db.collection("snippets");
    const bookmarkedSnippets = await snippetsCollection
      .find({ userId: currentUserId, bookmarked: true })
      .toArray();

    // Format snippets into standard card objects so the Bookmarks UI renders them seamlessly
    const formattedSnippets = bookmarkedSnippets.map((s) => ({
      _id: s._id,
      id: s._id.toString(),
      userId: s.userId,
      title: s.title || "Untitled Snippet",
      type: "Snippet",
      category: "snippets",
      isBookmarked: true,
      bookmarked: true,
      tags: Array.isArray(s.tags) ? s.tags : [],
      code: s.code || "",
      language: s.language || "javascript",
      description: s.description || "",
      metadata: {
        description: s.description || "",
        language: s.language || "javascript",
        code: s.code || ""
      },
      createdAt: s.createdAt || new Date(),
      updatedAt: s.updatedAt || new Date()
    }));

    // Deduplicate merged items by string ID
    const unifiedMap = new Map();

    bookmarkedCards.forEach((item) => {
      const idKey = (item._id || item.id)?.toString();
      if (idKey) unifiedMap.set(idKey, item);
    });

    formattedSnippets.forEach((item) => {
      const idKey = (item._id || item.id)?.toString();
      if (idKey) unifiedMap.set(idKey, item);
    });

    const combinedBookmarks = Array.from(unifiedMap.values()).sort(
      (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );

    return res.status(200).json(combinedBookmarks);
  } catch (error) {
    console.error("Bookmark data stream anomaly:", error);
    return res.status(500).json({ error: "Failed to fetch bookmarked workspace profiles." });
  }
});

// PATCH Endpoint: Atomic state toggles for individual system layouts (Cards)
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

    const updatedCard = { ...targetCard, isBookmarked: nextBookmarkState, updatedAt: new Date() };
    
    console.log(`✨ System Metric Shift: Toggled card [${cardId}] bookmark status setting to -> ${nextBookmarkState}`);
    return res.status(200).json(updatedCard);
  } catch (error) {
    console.error("Bookmark atomic transactional state update crash:", error);
    return res.status(500).json({ error: "Failed to process target workspace updates safely." });
  }
});

/* ==========================================================================
   USER-ISOLATED MONGODB SNIPPETS ENDPOINTS
   ========================================================================== */

// GET Endpoint: Fetch snippets from BOTH "snippets" and "cards" collections
app.get("/api/snippets", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    // 1. Fetch documents from dedicated "snippets" collection
    const snippetsCollection = db.collection("snippets");
    const userSnippets = await snippetsCollection
      .find({ userId: currentUserId })
      .toArray();

    // 2. Fetch cards with type "Snippet" or "snippets" from "cards" collection
    const cardsCollection = db.collection("cards");
    const snippetCards = await cardsCollection
      .find({ 
        userId: currentUserId, 
        type: { $in: ["Snippet", "snippets"] } 
      })
      .toArray();

    // Normalize snippet cards into the standard snippet object format
    const formattedCardsAsSnippets = snippetCards.map((card) => ({
      _id: card._id,
      id: card._id.toString(),
      userId: card.userId,
      title: card.title || card.content?.title || "Untitled Snippet",
      description: card.metadata?.description || card.content?.notes || card.content?.body || "",
      language: card.metadata?.language || card.content?.language || "javascript",
      tags: Array.isArray(card.tags) ? card.tags : [],
      code: card.metadata?.code || card.content?.code || "",
      bookmarked: card.isBookmarked || card.bookmarked || false,
      isBookmarked: card.isBookmarked || card.bookmarked || false,
      createdAt: card.createdAt || new Date(),
      source: "cards_collection"
    }));

    const formattedSnippets = userSnippets.map((doc) => ({
      ...doc,
      id: doc._id.toString(),
      isBookmarked: doc.bookmarked || doc.isBookmarked || false
    }));

    // Merge both arrays and sort by newest first
    const combinedSnippets = [...formattedCardsAsSnippets, ...formattedSnippets].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    return res.status(200).json(combinedSnippets);
  } catch (error) {
    console.error("Snippet read anomaly:", error);
    return res.status(500).json({ error: "Failed to stream user snippets." });
  }
});

// POST Endpoint: Save new snippet to MongoDB mapped to current user
app.post("/api/snippets", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Operation aborted. Unauthenticated session layer." });
    }

    const { title, description, language, tags, code } = req.body;

    if (!title || !code) {
      return res.status(400).json({ error: "Title and code are required." });
    }

    const currentUserId = session.user.id;
    const generatedObjectId = new ObjectId();

    const snippetDocument = {
      _id: generatedObjectId,
      id: generatedObjectId.toString(),
      userId: currentUserId,
      title,
      description: description || "",
      language: language || "javascript",
      tags: Array.isArray(tags) ? tags : [],
      code,
      bookmarked: false,
      isBookmarked: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    const snippetsCollection = db.collection("snippets");
    await snippetsCollection.insertOne(snippetDocument);

    console.log(`🚀 Atlas DB: Saved new snippet [${title}] for user [${currentUserId}]`);
    return res.status(201).json(snippetDocument);
  } catch (error) {
    console.error("Snippet save anomaly:", error);
    return res.status(500).json({ error: "Failed to save snippet document." });
  }
});

// PATCH Endpoint: Update snippet properties (e.g., toggle bookmark) across BOTH collections
app.patch("/api/snippets/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const snippetId = req.params.id;

    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    const snippetsCollection = db.collection("snippets");
    const cardsCollection = db.collection("cards");

    let query = { userId: currentUserId };
    if (ObjectId.isValid(snippetId)) {
      query._id = new ObjectId(snippetId);
    } else {
      query.id = snippetId;
    }

    // 1. Attempt update in dedicated "snippets" collection
    const updateFields = { updatedAt: new Date(), ...req.body };
    if (req.body.bookmarked !== undefined) {
      updateFields.isBookmarked = req.body.bookmarked;
    }

    let result = await snippetsCollection.findOneAndUpdate(
      query,
      { $set: updateFields },
      { returnDocument: "after" }
    );

    // 2. Fallback: If not found in "snippets", check and update in "cards" collection
    if (!result) {
      const cardUpdateFields = { updatedAt: new Date() };
      if (req.body.bookmarked !== undefined) {
        cardUpdateFields.isBookmarked = req.body.bookmarked;
        cardUpdateFields.bookmarked = req.body.bookmarked;
      }

      result = await cardsCollection.findOneAndUpdate(
        query,
        { $set: cardUpdateFields },
        { returnDocument: "after" }
      );
    }

    if (!result) {
      return res.status(404).json({ error: "Snippet or Card snippet not found or unauthorized." });
    }

    console.log(`✨ Atlas DB: Updated snippet/card snippet [${snippetId}] for user [${currentUserId}]`);
    return res.status(200).json(result);
  } catch (error) {
    console.error("Snippet patch anomaly:", error);
    return res.status(500).json({ error: "Failed to update target snippet." });
  }
});

// DELETE Endpoint: Remove a specific snippet belonging to the user across BOTH collections
app.delete("/api/snippets/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const snippetId = req.params.id;

    if (!db) return res.status(503).json({ error: "Database service temporarily offline." });

    const snippetsCollection = db.collection("snippets");
    const cardsCollection = db.collection("cards");

    let query = { userId: currentUserId };
    if (ObjectId.isValid(snippetId)) {
      query._id = new ObjectId(snippetId);
    } else {
      query.id = snippetId;
    }

    // 1. Try deleting from "snippets" collection
    let deleteResult = await snippetsCollection.deleteOne(query);

    // 2. Fallback: Try deleting from "cards" collection
    if (deleteResult.deletedCount === 0) {
      deleteResult = await cardsCollection.deleteOne(query);
    }

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: "Target snippet not found or unauthorized." });
    }

    console.log(`🗑️ Atlas DB: Purged snippet [${snippetId}] for user [${currentUserId}]`);
    return res.status(200).json({ message: "Snippet deleted successfully", snippetId });
  } catch (error) {
    console.error("Snippet delete anomaly:", error);
    return res.status(500).json({ error: "Failed to delete target snippet." });
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