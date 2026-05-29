const levels = [
  { bpm: 80, audibleBars: 2, silentBars: 2, totalRounds: 2, passAccuracy: 70 },
  { bpm: 96, audibleBars: 2, silentBars: 3, totalRounds: 2, passAccuracy: 76 },
  { bpm: 112, audibleBars: 1, silentBars: 3, totalRounds: 3, passAccuracy: 82 },
  { bpm: 128, audibleBars: 1, silentBars: 4, totalRounds: 3, passAccuracy: 86 }
];

const beatsPerBar = 4;
const countInBeats = 4;
const lookAheadMs = 25;
const scheduleAheadSec = 0.12;
const hitWindowMs = 180;
const leaderboardKey = "BeatKeeperLeaderboard";
const playerIdKey = "BeatKeeperPlayerId";
const playerNameKey = "BeatKeeperPlayerName";
const leaderboardApiPath = "/leaderboard.php";

const canvas = document.querySelector("#beatCanvas");
const ctx = canvas.getContext("2d");
const startButton = document.querySelector("#startButton");
const tapButton = document.querySelector("#tapButton");
const nextButton = document.querySelector("#nextButton");
const beatCore = document.querySelector("#beatCore");
const levelLabel = document.querySelector("#levelLabel");
const bpmValue = document.querySelector("#bpmValue");
const phaseValue = document.querySelector("#phaseValue");
const accuracyValue = document.querySelector("#accuracyValue");
const scoreValue = document.querySelector("#scoreValue");
const hitStrip = document.querySelector("#hitStrip");
const message = document.querySelector("#message");
const scoreForm = document.querySelector("#scoreForm");
const playerNameInput = document.querySelector("#playerName");
const saveScoreButton = document.querySelector("#saveScoreButton");
const leaderboardList = document.querySelector("#leaderboardList");
const rankMessage = document.querySelector("#rankMessage");

let audioContext;
let schedulerId;
let animationId;
let levelIndex = 0;
let nextBeatTime = 0;
let beatNumber = 0;
let running = false;
let scheduledBeats = [];
let hits = [];
let score = 0;
let runScore = 0;
let baseRunScore = 0;
let lastPulseAt = 0;
let pendingResult = null;
let levelFinished = false;

function currentLevel() {
  return levels[levelIndex];
}

function secondsPerBeat() {
  return 60 / currentLevel().bpm;
}

function levelLengthBeats() {
  const level = currentLevel();
  return (level.audibleBars + level.silentBars) * beatsPerBar * level.totalRounds;
}

function isSilentBeat(index) {
  if (index < 0) return false;
  const level = currentLevel();
  const cycle = (level.audibleBars + level.silentBars) * beatsPerBar;
  return index % cycle >= level.audibleBars * beatsPerBar;
}

function getPhase(index = beatNumber) {
  if (!running) return "Ready";
  if (index <= 0) return "Count In";
  return isSilentBeat(Math.max(0, index - 1)) ? "Silent" : "Listen";
}

function createAudio() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function playClick(time, accent) {
  const audio = createAudio();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(accent ? 1180 : 860, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.42 : 0.28, time + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.075);

  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.start(time);
  oscillator.stop(time + 0.09);
}

function scheduleBeat(time, index) {
  const countIn = index < 0;
  const silent = isSilentBeat(index);
  const accent = countIn ? index === -countInBeats : index % beatsPerBar === 0;

  scheduledBeats.push({ time, index, silent, countIn, judged: countIn });

  if (!silent) {
    playClick(time, accent);
  }
}

function scheduler() {
  const audio = createAudio();
  while (nextBeatTime < audio.currentTime + scheduleAheadSec && beatNumber < levelLengthBeats()) {
    scheduleBeat(nextBeatTime, beatNumber);
    nextBeatTime += secondsPerBeat();
    beatNumber += 1;
  }

  if (!levelFinished && beatNumber >= levelLengthBeats() && audio.currentTime > nextBeatTime + 0.45) {
    finishLevel();
  }

  updateJudgements();
  updateHud();
}

function startLevel() {
  const audio = createAudio();
  audio.resume();

  stopLevel(false);
  if (levelIndex === 0) {
    baseRunScore = 0;
  }
  runScore = baseRunScore;
  running = true;
  nextBeatTime = audio.currentTime + 0.65;
  beatNumber = -countInBeats;
  scheduledBeats = [];
  hits = [];
  score = 0;
  lastPulseAt = 0;
  pendingResult = null;
  levelFinished = false;

  startButton.textContent = "Restart";
  nextButton.disabled = true;
  saveScoreButton.disabled = true;
  message.textContent = `Level ${levelIndex + 1}: ${currentLevel().bpm} BPM. Four-count first, then tap Space through the silent bars.`;
  rankMessage.textContent = "Finish a level to save your run.";
  renderHitStrip();
  updateHud();

  schedulerId = window.setInterval(scheduler, lookAheadMs);
  animationId = window.requestAnimationFrame(draw);
}

function stopLevel(resetButton = true) {
  running = false;
  window.clearInterval(schedulerId);
  window.cancelAnimationFrame(animationId);
  schedulerId = null;
  animationId = null;
  if (resetButton) {
    startButton.textContent = "Start";
  }
}

function finishLevel() {
  levelFinished = true;
  stopLevel(false);
  const accuracy = getAccuracy();
  const passed = accuracy >= currentLevel().passAccuracy;
  const achievedLevel = levelIndex + 1;
  runScore = baseRunScore + score;
  pendingResult = {
    score: runScore,
    level: achievedLevel,
    accuracy,
    finishedAt: Date.now()
  };
  nextButton.disabled = !passed || levelIndex === levels.length - 1;
  saveScoreButton.disabled = false;
  startButton.textContent = "Retry";
  phaseValue.textContent = "Done";
  scoreValue.textContent = runScore;
  message.textContent = passed
    ? levelIndex === levels.length - 1
      ? `Finished. Final accuracy ${accuracy}%, run score ${runScore}. Save your score.`
      : `Passed with ${accuracy}% accuracy. Save now or move to the next level.`
    : `Accuracy ${accuracy}%. This level needs ${currentLevel().passAccuracy}% to pass. Save this run or retry.`;
  updateRankPreview();
}

function tap() {
  if (levelFinished || !running || !audioContext) return;

  const now = audioContext.currentTime;
  const target = scheduledBeats
    .filter((beat) => !beat.judged && !beat.countIn)
    .map((beat) => ({ ...beat, deltaMs: (now - beat.time) * 1000 }))
    .filter((beat) => Math.abs(beat.deltaMs) <= hitWindowMs)
    .sort((a, b) => Math.abs(a.deltaMs) - Math.abs(b.deltaMs))[0];

  if (!target) {
    // No beat within the strict hit window — try to tie this tap to the
    // nearest unjudged beat within a larger grace window so we don't
    // generate a separate tap-miss and later a judgement-miss for the same beat.
    const now = audioContext.currentTime;
    const largerWindowMs = Math.max(hitWindowMs * 2, (secondsPerBeat() * 1000) / 2);
    const nearest = scheduledBeats
      .filter((beat) => !beat.judged && !beat.countIn)
      .map((beat) => ({ ...beat, deltaMs: (now - beat.time) * 1000 }))
      .sort((a, b) => Math.abs(a.deltaMs) - Math.abs(b.deltaMs))[0];

    if (nearest && Math.abs(nearest.deltaMs) <= largerWindowMs) {
      const originalNearest = scheduledBeats.find((b) => b.index === nearest.index);
      if (originalNearest) originalNearest.judged = true;
      const distance = Math.abs(nearest.deltaMs);
      addHit("miss", distance, nearest.silent, nearest.index);
      message.textContent = `Miss ${Math.round(distance)}ms ${nearest.deltaMs < 0 ? "early" : "late"}.`;
      return;
    }

    // No remaining beat to tie this tap to; record a generic miss.
    addHit("miss", hitWindowMs, false, null);
    message.textContent = "Miss. Wait for the pulse and keep counting.";
    return;
  }

  const original = scheduledBeats.find((beat) => beat.index === target.index);
  original.judged = true;

  // Mark any nearby beats within the hit window as judged so one tap
  // cannot be used to register multiple separate beats (prevents rapid multi-taps)
  const windowSec = hitWindowMs / 1000;
  scheduledBeats.forEach((beat) => {
    if (!beat.judged && !beat.countIn && Math.abs(beat.time - target.time) <= windowSec) {
      beat.judged = true;
    }
  });

  const distance = Math.abs(target.deltaMs);
  const quality = distance <= 55 ? "good" : distance <= 115 ? "ok" : "miss";
  const points = quality === "good" ? 100 : quality === "ok" ? 55 : 15;
  score += target.silent ? points * 2 : points;
  addHit(quality, distance, target.silent, target.index);

  const timing = target.deltaMs < 0 ? "early" : "late";
  message.textContent = `${quality.toUpperCase()} ${Math.round(distance)}ms ${timing}${target.silent ? " in silence" : ""}.`;
  updateHud();
}

function addHit(quality, distance, silent, beatIndex = null) {
  hits.push({ quality, distance, silent, beatIndex });
  hits = hits.slice(-12);
  renderHitStrip();
}

function updateJudgements() {
  if (!audioContext) return;
  const now = audioContext.currentTime;
  scheduledBeats.forEach((beat) => {
    if (!beat.judged && !beat.countIn && now - beat.time > hitWindowMs / 1000) {
      beat.judged = true;
      addHit("miss", hitWindowMs, beat.silent, beat.index);
    }
  });
}

function getAccuracy() {
  if (!hits.length) return 0;
  const weighted = hits.reduce((total, hit) => {
    if (hit.quality === "good") return total + 1;
    if (hit.quality === "ok") return total + 0.58;
    return total;
  }, 0);
  return Math.round((weighted / hits.length) * 100);
}

function renderHitStrip() {
  hitStrip.innerHTML = "";
  const padded = [...Array(Math.max(0, 12 - hits.length)).fill(null), ...hits];
  padded.forEach((hit, i) => {
    const dot = document.createElement("div");
    dot.className = `hit-dot${hit ? ` ${hit.quality}` : ""}`;
    const label = document.createElement("span");
    label.className = "hit-number";
    // Show the beat number if available; otherwise show a fallback position number.
    label.textContent = String(hit && typeof hit.beatIndex === "number" ? hit.beatIndex + 1 : i + 1);
    dot.append(label);
    hitStrip.append(dot);
  });
}

function updateHud() {
  const level = currentLevel();
  levelLabel.textContent = `Level ${levelIndex + 1}`;
  bpmValue.textContent = level.bpm;
  phaseValue.textContent = getPhase();
  accuracyValue.textContent = `${getAccuracy()}%`;
  scoreValue.textContent = running ? runScore + score : runScore || score;
  beatCore.classList.toggle("silent", running && getPhase() === "Silent");
}

function draw() {
  resizeCanvas();
  const width = canvas.width;
  const height = canvas.height;
  const now = audioContext ? audioContext.currentTime : 0;
  const beatSec = secondsPerBeat();
  const visibleWindow = beatSec * 8;
  const centerY = height * 0.56;

  ctx.clearRect(0, 0, width, height);
  drawLane(width, height, centerY);

  scheduledBeats.forEach((beat) => {
    const x = width * 0.5 + ((beat.time - now) / visibleWindow) * width;
    if (x < -20 || x > width + 20) return;
    const radius = beat.index % beatsPerBar === 0 ? 16 : 11;
    ctx.beginPath();
    ctx.fillStyle = beat.countIn ? "#f5f7fb" : beat.silent ? "#f7c948" : "#35d6a6";
    ctx.globalAlpha = beat.judged ? 0.24 : 0.95;
    ctx.arc(x, centerY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (Math.abs(beat.time - now) < 0.035 && beat.time !== lastPulseAt) {
      lastPulseAt = beat.time;
      beatCore.classList.add("pulse");
      window.setTimeout(() => beatCore.classList.remove("pulse"), 90);
    }
  });

  animationId = window.requestAnimationFrame(draw);
}

function drawLane(width, height, centerY) {
  ctx.fillStyle = "#12161c";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#38414d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, centerY);
  ctx.lineTo(width, centerY);
  ctx.stroke();

  ctx.strokeStyle = "#f5f7fb";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(width / 2, centerY - 58);
  ctx.lineTo(width / 2, centerY + 58);
  ctx.stroke();

  ctx.fillStyle = "#aab2c0";
  ctx.font = "700 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("TAP LINE", width / 2, centerY + 82);
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(rect.width * scale));
  const height = Math.max(260, Math.floor(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function nextLevel() {
  if (levelIndex < levels.length - 1) {
    baseRunScore = runScore;
    levelIndex += 1;
    startLevel();
  }
}

function getPlayerId() {
  let playerId = localStorage.getItem(playerIdKey);
  if (!playerId) {
    playerId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem(playerIdKey, playerId);
  }
  return playerId;
}

let serverAvailable = false;

function loadLeaderboard() {
  try {
    return JSON.parse(localStorage.getItem(leaderboardKey)) || [];
  } catch {
    return [];
  }
}

function saveLeaderboard(entries) {
  localStorage.setItem(leaderboardKey, JSON.stringify(entries));
}

async function fetchLeaderboardFromServer() {
  try {
    const response = await fetch(leaderboardApiPath, { cache: "no-store" });
    if (!response.ok) throw new Error("Server response not OK");
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error("Invalid leaderboard format");
    serverAvailable = true;
    return entries;
  } catch {
    serverAvailable = false;
    return null;
  }
}

async function postLeaderboardToServer(entries) {
  try {
    const response = await fetch(leaderboardApiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entries)
    });
    if (!response.ok) throw new Error("Server save failed");
    serverAvailable = true;
    return true;
  } catch {
    serverAvailable = false;
    return false;
  }
}

async function saveLeaderboardMaybeServer(entries) {
  const savedOnServer = await postLeaderboardToServer(entries);
  saveLeaderboard(entries);
  return savedOnServer;
}

function mergeLeaderboardEntries(primary, fallback) {
  const merged = new Map(primary.map((entry) => [entry.playerId, entry]));
  for (const entry of fallback) {
    const existing = merged.get(entry.playerId);
    if (!existing || compareEntries(entry, existing) < 0) {
      merged.set(entry.playerId, entry);
    }
  }
  return Array.from(merged.values());
}

async function loadLeaderboardMaybeServer() {
  const localEntries = loadLeaderboard();
  const serverEntries = await fetchLeaderboardFromServer();
  if (serverEntries) {
    let mergedEntries = serverEntries;
    if (localEntries.length) {
      mergedEntries = mergeLeaderboardEntries(serverEntries, localEntries);
      if (mergedEntries.length !== serverEntries.length || mergedEntries.some((entry, index) => entry.playerId !== serverEntries[index]?.playerId || compareEntries(entry, serverEntries[index]) !== 0)) {
        await saveLeaderboardMaybeServer(mergedEntries);
      }
    }
    saveLeaderboard(mergedEntries);
    return mergedEntries;
  }
  return localEntries;
}

function compareEntries(a, b) {
  return b.score - a.score || b.level - a.level || b.accuracy - a.accuracy || a.finishedAt - b.finishedAt;
}

function rankEntries(entries) {
  return [...entries].sort(compareEntries).map((entry, index) => ({ ...entry, rank: index + 1 }));
}

async function saveScore(event) {
  event.preventDefault();
  if (!pendingResult) return;

  const name = playerNameInput.value.trim() || "Player";
  const playerId = getPlayerId();
  const entries = loadLeaderboard();
  const existingIndex = entries.findIndex((entry) => entry.playerId === playerId);
  let saved = false;
  const nextEntry = {
    ...pendingResult,
    playerId,
    name
  };

  localStorage.setItem(playerNameKey, name);

  if (existingIndex === -1 || compareEntries(nextEntry, entries[existingIndex]) < 0) {
    if (existingIndex === -1) {
      entries.push(nextEntry);
    } else {
      entries[existingIndex] = nextEntry;
    }
    saved = await saveLeaderboardMaybeServer(entries);
  }

  renderLeaderboard();
  showSavedRank(saved);
  saveScoreButton.disabled = true;
}

function showSavedRank(saved) {
  const playerId = getPlayerId();
  const playerEntry = rankEntries(loadLeaderboard()).find((entry) => entry.playerId === playerId);
  if (!playerEntry) return;

  rankMessage.textContent = saved
    ? `Saved at #${playerEntry.rank}: ${playerEntry.score} points, level ${playerEntry.level}, ${playerEntry.accuracy}% accuracy.`
    : `Your saved best stays #${playerEntry.rank}: ${playerEntry.score} points, level ${playerEntry.level}, ${playerEntry.accuracy}% accuracy.`;
}

function updateRankPreview() {
  if (!pendingResult) return;
  const playerId = getPlayerId();
  const name = playerNameInput.value.trim() || localStorage.getItem(playerNameKey) || "Player";
  const simulated = loadLeaderboard().filter((entry) => entry.playerId !== playerId);
  const ranked = rankEntries([...simulated, { ...pendingResult, playerId, name }]);
  const playerEntry = ranked.find((entry) => entry.playerId === playerId);
  rankMessage.textContent = `This run ranks #${playerEntry.rank}: ${pendingResult.score} points, level ${pendingResult.level}, ${pendingResult.accuracy}% accuracy.`;
}

let lastTapInputAt = 0;
const tapInputDebounceMs = 150;

function handleTapInput(event) {
  event.preventDefault();
  if (levelFinished) return; // ignore taps once level has finished
  const now = performance.now();
  if (now - lastTapInputAt < tapInputDebounceMs) return;
  lastTapInputAt = now;
  tap();
}

function renderLeaderboard() {
  const playerId = getPlayerId();
  const ranked = rankEntries(loadLeaderboard());
  const topTen = ranked.slice(0, 10);
  const playerEntry = ranked.find((entry) => entry.playerId === playerId);

  leaderboardList.innerHTML = "";

  if (!ranked.length) {
    const empty = document.createElement("li");
    empty.className = "leaderboard-empty";
    empty.textContent = "No scores saved yet.";
    leaderboardList.append(empty);
    return;
  }

  topTen.forEach((entry) => leaderboardList.append(createLeaderboardItem(entry, entry.playerId === playerId)));

  if (playerEntry && playerEntry.rank > 10) {
    const divider = document.createElement("li");
    divider.className = "leaderboard-divider";
    divider.textContent = `Your current rank is #${playerEntry.rank}`;
    leaderboardList.append(divider);
    leaderboardList.append(createLeaderboardItem(playerEntry, true));
  }
}

function createLeaderboardItem(entry, currentPlayer) {
  const item = document.createElement("li");
  item.className = currentPlayer ? "leaderboard-item current-player" : "leaderboard-item";
  item.innerHTML = `
    <span class="rank">#${entry.rank}</span>
    <strong>${escapeHtml(entry.name)}</strong>
    <span>${entry.score} pts</span>
    <span>Level ${entry.level}</span>
    <span>${entry.accuracy}%</span>
  `;
  return item;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

startButton.addEventListener("click", startLevel);
tapButton.addEventListener("click", handleTapInput);
tapButton.addEventListener("touchstart", handleTapInput, { passive: false });
nextButton.addEventListener("click", nextLevel);
scoreForm.addEventListener("submit", saveScore);
playerNameInput.addEventListener("input", updateRankPreview);
window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    tap();
  }
});
window.addEventListener("resize", () => {
  resizeCanvas();
  if (!running) drawLane(canvas.width, canvas.height, canvas.height * 0.56);
});

renderHitStrip();
playerNameInput.value = localStorage.getItem(playerNameKey) || "";
loadLeaderboardMaybeServer().then(() => renderLeaderboard());
updateHud();
resizeCanvas();
drawLane(canvas.width, canvas.height, canvas.height * 0.56);
