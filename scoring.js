'use strict';

/*
  scoring.js
  Core scoring helpers used across the app:
  - parseCards: split a text word into card tokens, handling digraphs like (qu)
  - calculateScore: sum points for a list of tokens using card_scores.js
  - toCardToken / pointsArrayFor / breakdownStr: UI helpers for rendering

  Conventions:
  - Input words may include parentheses to indicate digraph tiles (e.g., (qu)).
  - A leading '-' denotes unused/penalty chits. Callers strip '-' before parsing.
  - cardScores (from card_scores.js) is the single source of truth for tile points.
*/

// Parse input into card tokens, recognizing digraphs wrapped in parentheses
function parseCards(word) {
  return word.match(/\([a-z]+\)|[a-z]/gi) || [];
}

// Calculate score for a list of card tokens (now uses normalizeToken for consistency)
function calculateScore(cards) {
  return cards.reduce((total, card) => total + (cardScores[normalizeToken(card)] || 1), 0);
}

// Utility to convert a token to display form (wrap digraphs in parentheses)
function toCardToken(token) {
  const t = String(token || '').trim();
  return t.length > 1 ? `(${t})` : t;
}

// NEW: Normalize a token to its scoring key (strip parens, lowercase)
function normalizeToken(token) {
  return String(token || '').replace(/[()]/g, '').toLowerCase();
}

// NEW: Strip leading penalty marker '-'
function stripPenalty(wordText) {
  return String(wordText || '').replace(/^-/, '');
}

// NEW: Tokens (cards) for a chit/word (penalty removed first)
function tokensForWord(wordText) {
  return parseCards(stripPenalty(wordText));
}

// NEW: Score helper for a chit text (handles leading '-')
function scoreForChit(wordText) {
  return calculateScore(tokensForWord(wordText));
}

// Make the letter-points array for a word text (handles digraphs)
function pointsArrayFor(wordText) {
  const letters = tokensForWord(wordText);
  return letters.map(l => cardScores[normalizeToken(l)] || 1);
}

// NEW: Join a list of tokens into a display word using parentheses for digraphs
function joinTokensForDisplay(tokens) {
  return (tokens || []).map(toCardToken).join('');
}

// NEW: Convert a chit text into its plain letters (lowercase, no parentheses or '-')
function plainWord(wordText) {
  const tokens = tokensForWord(wordText);
  return tokens.map(normalizeToken).join('');
}

// NEW: Length of the plain word (letters only, digraphs count as 2 letters in dictionary spelling)
function plainLength(wordText) {
  return plainWord(wordText).length;
}

// For tooltip: "2 + 10 + 1"
function breakdownStr(wordText) {
  const arr = pointsArrayFor(wordText);
  return arr.join(' + ');
}

// Optional color helper (not strictly required by rendering as classes are chosen inline)
function chitColorClass(word) {
  return word.state === 'invalid' ? 'bg-red-300' : word.state === 'valid' ? 'bg-green-300' : 'bg-gray-200';
}

// Expose UI helpers under a namespace
if (typeof window !== 'undefined') {
  window.QuiddlerUI = Object.assign({}, window.QuiddlerUI || {}, {
    parseCards,
    calculateScore,
    toCardToken,
    pointsArrayFor,
    breakdownStr,
    // exports
    normalizeToken,
    joinTokensForDisplay,
    plainWord,
    plainLength,
    stripPenalty,
    tokensForWord,
    scoreForChit,
  });
}
