'use strict';

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

// Top-level: try API first; if it fails/returns null, fall back to local.
// Returns a string: either HTML with <br> breaks, a local definition, or the not-found message.
async function getWordDefinition(word) {
  const cleanedWord = (word ?? '').replace(/[()]/g, '').trim();
  if (!cleanedWord) return 'Definition not found...';

  // Try API (catch to ensure fallback still runs)
  let definition = null;
  try {
    definition = await getWordDefinitionAPI(cleanedWord);
  } catch {
    // swallow; we'll fall back to local
  }

  if (definition == null) {
    definition = getWordDefinitionLocal(cleanedWord);
  }

  return definition ?? 'Definition not found...';
}
