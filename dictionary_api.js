'use strict';

// dictionary_api.js
// Helpers to look up definitions for a word:
// - getWordDefinitionLocal(word): case-insensitive lookup from collins_dictionary.js (validWordsMap)
// - getWordDefinitionAPI(word): fetch from Free Dictionary API and format senses with <br>
// - getWordDefinition(word): require a local definition; if present, try API, else return not-found
//
// Notes:
// - Returned strings may contain HTML <br> tags for multiple senses (rendered directly in UI).
// - A simple AbortController timeout prevents long-hanging network requests.
// - Callers should pass raw chit text; helper strips parentheses and whitespace.

// Local lookup (case-insensitive via UPPER)
function getWordDefinitionLocal(word) {
  return validWordsMap[String(word || '').toUpperCase()] ?? null;
}

// API helper: returns a string with <br> between senses, or null on failure/no match.
async function getWordDefinitionAPI(word) {
  const w = String(word || '').trim();
  if (!w) return null;

  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w.toLowerCase())}`;

  // Optional: simple timeout so we don't hang forever
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`Free Dictionary API error for "${w}": ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    // Build a nice string with numbered senses
    let i = 0;
    const ret = [];

    for (const datum of data) {
      if ((datum.word || '').toLowerCase() !== w.toLowerCase()) continue;
      for (const meaning of datum.meanings ?? []) {
        let pos = meaning.partOfSpeech || '';
        if (pos === 'interjection') pos = 'interj';
        for (const def of meaning.definitions ?? []) {
          if (!def?.definition) continue;
          i++;
          ret.push(`[${i}] (${pos}) ${def.definition}`);
        }
      }
    }

    return ret.length ? ret.join('<br>') : null;
  } catch (error) {
    console.error('Free Dictionary API request/parsing failed:', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Top-level: only show online definition if the word exists in the local dictionary.
// Returns a string: if local exists, prefer API result, else local; otherwise the not-found message.
async function getWordDefinition(word) {
  const cleanedWord = plainWord(word);
  if (!cleanedWord) return 'Definition not found...';

  // Require local definition to consider API
  const local = getWordDefinitionLocal(cleanedWord);
  if (!local) return 'Definition not found...';

  // Try API; if it fails or has no match, fall back to local
  try {
    const online = await getWordDefinitionAPI(cleanedWord);
    return online ?? local;
  } catch {
    return local;
  }
}
