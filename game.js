'use strict';

let gameStarted = false;
let players = [];
let scores = {};
let currentRound = 3;
const maxRound = 10;
let roundsData = [];
let longestWordBonus = false;
let mostWordsBonus = false;
let longestWordPoints = 0;
let mostWordsPoints = 0;
let currentDealerIdx = 0;

function startGame() {
  // Parse and clean players list
  players = document.getElementById('playersInput').value
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());

  if (!players.length) {
    alert('Please enter at least one player');
    return;
  }

  // Reset all global variables to initial state
  gameStarted = true;
  scores = {};
  currentRound = 3;
  roundsData = [];
  currentDealerIdx = 0;
  longestWordBonus = document.getElementById('longestWordBonus').checked;
  mostWordsBonus = document.getElementById('mostWordsBonus').checked;
  longestWordPoints = +document.getElementById('longestWordPoints').value;
  mostWordsPoints = +document.getElementById('mostWordsPoints').value;

  // Initialize player scores
  players.forEach(player => scores[player] = 0);

  // Disable inputs after initial setup
  document.getElementById('playersInput').disabled = true;
  document.getElementById('longestWordBonus').disabled = true;
  document.getElementById('mostWordsBonus').disabled = true;
  document.getElementById('longestWordPoints').disabled = true;
  document.getElementById('mostWordsPoints').disabled = true;

  // Clear previous game state from UI
  document.getElementById('scoreTotals').innerHTML = '';
  document.getElementById('previousRounds').innerHTML = '';

  // Make game area visible and start first round
  document.getElementById('gameArea').classList.remove('hidden');
  document.getElementById('currentBonuses').classList.remove('hidden');

  document.getElementById('gameGo').textContent = 'Restart Game';
  setupRound();
}

function setupRound() {
  const dealer = players[currentDealerIdx % players.length];
  document.getElementById('roundHeader').innerText = `Round ${currentRound} Cards (${dealer} deals)`;

  document.getElementById('scoreInputs').innerHTML = `
    <div class="mb-2 font-medium">Enter your words separated by spaces, using parentheses around digraphs and a '-' prefix before all unused cards.</div>
    ${players.map(player => `
      <div class="mb-2 flex items-center">
        <label class="font-semibold mr-2">${player}'s words:</label>
        <input class="player-words flex-1 p-2 border rounded" data-player="${player}" placeholder="e.g., (qu)ick(er) bad -e(th)">
      </div>
    `).join('')}`;

  currentDealerIdx++;
}

function validateWord(word) {
  const cleanedWord = word.replace(/[()]/g, '').toUpperCase();
  return validWordsMap.hasOwnProperty(cleanedWord);
}

function nextRound() {
  const round = { roundNum: currentRound, players: {} };

  document.querySelectorAll('.player-words').forEach(input => {
    const player = input.dataset.player;
    const words = input.value.trim().split(/\s+/).filter(w => w);
    round.players[player] = words.map(word => ({
      text: word,
      score: calculateScore(parseCards(word.replace('-', ''))),
      state: word.startsWith('-') ? 'invalid' : 'neutral',
      challenger: null
    }));
  });

  roundsData.push(round);

  recalculateScores();
  updatePreviousRounds();

  currentRound < maxRound ? (++currentRound, setupRound()) : alert('Game Over! Check final scores.');
}

// ---------- Helpers ----------
function eligibleForBase(word) {
  return (word.state !== 'invalid') || (word.state === 'invalid' && word.challenger == null);
}
function eligibleForBonus(word) {
  return !word.text.startsWith('-') && eligibleForBase(word);
}
function wordBaseValue(word) {
  const sign = word.text.startsWith('-') ? -1 : 1;
  return sign * word.score;
}
function baseScoreForPlayer(pdata) {
  return pdata.reduce((sum, w) => sum + (eligibleForBase(w) ? wordBaseValue(w) : 0), 0);
}
function bonusEligibleWords(pdata) {
  return pdata.filter(eligibleForBonus);
}
function longestWordLen(pdata) {
  return bonusEligibleWords(pdata)
    .reduce((max, w) => Math.max(max, w.text.replace(/[()]/g, '').length), 0);
}
function wordsCount(pdata) {
  return bonusEligibleWords(pdata).length;
}
function resetRoundPlayerState(pdata) {
  pdata.roundScore = 0;
  pdata.challengeDeductions = 0;
  pdata.bonus = 0;
  pdata.gotLongestBonus = false;
  pdata.gotMostWordsBonus = false;
}
function applyChallengeDeductionsForPlayer(round, player) {
  const pdata = round.players[player];
  pdata.forEach(word => {
    if (word.state === 'valid' && word.challenger) {
      round.players[word.challenger].challengeDeductions += word.score;
    } else if (word.state === 'invalid' && word.challenger) {
      pdata.challengeDeductions += word.score;
    }
  });
}

// ---------- Main ----------
function recalculateScores() {
  players.forEach(player => { scores[player] = 0; });

  roundsData.forEach(round => {
    players.forEach(player => resetRoundPlayerState(round.players[player]));

    let longestLength = 0;
    let mostWordsCount = 0;
    let longestPlayers = [];
    let mostWordsPlayers = [];

    players.forEach(player => {
      const pdata = round.players[player];
      pdata.baseScore = baseScoreForPlayer(pdata);

      const pLongest = longestWordLen(pdata);
      if (pLongest > longestLength) {
        longestLength = pLongest;
        longestPlayers = [player];
      } else if (pLongest === longestLength && pLongest > 0) {
        longestPlayers.push(player);
      }

      const pCount = wordsCount(pdata);
      if (pCount > mostWordsCount) {
        mostWordsCount = pCount;
        mostWordsPlayers = [player];
      } else if (pCount === mostWordsCount && pCount > 0) {
        mostWordsPlayers.push(player);
      }
    });

    players.forEach(player => applyChallengeDeductionsForPlayer(round, player));

    if (longestWordBonus && longestPlayers.length === 1) {
      const p = longestPlayers[0];
      round.players[p].bonus += longestWordPoints;
      round.players[p].gotLongestBonus = true;
    }
    if (mostWordsBonus && mostWordsPlayers.length === 1) {
      const p = mostWordsPlayers[0];
      round.players[p].bonus += mostWordsPoints;
      round.players[p].gotMostWordsBonus = true;
    }

    players.forEach(player => {
      const pdata = round.players[player];
      pdata.roundScore = Math.max(0, pdata.baseScore - pdata.challengeDeductions) + pdata.bonus;
      scores[player] += pdata.roundScore;
    });
  });

  updateScores();
}

// Handler for the gear button
function prefillPlayFor(roundIdx, playerName, e) {
  e?.stopPropagation?.();
  const round = roundsData[roundIdx];
  if (!round) return;

  const pdata = round.players[playerName] || [];
  const tiles = pdata.map(w => w.text).join(' ');

  let oppMaxLongest = 0;
  let oppMaxMost = 0;
  players.forEach(p => {
    if (p === playerName) return;
    const opData = round.players[p] || [];
    oppMaxLongest = Math.max(oppMaxLongest, longestWordLen(opData));
    oppMaxMost    = Math.max(oppMaxMost,    wordsCount(opData));
  });

  window.QuiddlerTools?.prefillPlay?.({
    tiles,
    currentLongest: oppMaxLongest,
    currentMost: oppMaxMost
  });
}

function enterEditMode(player, roundIdx, btn) {
  const row = btn.closest('.group');
  const cell = row.querySelector('.flex-1.min-w-0');
  if (!cell) return;

  const chits = cell.querySelector('.chit-container');
  const edit  = cell.querySelector('.edit-container');
  if (!edit) return;

  chits?.classList.add('hidden');
  edit.classList.remove('hidden');

  const input = edit.querySelector('.edit-input');
  if (input) {
    input.focus();
    const v = input.value; input.value = ''; input.value = v;

    input.addEventListener('keydown', function handler(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit(player, roundIdx, btn);
        input.removeEventListener('keydown', handler);
      }
    });
  }
}

function cancelEdit(btn) {
  const row = btn.closest('.group');
  const cell = row.querySelector('.flex-1.min-w-0');
  if (!cell) return;

  cell.querySelector('.edit-container')?.classList.add('hidden');
  cell.querySelector('.chit-container')?.classList.remove('hidden');
}

function saveEdit(player, roundIdx, btn) {
  const row = btn.closest('.group');
  const cell = row.querySelector('.flex-1.min-w-0');
  if (!cell) return;

  const input = cell.querySelector('.edit-input');
  const newWords = (input?.value || '').trim().split(/\s+/).filter(Boolean);

  roundsData[roundIdx].players[player] = newWords.map(word => ({
    text: word,
    score: calculateScore(parseCards(word.replace('-', ''))),
    state: word.startsWith('-') ? 'invalid' : 'neutral',
    challenger: null
  }));

  recalculateScores();
  updatePreviousRounds();
}

function updateScores() {
  document.getElementById('scoreTotals').innerHTML = players
    .map(player => ({ player, score: scores[player] }))
    .sort((a, b) => b.score - a.score)
    .map(({ player, score }) => `<li>${player}: ${score} points</li>`)
    .join('');
}

function toggleChallenge(btn, e) {
  e.stopPropagation();

  document.querySelectorAll('.challenger-dropdown').forEach(el => el.remove());

  const roundIdx = btn.dataset.round;
  const player = btn.dataset.player;
  const wordIdx = btn.dataset.word;
  const wordObj = roundsData[roundIdx].players[player][wordIdx];

  if (wordObj.text.startsWith('-')) return;

  if (wordObj.state === 'valid' || wordObj.state === 'invalid') {
    wordObj.state = 'neutral';
    wordObj.challenger = null;
    recalculateScores();
    updatePreviousRounds();
    return;
  }

  const challengerDropdown = document.createElement('select');
  challengerDropdown.className = 'ml-2 p-1 border rounded challenger-dropdown';
  challengerDropdown.innerHTML = `<option value="">Select Challenger</option><option value="null">GOD</option>` +
    players.filter(p => p !== player).map(p => `<option>${p}</option>`).join('');

  challengerDropdown.onchange = function() {
    if (this.value === '') { this.remove(); return; }
    if (this.value !== 'null') wordObj.challenger = this.value;
    wordObj.state = validateWord(wordObj.text) ? 'valid' : 'invalid';
    recalculateScores();
    updatePreviousRounds();
    this.remove();
  };

  btn.after(challengerDropdown);

  function clickOutsideHandler(event) {
    if (!challengerDropdown.contains(event.target)) {
      challengerDropdown.remove();
      document.removeEventListener('click', clickOutsideHandler);
    }
  }
  setTimeout(() => { document.addEventListener('click', clickOutsideHandler); }, 0);
}

// Players input affects default bonuses
document.getElementById('playersInput')?.addEventListener('input', function() {
  const playersList = this.value
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const longestWordCheckbox = document.getElementById('longestWordBonus');
  const mostWordsCheckbox = document.getElementById('mostWordsBonus');

  if (playersList.length <= 1) {
    longestWordCheckbox.checked = false;
    mostWordsCheckbox.checked = false;
  } else if (playersList.length === 2) {
    longestWordCheckbox.checked = true;
    mostWordsCheckbox.checked = false;
  } else {
    longestWordCheckbox.checked = true;
    mostWordsCheckbox.checked = true;
  }
});

function updateBonusInputs() {
  document.getElementById('longestWordPoints').disabled = !document.getElementById('longestWordBonus').checked;
  document.getElementById('mostWordsPoints').disabled = !document.getElementById('mostWordsBonus').checked;
}

// Initialize input states correctly
updateBonusInputs();

document.getElementById('longestWordBonus')?.addEventListener('change', updateBonusInputs);
document.getElementById('mostWordsBonus')?.addEventListener('change', updateBonusInputs);

function updatePreviousRounds() {
  const html = roundsData
    .slice()
    .reverse()
    .map((round, revIdx) => {
      const roundIdx = roundsData.length - 1 - revIdx;
      return renderRound(round, roundIdx, { interactive: true });
    })
    .join('');

  const container = document.getElementById('previousRounds');
  container.innerHTML = html;

  container.querySelectorAll('.def-open').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const w = el.getAttribute('data-word') || '';
      if (window.QuiddlerTools?.showDict) await window.QuiddlerTools.showDict(w);
    });
  });

  initChitTooltips(container);
}
