// Server-side search for cards and snippets.
// Matching is done by the text indexes created in db.js, so the client never
// has to download everything just to filter it.

export const SEARCH_DEFAULT_LIMIT = 8;
export const SEARCH_MAX_LIMIT = 20;
export const SEARCH_MAX_QUERY_LENGTH = 100;

// Escape user input so it can sit safely inside a RegExp
export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Turn the ?limit= value into a safe number (falls back to the default)
export function parseSearchLimit(rawLimit) {
  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1) return SEARCH_DEFAULT_LIMIT;
  return Math.min(limit, SEARCH_MAX_LIMIT);
}

// Search one collection for one user. Returns docs with a `score`, best match first.
async function searchCollection(collection, userId, query, limit) {
  // Text search only matches whole words (with stemming), so it's the main pass
  const textHits = await collection
    .find(
      { userId, $text: { $search: query } },
      { projection: { title: 1, type: 1, score: { $meta: "textScore" } } }
    )
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .toArray();

  if (textHits.length >= limit) return textHits;

  // Typing "rea" should still find "React", but a text index can't do partial words.
  // So we top up with titles/tags that have a word starting with what was typed.
  // This only scans the current user's docs because userId is in the filter.
  const wordStart = new RegExp(`(^|\\s)${escapeRegex(query)}`, "i");
  const prefixHits = await collection
    .find(
      {
        userId,
        _id: { $nin: textHits.map((doc) => doc._id) },
        $or: [{ title: wordStart }, { tags: wordStart }],
      },
      { projection: { title: 1, type: 1 } }
    )
    .limit(limit - textHits.length)
    .toArray();

  // Prefix matches have no text score, so they always rank after real text matches
  return [...textHits, ...prefixHits.map((doc) => ({ ...doc, score: 0 }))];
}

// Keep the same shape the navbar dropdown already uses
function toSearchResult(doc, isStandaloneSnippet) {
  const isSnippet = isStandaloneSnippet || doc.type === "Snippet" || doc.type === "snippets";
  return {
    id: doc._id.toString(),
    title: doc.title || (isSnippet ? "Untitled Snippet" : "Untitled Card"),
    type: isStandaloneSnippet ? "Snippet" : doc.type,
    isSnippet,
  };
}

// Search cards and standalone snippets together and return the best matches overall
export async function searchResources(db, userId, query, limit = SEARCH_DEFAULT_LIMIT) {
  const [cardHits, snippetHits] = await Promise.all([
    searchCollection(db.collection("cards"), userId, query, limit),
    searchCollection(db.collection("snippets"), userId, query, limit),
  ]);

  const ranked = [
    ...cardHits.map((doc) => ({ doc, score: doc.score, isStandaloneSnippet: false })),
    ...snippetHits.map((doc) => ({ doc, score: doc.score, isStandaloneSnippet: true })),
  ].sort((a, b) => b.score - a.score);

  return ranked
    .slice(0, limit)
    .map(({ doc, isStandaloneSnippet }) => toSearchResult(doc, isStandaloneSnippet));
}