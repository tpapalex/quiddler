'use strict';

// Parse input into card tokens, recognizing digraphs wrapped in parentheses
function parseCards(word) {
  return word.match(/\([a-z]+\)|[a-z]/gi) || [];
}

// Calculate score for a list of card tokens
function calculateScore(cards) {
  return cards.reduce((total, card) => total + (cardScores[card.replace(/[()]/g, '').toLowerCase()] || 1), 0);
}

// Utility to convert a token to display form (wrap digraphs in parentheses)
function toCardToken(token) {
  const t = String(token || '').trim();
  return t.length > 1 ? `(${t})` : t;
}

// Make the letter-points array for a word text (handles digraphs)
function pointsArrayFor(wordText) {
  const letters = parseCards(wordText.replace('-', ''));
  return letters.map(l => cardScores[l.replace(/[()]/g, '').toLowerCase()] || 1);
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
