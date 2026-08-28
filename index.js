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

// Database connection logic lives in db.js so we can share a single pool across routes and auth.

// Set up CORS to allow requests from our frontend apps and local testing environments
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

// Mount Better Auth handler before express.json() parses request bodies
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

// Fetch preferences for the currently logged-in user (e.g. fontSize)
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

//CATEGORIES
  

// Get all custom categories created by this user
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

// Create a new category
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

//AI ASSISTANT (Groq)
 

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

    // Make sure the user provides enough text so we don't waste tokens on empty prompts.
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
        "You're a technical writer. Read the code snippet and write a clear, " +
        "concise explanation of what it does in 1-2 sentences. Keep it on ONE line, " +
        "no markdown, no line breaks, and skip filler phrases like 'This code...'. " +
        "If the code is too messy or incomplete to figure out, just mention that " +
        "in a short sentence instead of guessing.";
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
        `You're a handy coder. Based on the description, write clean and working ` +
        `${language || ""} code. Return ONLY the raw code — no markdown fences, ` +
        `no explanations, just the code itself (inline comments are totally fine). ` +
        `If the instructions don't make sense or are too vague, just leave a single-line ` +
        `comment explaining what's missing instead of inventing random code.`;
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
      // Clean up any markdown code blocks the AI might have accidentally included
      result = result.replace(/^```[\w-]*\n?/, "").replace(/\n?```$/, "").trim();
    } else {
      // Keep descriptions neatly formatted on a single line
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
   CONTENT VALIDATION HELPERS
   Server-side checks to catch broken links, bad URLs, or empty code
   even if the frontend validation somehow gets bypassed.
   ========================================================================== */

// Helper to check if a string is a proper http or https URL
function isValidHttpUrl(candidate) {
  if (!candidate || typeof candidate !== "string") return false;
  try {
    const parsed = new URL(candidate.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Helper to ensure the link points to a real GitHub repository (github.com/owner/repo)
function isValidGithubRepoUrl(candidate) {
  if (!isValidHttpUrl(candidate)) return false;
  try {
    const { hostname, pathname } = new URL(candidate.trim());
    const host = hostname.toLowerCase();
    if (host !== "github.com" && host !== "www.github.com") return false;
    // Make sure there's at least an owner and a repo name in the path
    return pathname.split("/").filter(Boolean).length >= 2;
  } catch {
    return false;
  }
}

function isNonEmptyCode(candidate) {
  return typeof candidate === "string" && candidate.trim().length > 0;
}

// Validates card content based on its type and returns an error message if something's wrong
function validateCardContent(type, content, metadata) {
  const url = (metadata?.url || content?.url || content?.repoUrl || "").trim();
  const code = metadata?.code || content?.code || "";

  switch (type) {
    case "Resource Link":
      if (!isValidHttpUrl(url)) return "That URL doesn't look valid. It must start with http:// or https://.";
      return null;
    case "GitHub Repository":
      if (!isValidGithubRepoUrl(url)) return "That doesn't look like a valid GitHub repository URL (expected https://github.com/owner/repo).";
      return null;
    case "Snippet":
      if (!isNonEmptyCode(code)) return "Snippet code can't be empty.";
      return null;
    case "API Endpoint": {
      const apiUrl = (metadata?.url || content?.url || content?.apiUrl || "").trim();
      if (!isValidHttpUrl(apiUrl)) return "That API endpoint URL doesn't look valid. It must start with http:// or https://.";
      return null;
    }
    default:
      return null;
  }
}

/* ==========================================================================
   CONTENT DEDUPLICATION HELPERS
   Checks the actual content of cards (like code or URLs) to prevent duplicates,
   ignoring minor edits to titles or descriptions.
   ========================================================================== */

// Sort object keys so their order doesn't mess up our hash generation
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

// Pull out the core identifying details depending on what type of card it is.
// Note: Project ideas use titles/summaries since they don't have code or URLs.
function getCardIdentityContent(type, content, metadata) {
  switch (type) {
    case "Resource Link":
      return (metadata?.url || content?.url || "").trim().toLowerCase();
    case "GitHub Repository":
      return (metadata?.url || content?.repoUrl || content?.url || "").trim().toLowerCase();
    case "Snippet":
      return [
        (metadata?.code || content?.code || "").trim(),
        (metadata?.language || content?.language || "").trim().toLowerCase()
      ].join("::");
    case "API Endpoint":
      return [
        (metadata?.url || content?.url || "").trim().toLowerCase(),
        (metadata?.httpMethod || content?.method || "").trim().toUpperCase()
      ].join("::");
    case "Markdown Note":
      return (content?.body || content?.notes || "").trim();
    case "Project Idea":
      return (content?.body || content?.notes || content?.summary || content?.title || "").trim();
    default:
      return stableStringify(content || {});
  }
}

// Create a unique hash for the card based on user, type, category, and its core content.
function computeCardContentHash({ userId, type, category, content, metadata }) {
  const signature = [userId, type, category || "", getCardIdentityContent(type, content, metadata)].join("::");
  return crypto.createHash("sha256").update(signature).digest("hex");
}

// Hash standalone snippets using just their language and code body
function computeSnippetContentHash({ userId, language, code }) {
  const signature = [
    userId,
    (language || "javascript").trim().toLowerCase(),
    (code || "").trim()
  ].join("::");
  return crypto.createHash("sha256").update(signature).digest("hex");
}

// Snippets can be saved either from the Cards page (stored in the `cards` collection)
// or the Snippets page 
async function findCrossCollectionSnippetDuplicate(db, { userId, language, code, excludeCardId, excludeSnippetId }) {
  const normalizedCode = (code || "").trim();
  if (!normalizedCode) return null;
  const normalizedLanguage = (language || "javascript").trim().toLowerCase();

  const cardsCollection = db.collection("cards");
  const snippetsCollection = db.collection("snippets");

  const [snippetCards, standaloneSnippets] = await Promise.all([
    cardsCollection.find({ userId, type: { $in: ["Snippet", "snippets"] } }).toArray(),
    snippetsCollection.find({ userId }).toArray()
  ]);

  const cardMatch = snippetCards.find((c) => {
    if (excludeCardId && c._id.toString() === excludeCardId.toString()) return false;
    const cCode = (c.content?.code || c.metadata?.code || "").trim();
    const cLang = (c.content?.language || c.metadata?.language || "javascript").trim().toLowerCase();
    return cCode === normalizedCode && cLang === normalizedLanguage;
  });
  if (cardMatch) return { collection: "cards", document: cardMatch };

  const snippetMatch = standaloneSnippets.find((s) => {
    if (excludeSnippetId && s._id.toString() === excludeSnippetId.toString()) return false;
    const sCode = (s.code || "").trim();
    const sLang = (s.language || "javascript").trim().toLowerCase();
    return sCode === normalizedCode && sLang === normalizedLanguage;
  });
  if (snippetMatch) return { collection: "snippets", document: snippetMatch };

  return null;
}

   //CARDS CRUD
  

// Fetch the authenticated user's recent cards
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

    const contentError = validateCardContent(type, content, metadata);
    if (contentError) {
      return res.status(400).json({ error: contentError });
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
      // Standardize auth requirements into metadata so drawers render properly on the frontend
      auth: Array.isArray(metadata?.auth) ? metadata.auth : (Array.isArray(content?.auth) ? content.auth : []),
      // Preserve status (like Draft or In Progress) from either content or metadata
      status: metadata?.status || content?.status || "Draft"
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
      // clientRequestId helps catch double clicks; contentHash prevents exact duplicate cards
      clientRequestId: clientRequestId || undefined,
      contentHash: computeCardContentHash({
        userId: currentUserId,
        type,
        category,
        content,
        metadata: resolvedMetadata
      }),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Check for duplicates beforehand. If the same clientRequestId comes in,
    // it's just a network retry, so we safely return the existing card.
    // If it's a new request with identical content, we block it.
    if (clientRequestId) {
      const existingByRequest = await cardsCollection.findOne({ userId: currentUserId, clientRequestId });
      if (existingByRequest) {
        return res.status(200).json(existingByRequest);
      }
    }

    // If it's a snippet, make sure it doesn't already exist over in the standalone snippets collection
    if (type === "Snippet") {
      const crossDup = await findCrossCollectionSnippetDuplicate(db, {
        userId: currentUserId,
        language: resolvedMetadata.language,
        code: resolvedMetadata.code
      });
      if (crossDup) {
        return res.status(409).json({
          error: crossDup.collection === "snippets"
            ? "A snippet with this exact code already exists in your Snippets."
            : "A card with this exact content already exists."
        });
      }
    }

    const existingByContent = await cardsCollection.findOne({
      userId: currentUserId,
      contentHash: cardDocument.contentHash
    });
    if (existingByContent) {
      return res.status(409).json({ error: "A card with this exact content already exists.", existingCardId: existingByContent._id });
    }

    try {
      await cardsCollection.insertOne(cardDocument);
      return res.status(201).json(cardDocument);
    } catch (insertError) {
      // Handle rare race conditions where two identical requests slip through together
      if (insertError?.code === 11000) {
        if (clientRequestId) {
          const existingByRequest = await cardsCollection.findOne({ userId: currentUserId, clientRequestId });
          if (existingByRequest) {
            return res.status(200).json(existingByRequest);
          }
        }
        return res.status(409).json({ error: "A card with this exact content already exists." });
      }
      throw insertError;
    }
  } catch (error) {
    console.error("Database save anomaly:", error);
    return res.status(500).json({ error: "Failed to securely write configuration data metrics." });
  }
});

// Delete a card
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

    // Validate the incoming changes against the existing card data
    let existingCard = null;
    let mergedContent;
    let mergedMetadata;
    if (content || metadata) {
      existingCard = await cardsCollection.findOne(query);
      if (!existingCard) {
        return res.status(404).json({ error: "Card not found or unauthorized." });
      }
      mergedContent = content ? { ...existingCard.content, ...content } : existingCard.content;
      mergedMetadata = metadata ? { ...existingCard.metadata, ...metadata } : existingCard.metadata;
      const contentError = validateCardContent(existingCard.type, mergedContent, mergedMetadata);
      if (contentError) {
        return res.status(400).json({ error: contentError });
      }
    }

    const updateFields = { updatedAt: new Date() };
    if (title) updateFields.title = title;
    if (content) updateFields.content = content;
    if (tags) updateFields.tags = tags;
    if (metadata) updateFields.metadata = metadata;

    // Recalculate the content hash so our duplicate detection stays accurate after editing
    if (existingCard) {
      updateFields.contentHash = computeCardContentHash({
        userId: currentUserId,
        type: existingCard.type,
        category: existingCard.category,
        content: mergedContent,
        metadata: mergedMetadata
      });

      // Block the update if it would turn this card into an exact duplicate of another existing card
      const duplicateOfAnother = await cardsCollection.findOne({
        userId: currentUserId,
        contentHash: updateFields.contentHash,
        _id: { $ne: existingCard._id }
      });
      if (duplicateOfAnother) {
        return res.status(409).json({ error: "Another card with this exact content already exists." });
      }

      // Also check against the standalone snippets collection if this is a snippet card
      if (existingCard.type === "Snippet" || existingCard.type === "snippets") {
        const crossDup = await findCrossCollectionSnippetDuplicate(db, {
          userId: currentUserId,
          language: mergedMetadata?.language || mergedContent?.language,
          code: mergedMetadata?.code || mergedContent?.code,
          excludeCardId: existingCard._id
        });
        if (crossDup) {
          return res.status(409).json({
            error: crossDup.collection === "snippets"
              ? "A snippet with this exact code already exists in your Snippets."
              : "Another card with this exact content already exists."
          });
        }
      }
    }

    let result;
    try {
      result = await cardsCollection.findOneAndUpdate(
        query,
        { $set: updateFields },
        { returnDocument: "after" }
      );
    } catch (updateError) {
      if (updateError?.code === 11000) {
        return res.status(409).json({ error: "Another card with this exact content already exists." });
      }
      throw updateError;
    }

    if (!result) {
      return res.status(404).json({ error: "Card not found or unauthorized." });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Database update anomaly:", error);
    return res.status(500).json({ error: "Failed to update workspace card." });
  }
});

// Fetch all bookmarked cards and snippets in a single combined list
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

    // Grab bookmarks from both collections at the same time
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

// Toggle bookmark status on a card
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

// Get all snippets (combines records from the snippets collection and snippet-type cards)
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

    // Query both snippet storage locations simultaneously
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
    if (!title || !title.trim() || !isNonEmptyCode(code)) {
      return res.status(400).json({ error: "Title and code are required." });
    }

    const currentUserId = session.user.id;
    const db = await getDatabase();
    const snippetsCollection = db.collection("snippets");

    const generatedObjectId = new ObjectId();
    // Hash the snippet using only the code and language (ignoring title edits)
    const contentHash = computeSnippetContentHash({
      userId: currentUserId,
      language,
      code
    });

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
      // clientRequestId catches accidental double clicks; contentHash prevents duplicate code blocks
      clientRequestId: clientRequestId || undefined,
      contentHash,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // If a request comes with a known clientRequestId, treat it as a safe retry and return the existing snippet.
    if (clientRequestId) {
      const existingByRequest = await snippetsCollection.findOne({ userId: currentUserId, clientRequestId });
      if (existingByRequest) {
        return res.status(200).json(existingByRequest);
      }
    }

    // Check if this code already exists as a snippet card in the cards collection
    const crossDup = await findCrossCollectionSnippetDuplicate(db, {
      userId: currentUserId,
      language,
      code
    });
    if (crossDup) {
      return res.status(409).json({
        error: crossDup.collection === "cards"
          ? "A card with this exact code already exists in your Cards."
          : "A snippet with this exact code already exists.",
        existingSnippetId: crossDup.document._id
      });
    }

    const existingByContent = await snippetsCollection.findOne({
      userId: currentUserId,
      contentHash
    });
    if (existingByContent) {
      return res.status(409).json({ error: "A snippet with this exact code already exists.", existingSnippetId: existingByContent._id });
    }

    try {
      await snippetsCollection.insertOne(snippetDocument);
      return res.status(201).json(snippetDocument);
    } catch (insertError) {
      if (insertError?.code === 11000) {
        if (clientRequestId) {
          const existingByRequest = await snippetsCollection.findOne({ userId: currentUserId, clientRequestId });
          if (existingByRequest) {
            return res.status(200).json(existingByRequest);
          }
        }
        return res.status(409).json({ error: "A snippet with this exact code already exists." });
      }
      throw insertError;
    }
  } catch (error) {
    console.error("Snippet save anomaly:", error);
    return res.status(500).json({ error: "Failed to save snippet document." });
  }
});

// Update a snippet (falls back to checking cards if not found in the snippets collection)
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

    const { title, content, metadata, tags, bookmarked } = req.body;

    // Extract fields whether they come from simple form inputs or drawer payloads
    const resolvedTitle = title;
    const resolvedDescription =
      req.body.description !== undefined
        ? req.body.description
        : (content?.description ?? content?.notes ?? metadata?.description);
    const resolvedCode =
      req.body.code !== undefined ? req.body.code : (content?.code ?? metadata?.code);
    const resolvedLanguage =
      req.body.language !== undefined ? req.body.language : (content?.language ?? metadata?.language);

    if (resolvedCode !== undefined && !isNonEmptyCode(resolvedCode)) {
      return res.status(400).json({ error: "Snippet code can't be empty." });
    }
    if (resolvedTitle !== undefined && !resolvedTitle.trim()) {
      return res.status(400).json({ error: "Snippet title can't be empty." });
    }

    // Fetch existing snippet so we can merge partial updates and recalculate hashes properly
    let existingSnippet = null;
    if (resolvedCode !== undefined || resolvedLanguage !== undefined) {
      existingSnippet = await snippetsCollection.findOne(query);
    }

    // Build update fields carefully to avoid overwriting immutable fields like _id
    const updateFields = { updatedAt: new Date() };
    if (resolvedTitle !== undefined) updateFields.title = resolvedTitle;
    if (resolvedDescription !== undefined) updateFields.description = resolvedDescription;
    if (resolvedCode !== undefined) updateFields.code = resolvedCode;
    if (resolvedLanguage !== undefined) updateFields.language = resolvedLanguage;
    if (Array.isArray(tags)) updateFields.tags = tags;
    if (bookmarked !== undefined) {
      updateFields.bookmarked = bookmarked;
      updateFields.isBookmarked = bookmarked;
    }

    // Update the content hash so duplicate checks stay accurate
    if (existingSnippet) {
      updateFields.contentHash = computeSnippetContentHash({
        userId: currentUserId,
        language: resolvedLanguage !== undefined ? resolvedLanguage : existingSnippet.language,
        code: resolvedCode !== undefined ? resolvedCode : existingSnippet.code
      });

      // Prevent edits that would make this snippet a duplicate of another snippet
      const duplicateOfAnother = await snippetsCollection.findOne({
        userId: currentUserId,
        contentHash: updateFields.contentHash,
        _id: { $ne: existingSnippet._id }
      });
      if (duplicateOfAnother) {
        return res.status(409).json({ error: "Another snippet with this exact code already exists." });
      }

      // Check against cards collection as well to avoid cross-collection duplicates
      const crossDup = await findCrossCollectionSnippetDuplicate(db, {
        userId: currentUserId,
        language: resolvedLanguage !== undefined ? resolvedLanguage : existingSnippet.language,
        code: resolvedCode !== undefined ? resolvedCode : existingSnippet.code,
        excludeSnippetId: existingSnippet._id
      });
      if (crossDup) {
        return res.status(409).json({ error: "A card with this exact code already exists in your Cards." });
      }
    }

    let result;
    try {
      result = await snippetsCollection.findOneAndUpdate(
        query,
        { $set: updateFields },
        { returnDocument: "after" }
      );
    } catch (updateError) {
      if (updateError?.code === 11000) {
        return res.status(409).json({ error: "Another snippet with this exact code already exists." });
      }
      throw updateError;
    }

    if (!result) {
      // If it's not in the snippets collection, check if it's a snippet stored inside the cards collection
      const existingCard =
        resolvedTitle !== undefined || resolvedDescription !== undefined || resolvedCode !== undefined || resolvedLanguage !== undefined
          ? await cardsCollection.findOne(query)
          : null;

      const cardUpdateFields = { updatedAt: new Date() };
      if (resolvedTitle !== undefined) cardUpdateFields.title = resolvedTitle;
      let mergedCardContent;
      let mergedCardMetadata;
      if (resolvedDescription !== undefined || resolvedCode !== undefined || resolvedLanguage !== undefined) {
        mergedCardContent = {
          ...(existingCard?.content || content || {}),
          ...(resolvedDescription !== undefined ? { notes: resolvedDescription, description: resolvedDescription } : {}),
          ...(resolvedCode !== undefined ? { code: resolvedCode } : {}),
          ...(resolvedLanguage !== undefined ? { language: resolvedLanguage } : {}),
        };
        mergedCardMetadata = {
          ...(existingCard?.metadata || metadata || {}),
          ...(resolvedDescription !== undefined ? { description: resolvedDescription } : {}),
          ...(resolvedCode !== undefined ? { code: resolvedCode } : {}),
          ...(resolvedLanguage !== undefined ? { language: resolvedLanguage } : {}),
        };
        cardUpdateFields.content = mergedCardContent;
        cardUpdateFields.metadata = mergedCardMetadata;
      }
      if (Array.isArray(tags)) cardUpdateFields.tags = tags;
      if (bookmarked !== undefined) {
        cardUpdateFields.isBookmarked = bookmarked;
        cardUpdateFields.bookmarked = bookmarked;
      }

      // Keep the card's content hash synchronized as well
      if (existingCard && (mergedCardContent || mergedCardMetadata)) {
        cardUpdateFields.contentHash = computeCardContentHash({
          userId: currentUserId,
          type: existingCard.type,
          category: existingCard.category,
          content: mergedCardContent || existingCard.content,
          metadata: mergedCardMetadata || existingCard.metadata
        });

        const duplicateOfAnother = await cardsCollection.findOne({
          userId: currentUserId,
          contentHash: cardUpdateFields.contentHash,
          _id: { $ne: existingCard._id }
        });
        if (duplicateOfAnother) {
          return res.status(409).json({ error: "Another card with this exact content already exists." });
        }

        // Check against the standalone snippets collection to prevent cross-collection duplicates here too
        if (existingCard.type === "Snippet" || existingCard.type === "snippets") {
          const crossDup = await findCrossCollectionSnippetDuplicate(db, {
            userId: currentUserId,
            language: mergedCardMetadata?.language || mergedCardContent?.language,
            code: mergedCardMetadata?.code || mergedCardContent?.code,
            excludeCardId: existingCard._id
          });
          if (crossDup) {
            return res.status(409).json({ error: "A snippet with this exact code already exists in your Snippets." });
          }
        }
      }

      try {
        result = await cardsCollection.findOneAndUpdate(
          query,
          { $set: cardUpdateFields },
          { returnDocument: "after" }
        );
      } catch (updateError) {
        if (updateError?.code === 11000) {
          return res.status(409).json({ error: "Another card with this exact content already exists." });
        }
        throw updateError;
      }
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

// Delete a snippet (checks the snippets collection first, then tries the cards collection)
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