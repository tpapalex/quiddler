# Quiddler Scoring App

A lightweight, browser-based helper for running and scoring [Quiddler](https://en.wikipedia.org/wiki/Quiddler) games, available at tpapalex.github.io/quiddler.

## Highlights
- Track any number of players across 10 rounds with dealer rotation
- Automatic scoring from tile values (including digraphs)
- Challenges with per-rules deductions and a “GOD” option (unassigned challenger)
- Words checked against the 13th ed. of the [Collins English Dictionary](https://www.collinsdictionary.com/dictionary/english) (published 2019)
- Optional single-winner bonuses: Longest Word and Most Words
- Dictionary: look up words in game dictionary, as well as the [Free Dictionary API](https://dictionaryapi.dev/)
- Solver: suggests the best play for a given rack, optionally with frequency filters
- Persistent game state via localStorage; resume after reload

## Quick start

Input notation
- Digraph tiles are wrapped in parentheses: (qu), (th), (er), (in), (cl)
- Unused/penalty chits start with a dash: -e(th)

Challenges & bonuses
- Click a chit to resolve a challenge: pick a challenger (or GOD) and the app marks it valid/invalid against the dictionary and applies deductions.
- Bonuses (if enabled) award strictly one player per round: longest word length and most words.

## Tech notes
- Pure HTML + vanilla JS; no bundler. External CDNs: Tailwind, Popper, Tippy, wink-lemmatizer.
- Namespaces exposed on window for integration/debugging: QuiddlerGame, QuiddlerRender, QuiddlerSolver, QuiddlerTools, QuiddlerUI, QuiddlerData.
- State persists under localStorage key quiddlerGameStateV1. Use “New Game” or clear storage to reset.
