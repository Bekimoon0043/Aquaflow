// search.js — AquaFlow Documentation Center search (AQ-S4-006)
//
// A pure, dependency-free, offline search engine over the bundled docs. Because the
// articles ship with the app and this runs entirely client-side, search and help work
// with no network connection. Also provides context-sensitive help: given a UI panel
// key, return the articles that explain it.

import { ARTICLES } from "./articles";

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for",
  "with", "is", "are", "at", "by", "it", "as", "be", "this", "that"]);

export function tokenize(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

// The library works with no network — offline is always available.
export const OFFLINE_AVAILABLE = true;

function snippet(body, queryTokens) {
  const sentences = String(body).split(/(?<=\.)\s+/);
  const hit = sentences.find((s) => {
    const toks = new Set(tokenize(s));
    return queryTokens.some((q) => toks.has(q));
  });
  const s = hit || sentences[0] || "";
  return s.length > 160 ? s.slice(0, 157) + "…" : s;
}

export function scoreArticle(article, queryTokens) {
  if (!queryTokens.length) return 0;
  const title = tokenize(article.title);
  const tags = tokenize((article.tags || []).join(" "));
  const body = tokenize(article.body);
  const titleSet = new Set(title);
  const tagSet = new Set(tags);
  let score = 0;
  for (const q of queryTokens) {
    if (titleSet.has(q)) score += 6;
    if (tagSet.has(q)) score += 4;
    score += body.filter((b) => b === q).length;                 // term frequency
    if (article.title.toLowerCase().includes(q)) score += 2;     // substring boost
  }
  return score;
}

export function search(query, articles = ARTICLES) {
  const q = tokenize(query);
  if (!q.length) return [];
  return articles
    .map((art) => ({ article: art, score: scoreArticle(art, q) }))
    .filter((r) => r.score > 0)
    .sort((x, y) => y.score - x.score || x.article.title.localeCompare(y.article.title))
    .map((r) => ({
      id: r.article.id, title: r.article.title, category: r.article.category,
      score: r.score, snippet: snippet(r.article.body, q),
    }));
}

// Context-sensitive help: articles whose `context` includes the panel key (or whose
// tags mention it), most relevant first.
export function contextHelp(contextKey, articles = ARTICLES) {
  if (!contextKey) return [];
  const key = String(contextKey).toLowerCase();
  const matches = articles.filter(
    (art) => (art.context || []).includes(key) || (art.tags || []).some((t) => t.toLowerCase() === key));
  return matches.map((art) => ({ id: art.id, title: art.title, category: art.category }));
}

export function getArticle(id, articles = ARTICLES) {
  return articles.find((a) => a.id === id) || null;
}
