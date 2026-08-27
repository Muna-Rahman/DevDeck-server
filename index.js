// Load environment variables before other imports
import "dotenv/config"; 
import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import { getDatabase } from "./db.js";

const app = express();
const PORT = process.env.PORT || 3001;

// MongoDB connections are handled centrally in db.js to share the client pool across routes and auth.

// CORS configuration for local development and deployed frontend URLs
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
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie"]
}));

// Better Auth handler must be mounted before express.json()
app.use("/api/auth", (req, res) => {
  return toNodeHandler(auth)(req, res);
});

app.use(express.json());

app.get("/", (req, res) => {
  res.send("DevDeck Server is running successfully.");
});

/* ==========================================================================
   USER PREFERENCES & SETTINGS
   ========================================================================== */

// Get current user settings (e.g. font size)
app.get("/api/user/settings", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const db = await getDatabase();
    const usersCollection = db.collection("user");

    let query = {};
    if (ObjectId.isValid(currentUserId)) {
      query._id = new ObjectId(currentUserId);
    } else {
      query.id = currentUserId;
    }

    const userDoc = await usersCollection.findOne(query);

    return res.status(200).json({
      fontSize: userDoc?.fontSize || "medium"
    });
  } catch (error) {
    console.error("Fetch settings anomaly:", error);
    return res.status(500).json({ error: "Failed to load account settings." });
  }
});

// Update user settings
app.put("/api/user/settings", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const { fontSize } = req.body;
    const currentUserId = session.user.id;
    const db = await getDatabase();
    const usersCollection = db.collection("user");

    const updateFields = { updatedAt: new Date() };
    if (fontSize) updateFields.fontSize = fontSize;

    let query = {};
    if (ObjectId.isValid(currentUserId)) {
      query._id = new ObjectId(currentUserId);
    } else {
      query.id = currentUserId;
    }

    await usersCollection.updateOne(query, { $set: updateFields });

    return res.status(200).json({ 
      message: "User preferences updated successfully", 
      fontSize 
    });
  } catch (error) {
    console.error("Update settings anomaly:", error);
    return res.status(500).json({ error: "Failed to update account preferences." });
  }
});

/* ==========================================================================
   CATEGORIES
   ========================================================================== */

// Fetch all custom categories created by the logged-in user
app.get("/api/categories", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const db = await getDatabase();

    const categories = await db
      .collection("categories")
      .find({ userId: currentUserId })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json(categories);
  } catch (error) {
    console.error("Database read anomaly:", error);
    return res.status(500).json({ error: "Failed to stream user category list." });
  }
});

// Create a new standalone category
app.post("/api/categories", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const { name } = req.body;
    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (!trimmedName) {
      return res.status(400).json({ error: "Category name is required." });
    }
    if (trimmedName.length > 60) {
      return res.status(400).json({ error: "Category name must be 60 characters or fewer." });
    }

    const currentUserId = session.user.id;
    const db = await getDatabase();
    const categoriesCollection = db.collection("categories");

    const nameLower = trimmedName.toLowerCase();
    const existing = await categoriesCollection.findOne({ userId: currentUserId, nameLower });
    if (existing) {
      return res.status(409).json({ error: "A category with this name already exists.", category: existing });
    }

    const categoryDocument = {
      _id: new ObjectId(),
      id: crypto.randomUUID(),
      userId: currentUserId,
      name: trimmedName,
      nameLower,
      createdAt: new Date(),
    };

    await categoriesCollection.insertOne(categoryDocument);

    return res.status(201).json(categoryDocument);
  } catch (error) {
    console.error("Database save anomaly:", error);
    return res.status(500).json({ error: "Failed to create category." });
  }
});

/* ==========================================================================
   AI ASSISTANT (Groq)
   Generates code from descriptions or summaries from code snippets.
   ========================================================================== */

app.post("/api/ai/generate", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(503).json({ error: "AI assistant is not configured on this server." });
    }

    const { mode, code, description, language } = req.body;

    if (mode !== "description" && mode !== "code") {
      return res.status(400).json({ error: "mode must be 'description' or 'code'." });
    }

    // Both directions are held to the same bar: a trivial/empty input on either
    // side produces a meaningless result on the other, so we validate them
    // identically instead of only checking "is it non-empty".
    const MIN_AI_INPUT_LENGTH = 10;

    let systemPrompt;
    let userPrompt;

    if (mode === "description") {
      const trimmedCode = (code || "").trim();
      if (!trimmedCode) {
        return res.status(400).json({ error: "Code is required to generate a description." });
      }
      if (trimmedCode.length < MIN_AI_INPUT_LENGTH) {
        return res.status(400).json({
          error: `Please provide at least ${MIN_AI_INPUT_LENGTH} characters of code so a valid description can be generated.`
        });
      }
      systemPrompt =
        "You are a precise technical writer. Given a code snippet, write a single short, " +
        "plain-language description of what it does, in 1-2 sentences on ONE line with no " +
        "line breaks, no markdown, and no preamble like 'This code...' — just the explanation itself. " +
        "If the snippet is too incomplete or malformed to describe accurately, say so in one short " +
        "sentence instead of guessing.";
      userPrompt = `Language: ${language || "unspecified"}\n\nCode:\n${trimmedCode.slice(0, 6000)}`;
    } else {
      const trimmedDescription = (description || "").trim();
      if (!trimmedDescription) {
        return res.status(400).json({ error: "A description is required to generate code." });
      }
      if (trimmedDescription.length < MIN_AI_INPUT_LENGTH) {
        return res.status(400).json({
          error: `Please provide at least ${MIN_AI_INPUT_LENGTH} characters describing what you want so valid code can be generated.`
        });
      }
      systemPrompt =
        `You are a precise code generator. Given a plain-language description, write clean, ` +
        `working ${language || ""} code that fulfills it. Respond with ONLY the raw code — no ` +
        `markdown fences, no explanation before or after, just the code itself (normal inline ` +
        `code comments are fine). If the description is too vague or contradictory to produce ` +
        `correct code, respond with a single-line comment explaining what's missing instead of ` +
        `inventing unrelated code.`;
      userPrompt = trimmedDescription.slice(0, 2000);
    }

    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        max_tokens: mode === "description" ? 220 : 1024,
      }),
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text().catch(() => "");
      console.error("Groq API error:", groqResponse.status, errText);
      return res.status(502).json({ error: "AI generation failed. Please try again." });
    }

    const groqData = await groqResponse.json();
    let result = groqData.choices?.[0]?.message?.content?.trim() || "";

    if (mode === "code") {
      // Remove accidental markdown fences if returned by the model
      result = result.replace(/^```[\w-]*\n?/, "").replace(/\n?```$/, "").trim();
    } else {
      // Keep descriptions on a single line for UI inputs
      result = result.replace(/\s*\n+\s*/g, " ").trim();
    }

    if (!result) {
      return res.status(502).json({ error: "AI returned an empty response. Please try again." });
    }

    return res.status(200).json({ result });
  } catch (error) {
    console.error("AI generation anomaly:", error);
    return res.status(500).json({ error: "Failed to process AI generation request." });
  }
});

/* ==========================================================================
   CARDS CRUD
   ========================================================================== */

// Get cards for the authenticated user
app.get("/api/cards", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const db = await getDatabase();

    const cardsCollection = db.collection("cards");
    const workspaceCards = await cardsCollection
      .find({ userId: currentUserId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    return res.status(200).json(workspaceCards);
  } catch (error) {
    console.error("Database read anomaly:", error);
    return res.status(500).json({ error: "Failed to stream user workspace profiles." });
  }
});

// Create a new card
app.post("/api/cards", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Operation aborted. Unauthenticated session layer." });
    }

    const { title, type, category, tags, metadata, content, clientRequestId } = req.body;
    
    if (!title || !type || !category) {
      return res.status(400).json({ error: "Invalid operational parameters. Title, type, and category required." });
    }

    const allowedTypes = ['Resource Link', 'GitHub Repository', 'Snippet', 'Markdown Note', 'API Endpoint', 'Project Idea'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid card type. Must be one of: ${allowedTypes.join(', ')}` });
    }

    const currentUserId = session.user.id;
    const db = await getDatabase();
    const cardsCollection = db.collection("cards");

    const resolvedMetadata = {
      url: metadata?.url || content?.url || content?.repoUrl || "",
      description: metadata?.description || content?.notes || "",
      language: metadata?.language || content?.language || "",
      stars: Number(metadata?.stars) || 0,
      code: metadata?.code || content?.code || "",
      httpMethod: metadata?.httpMethod || content?.method || "",
      status: metadata?.status || "Draft"
    };

    const cardDocument = {
      _id: new ObjectId(),
      id: crypto.randomUUID(),
      userId: currentUserId,
      title,
      type,
      category,
      isBookmarked: false,
      tags: Array.isArray(tags) ? tags : [],
      content: content || {},
      metadata: resolvedMetadata,
      // Set by the client once per "compose" session (e.g. once per modal
      // open) and resent unchanged on retries — this is what actually makes
      // duplicate prevention safe, since it's enforced by a unique index in
      // MongoDB rather than a check-then-insert that can race.
      clientRequestId: clientRequestId || undefined,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      await cardsCollection.insertOne(cardDocument);
      return res.status(201).json(cardDocument);
    } catch (insertError) {
      // E11000 on clientRequestId means this exact submission already went
      // through (double-click, retry, race) — hand back the original
      // instead of erroring or silently creating a second copy.
      if (insertError?.code === 11000 && clientRequestId) {
        const original = await cardsCollection.findOne({ userId: currentUserId, clientRequestId });
        if (original) {
          return res.status(200).json(original);
        }
      }
      throw insertError;
    }
  } catch (error) {
    console.error("Database save anomaly:", error);
    return res.status(500).json({ error: "Failed to securely write configuration data metrics." });
  }
});

// Delete a user's card by ID
app.delete("/api/cards/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const cardId = req.params.id;
    const db = await getDatabase();

    const cardsCollection = db.collection("cards");

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

    return res.status(200).json({ message: "Card deleted successfully", cardId });
  } catch (error) {
    console.error("Database delete anomaly:", error);
    return res.status(500).json({ error: "Failed to delete target workspace card." });
  }
});

// Update an existing card
app.put("/api/cards/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const cardId = req.params.id;
    const { title, content, tags, metadata } = req.body;
    const db = await getDatabase();

    const cardsCollection = db.collection("cards");

    let query = { userId: currentUserId };
    if (ObjectId.isValid(cardId)) {
      query._id = new ObjectId(cardId);
    } else {
      query.id = cardId;
    }

    const updateFields = { updatedAt: new Date() };
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

    return res.status(200).json(result);
  } catch (error) {
    console.error("Database update anomaly:", error);
    return res.status(500).json({ error: "Failed to update workspace card." });
  }
});

// Fetch all bookmarked cards and snippets together
app.get("/api/cards/bookmarks", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const db = await getDatabase();

    const cardsCollection = db.collection("cards");
    const snippetsCollection = db.collection("snippets");

    // Fetch bookmarks across both collections in parallel
    const [bookmarkedCards, bookmarkedSnippets] = await Promise.all([
      cardsCollection.find({ userId: currentUserId, isBookmarked: true }).toArray(),
      snippetsCollection.find({ userId: currentUserId, bookmarked: true }).toArray()
    ]);

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

    const unifiedMap = new Map();
    bookmarkedCards.forEach((item) => unifiedMap.set((item._id || item.id).toString(), item));
    formattedSnippets.forEach((item) => unifiedMap.set((item._id || item.id).toString(), item));

    const combinedBookmarks = Array.from(unifiedMap.values()).sort(
      (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );

    return res.status(200).json(combinedBookmarks);
  } catch (error) {
    console.error("Bookmark data stream anomaly:", error);
    return res.status(500).json({ error: "Failed to fetch bookmarked workspace profiles." });
  }
});

// Toggle bookmark state on a card
app.patch("/api/cards/:id/bookmark", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Operation aborted. Unauthenticated session layer." });
    }

    const currentUserId = session.user.id;
    const cardId = req.params.id;
    const db = await getDatabase();

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

    return res.status(200).json({ ...targetCard, isBookmarked: nextBookmarkState, updatedAt: new Date() });
  } catch (error) {
    console.error("Bookmark atomic update crash:", error);
    return res.status(500).json({ error: "Failed to process target workspace updates safely." });
  }
});

/* ==========================================================================
   SNIPPETS CRUD
   ========================================================================== */

// Fetch all snippets (from both the snippets collection and snippet-type cards)
app.get("/api/snippets", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const db = await getDatabase();

    const snippetsCollection = db.collection("snippets");
    const cardsCollection = db.collection("cards");

    // Query both collections in parallel
    const [userSnippets, snippetCards] = await Promise.all([
      snippetsCollection.find({ userId: currentUserId }).toArray(),
      cardsCollection.find({ userId: currentUserId, type: { $in: ["Snippet", "snippets"] } }).toArray()
    ]);

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

    const combinedSnippets = [...formattedCardsAsSnippets, ...formattedSnippets].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    return res.status(200).json(combinedSnippets);
  } catch (error) {
    console.error("Snippet read anomaly:", error);
    return res.status(500).json({ error: "Failed to stream user snippets." });
  }
});

// Create a new snippet
app.post("/api/snippets", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Operation aborted. Unauthenticated session layer." });
    }

    const { title, description, language, tags, code, clientRequestId } = req.body;
    if (!title || !code) {
      return res.status(400).json({ error: "Title and code are required." });
    }

    const currentUserId = session.user.id;
    const db = await getDatabase();
    const snippetsCollection = db.collection("snippets");

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
      // Set once per "compose" session on the client and resent unchanged on
      // retries. A unique index on this field is what actually prevents
      // duplicate saves atomically — see cards route for the same pattern.
      clientRequestId: clientRequestId || undefined,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      await snippetsCollection.insertOne(snippetDocument);
      return res.status(201).json(snippetDocument);
    } catch (insertError) {
      if (insertError?.code === 11000 && clientRequestId) {
        const original = await snippetsCollection.findOne({ userId: currentUserId, clientRequestId });
        if (original) {
          return res.status(200).json(original);
        }
      }
      throw insertError;
    }
  } catch (error) {
    console.error("Snippet save anomaly:", error);
    return res.status(500).json({ error: "Failed to save snippet document." });
  }
});

// Update a snippet (falls back to checking cards if not in snippets collection)
app.patch("/api/snippets/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const snippetId = req.params.id;
    const db = await getDatabase();

    const snippetsCollection = db.collection("snippets");
    const cardsCollection = db.collection("cards");

    let query = { userId: currentUserId };
    if (ObjectId.isValid(snippetId)) {
      query._id = new ObjectId(snippetId);
    } else {
      query.id = snippetId;
    }

    const updateFields = { updatedAt: new Date(), ...req.body };
    if (req.body.bookmarked !== undefined) {
      updateFields.isBookmarked = req.body.bookmarked;
    }

    let result = await snippetsCollection.findOneAndUpdate(
      query,
      { $set: updateFields },
      { returnDocument: "after" }
    );

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

    return res.status(200).json(result);
  } catch (error) {
    console.error("Snippet patch anomaly:", error);
    return res.status(500).json({ error: "Failed to update target snippet." });
  }
});

// Delete a snippet (checks snippets collection first, then cards collection)
app.delete("/api/snippets/:id", async (req, res) => {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session || !session.user) {
      return res.status(401).json({ error: "Unauthorized access parameters. Please sign in." });
    }

    const currentUserId = session.user.id;
    const snippetId = req.params.id;
    const db = await getDatabase();

    const snippetsCollection = db.collection("snippets");
    const cardsCollection = db.collection("cards");

    let query = { userId: currentUserId };
    if (ObjectId.isValid(snippetId)) {
      query._id = new ObjectId(snippetId);
    } else {
      query.id = snippetId;
    }

    let deleteResult = await snippetsCollection.deleteOne(query);

    if (deleteResult.deletedCount === 0) {
      deleteResult = await cardsCollection.deleteOne(query);
    }

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ error: "Target snippet not found or unauthorized." });
    }

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