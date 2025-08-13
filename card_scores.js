// Quiddler card point values.
// - Keys are case-insensitive single letters or multi-letter digraph tiles.
// - Values are the points each tile contributes to a word's score.
// - This is the single source of truth for scoring across the app (scoring.js, render.js, optimizer.js).
//
// Notes:
// - Digraphs are special tiles consisting of 2 letters that must be used as a unit in play, e.g., "qu", "th".
// - In UI text, digraphs are represented by wrapping in parentheses, e.g., (qu). See scoring.parseCards and UI helpers.
// - The DIGRAPHS Set below is derived from these keys and is used by the solver when counting rack tiles.
const cardScores = {
    'a':2,
    'b':8,
    'c':8,
    'd':5,
    'e':2,
    'f':6,
    'g':6,
    'h':7,
    'i':2,
    'j':13,
    'k':8,
    'l':3,
    'm':5,
    'n':5,
    'o':2,
    'p':6,
    'q':15,
    'r':5,
    's':3,
    't':3,
    'u':4,
    'v':11,
    'w':10,
    'x':12,
    'y':4,
    'z':14,
    // Digraph tiles (two-letter cards used as a single unit)
    'cl':10,
    'er':7,
    'in':7,
    'qu':9,
    'th':9,
};

// Convenience: set of all digraph tile keys derived from cardScores.
// Used by:
// - optimizer.countRack: to split a rack into singles vs. digraph counts.
// - scoring.parseCards + render helpers: to display digraphs as (qu), etc.
const DIGRAPHS = new Set(Object.keys(cardScores).filter(w => w.length > 1));

// Expose for debugging/inspection in the browser console
if (typeof window !== 'undefined') {
  window.QuiddlerData = Object.assign({}, window.QuiddlerData || {}, { cardScores, DIGRAPHS });
}