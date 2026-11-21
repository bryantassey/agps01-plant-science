"use strict";

const CARDS = 10;
const TURN_MS = 300_000;
const TABLETOP_TAP_GAP_MS = 425;
const app = document.querySelector("#app");
let screenName = "welcome";
let mode = "motion";
let modePickerReturn = setup;
let nextTabletopTap = 0;
let players = [];
let drafts = ["", "", "", ""];
let count = 4;
let playerIndex = 0;
let queue = [];
let deadline = 0;
let ticker;
let previousSeconds;
let turnMessage = "";
let wakeLock;
let wakePending = false;
let audio;
let motionEnabled = false;
let neutral = null;
let recent = [];
let armed = false;
let gestureStart = 0;
let gestureSign = 0;
let calibration = 0;
let motionFeedback = "";

const current = () => players[playerIndex];
const get = (id) => document.getElementById(id);
const modeLabel = () => mode === "motion" ? "Motion Mode" : "Tabletop Mode";
const safe = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function deal(playerCount, bank = VOCABULARY) {
  const used = new Set();
  const categories = Object.values(bank).map((terms) => shuffle(terms.filter((term) => {
    const key = term.trim().toLowerCase();
    if (!key || used.has(key)) return false;
    used.add(key);
    return true;
  })));
  if (categories.length !== 6 || categories.some((terms) => terms.length < playerCount * 2)) {
    throw new Error("The vocabulary needs six categories with at least eight unique terms each.");
  }
  const rotation = shuffle([0, 1, 2, 3, 4, 5]);
  return Array.from({ length: playerCount }, (_, player) => {
    const singles = new Set([rotation[player * 2 % 6], rotation[(player * 2 + 1) % 6]]);
    return shuffle(categories.flatMap((terms, i) => terms.splice(0, singles.has(i) ? 1 : 2)));
  });
}

function show(name, html) {
  if (screenName === "playing") app.querySelector("dialog[open]")?.close();
  screenName = name;
  document.documentElement.classList.toggle("in-play", name === "playing");
  app.innerHTML = html;
  const heading = app.querySelector("h1");
  heading.tabIndex = -1;
  heading.focus();
}

function chooseMode(returnTo) {
  modePickerReturn = returnTo;
  show("mode", `<section class="panel">
    <p class="eyebrow">Plant Propagation Heads Up!</p>
    <h1>How Would You Like to Play?</h1>
    <div class="mode-options">
      <button class="mode-option" data-action="choose-motion">
        <strong>Motion Mode</strong>
        <span>Hold the phone at your forehead with the screen facing teammates. Tilt down for Correct and up for Pass.</span>
        <span class="mode-requirement">Uses motion permission and calibration</span>
      </button>
      <button class="mode-option" data-action="choose-tabletop">
        <strong>Tabletop Mode</strong>
        <span>Put the phone on the table facing your teammates. The guesser looks away while teammates give clues and tap Correct or Pass.</span>
        <span class="mode-requirement">Plays with touch alone</span>
      </button>
    </div>
    ${returnTo === handoff ? '<div class="actions"><button class="secondary" data-action="handoff">Back to handoff</button></div>' : ""}
  </section>`);
}

function setMode(nextMode) {
  if (mode !== nextMode) {
    calibration++;
    neutral = null;
    recent = [];
    armed = false;
    gestureSign = 0;
    motionFeedback = "";
    mode = nextMode;
    if (mode === "tabletop") window.removeEventListener("deviceorientation", readMotion);
    else if (motionEnabled) window.addEventListener("deviceorientation", readMotion);
  }
}

function selectMode(nextMode) {
  setMode(nextMode);
  modePickerReturn();
}

function setup() {
  clearInterval(ticker);
  releaseWake();
  calibration++;
  show("setup", `<section class="panel">
    <p class="eyebrow">Player setup · ${modeLabel()}</p><h1>Who’s at your table?</h1>
    <p>Enter each player’s first name and last initial.</p>
    <form id="players" autocomplete="off">
      <label>Number of players<select id="count">${[2, 3, 4].map((n) =>
        `<option ${n === count ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <div id="names" class="fields"></div>
      <p id="setup-error" role="alert"></p>
      <div class="actions"><button class="primary">Continue →</button>
      <button class="secondary" type="button" data-action="modes">Change mode</button></div>
    </form>
  </section>`);
  showNames();
}

function showNames() {
  get("names").innerHTML = drafts.slice(0, count).map((name, i) =>
    `<label>Player ${i + 1}<input name="player${i}" maxlength="32" required placeholder="First name and last initial" value="${safe(name)}"></label>`).join("");
}

function motionPanel() {
  let status = "Touch controls are always available.";
  if (motionEnabled) status = neutral === null ? "Hold the phone at your forehead and calibrate." : "Motion ready. Return to this position after each tilt.";
  return `<div class="motion"><strong>Set up tilt controls</strong>
    <p id="motion-status" class="note" role="status">${status}</p>
    <div class="actions"><button class="secondary" data-action="enable">${motionEnabled ? "Enable motion again" : "Enable motion"}</button>
    <button class="secondary" id="calibrate" data-action="calibrate" ${motionEnabled ? "" : "disabled"}>Calibrate</button></div></div>`;
}

function instructions() {
  const directions = mode === "motion"
    ? `<li>Hold the phone upright against your forehead, screen facing your teammates.</li>
       <li>Tilt the display down for <strong>Correct</strong> or up for <strong>Pass</strong>. Return to neutral after each tilt. You can also score through <strong>Controls</strong>.</li>`
    : `<li>Place the phone on the table where teammates can read it. The guesser sits or stands where they can’t see the screen.</li>
       <li>One teammate taps <strong>Correct</strong> for a solved term or <strong>Pass</strong> to come back to it.</li>`;
  show("instructions", `<section class="panel"><p class="eyebrow">How to play · ${modeLabel()}</p><h1>Give clues. Guess terms.</h1>
    <ol>${directions}<li>Teammates give clues without saying the term or any part of it.</li>
    <li>Solve ten terms in five minutes. Passed terms come back. Take turns until everyone has played.</li></ol>
    ${mode === "motion" ? motionPanel() : ""}<div class="actions"><button class="primary" data-action="start">Start Game</button>
    <button class="secondary" data-action="setup">Back</button></div></section>`);
}

function unlockAudio() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio) {
      audio ||= new Audio();
      audio.resume().catch(() => {});
    }
  } catch { /* The on-screen signals are always available. */ }
}

function signal(frequencies) {
  if (!audio || audio.state !== "running") return;
  frequencies.forEach((frequency, i) => {
    const time = audio.currentTime + i * .2;
    const oscillator = audio.createOscillator();
    const volume = audio.createGain();
    oscillator.frequency.value = frequency;
    volume.gain.setValueAtTime(.12, time);
    volume.gain.exponentialRampToValueAtTime(.001, time + .16);
    oscillator.connect(volume).connect(audio.destination);
    oscillator.start(time);
    oscillator.stop(time + .18);
  });
}

async function keepAwake() {
  if (!navigator.wakeLock || wakeLock || wakePending || document.hidden) return;
  wakePending = true;
  try {
    const lock = await navigator.wakeLock.request("screen");
    if (!["countdown", "playing"].includes(screenName)) {
      await lock.release();
      return;
    }
    wakeLock = lock;
    lock.addEventListener("release", () => { if (wakeLock === lock) wakeLock = null; });
  } catch { /* Browser or battery settings may decline the lock. */ }
  finally { wakePending = false; }
}

function releaseWake() {
  const lock = wakeLock;
  wakeLock = null;
  lock?.release().catch(() => {});
}

function startTurn() {
  unlockAudio();
  calibration++;
  armed = false;
  gestureSign = 0;
  show("countdown", `<section class="panel center"><p class="eyebrow">Player ${playerIndex + 1} of ${players.length}</p>
    <h1>Get ready, ${safe(current().name)}</h1><output id="countdown" class="count" aria-live="polite">3</output>
    <p>${mode === "motion" ? "Hold the phone steady with the screen facing your teammates." : "Put the phone on the table. Guesser, look away from the screen."}</p></section>`);
  keepAwake();
  const readyAt = performance.now() + 3000;
  ticker = setInterval(() => {
    const seconds = Math.ceil((readyAt - performance.now()) / 1000);
    if (seconds <= 0) {
      if (document.hidden) return;
      clearInterval(ticker);
      playTurn();
    } else if (get("countdown").textContent !== String(seconds)) {
      get("countdown").textContent = seconds;
    }
  }, 50);
}

function playTurn() {
  queue = current().cards.map((term) => ({ term, passed: false }));
  nextTabletopTap = 0;
  deadline = performance.now() + TURN_MS;
  previousSeconds = 301;
  renderTurn();
  ticker = setInterval(updateTime, 100);
}

function renderTurn() {
  const motion = mode === "motion";
  show("playing", `<section class="panel card ${motion ? "" : "tabletop-card"}">
    <div class="card-header"><span>${safe(current().name)} · <span id="score">0</span>/10 correct</span>
    <span id="clock" class="clock" role="timer" aria-label="Time remaining">5:00</span></div>
    <div id="warning" role="status"></div>
    <h1 class="term" id="term" aria-live="polite"></h1>
    <p id="card-status" class="note" role="status"></p>
    ${motion ? `<p id="tilt-notice" class="note" role="status"></p>
      <button class="secondary controls-toggle" id="controls-toggle" aria-haspopup="dialog">Controls</button>`
      : `<div class="tabletop-actions">
        <button class="correct" data-action="table-correct">Correct</button>
        <button class="pass" data-action="table-pass">Pass</button>
      </div><button class="secondary controls-toggle" data-action="switch-mode" aria-haspopup="dialog">Change mode</button>`}
  </section>
  ${motion ? `<dialog id="controls-menu" class="controls-menu" aria-labelledby="controls-title">
    <h2 id="controls-title">Controls</h2>
    <p class="note">The turn timer keeps running.</p>
    <div class="controls-actions">
      <button class="correct" data-action="correct">Correct</button>
      <button class="pass" data-action="pass">Pass</button>
      <button class="secondary" id="calibrate" data-action="calibrate" ${motionEnabled ? "" : "disabled"}>Recalibrate</button>
      <button class="secondary" data-action="resume" autofocus>Resume</button>
    </div>
    <p id="motion-status" class="note" role="status"></p>
    <div class="actions">
      ${motionEnabled ? "" : '<button class="secondary" data-action="enable">Enable motion</button>'}
      <button class="secondary" data-action="switch-mode">Change mode</button>
    </div>
  </dialog>` : ""}
  <dialog id="switch-menu" class="controls-menu" aria-labelledby="switch-title">
    <h2 id="switch-title">Switch to ${motion ? "Tabletop Mode" : "Motion Mode"}?</h2>
    <p class="note">Your cards and score stay in place. The timer keeps running.</p>
    ${motion ? "" : '<p class="note">Open Controls after switching to enable and calibrate tilt.</p>'}
    <div class="actions">
      <button class="secondary" data-action="cancel-switch" autofocus>Keep playing</button>
      <button class="primary" data-action="confirm-switch">Switch mode</button>
    </div>
  </dialog>`);
  if (motion) {
    bindControls();
    if (neutral === null) get("tilt-notice").textContent = "Open Controls to set up tilt.";
  }
  showCard();
  updateTime(true);
}

function bindControls() {
  const toggle = get("controls-toggle");
  const menu = get("controls-menu");
  let press;
  let cleanRelease = false;
  toggle.addEventListener("pointerdown", (event) => {
    cleanRelease = false;
    press = event.isPrimary && event.button === 0
      ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  });
  toggle.addEventListener("pointermove", (event) => {
    if (press?.id === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) press = null;
  });
  toggle.addEventListener("pointercancel", () => { press = null; });
  toggle.addEventListener("pointerleave", () => { press = null; });
  toggle.addEventListener("pointerup", (event) => {
    const bounds = toggle.getBoundingClientRect();
    cleanRelease = press?.id === event.pointerId &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 10 &&
      event.clientX >= bounds.left && event.clientX <= bounds.right &&
      event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    press = null;
  });
  toggle.addEventListener("click", (event) => {
    // Keyboard and assistive technology can activate the native button directly.
    if (event.detail !== 0 && !cleanRelease) return;
    cleanRelease = false;
    armed = false;
    gestureSign = 0;
    get("motion-status").textContent = motionFeedback || (motionEnabled
      ? (neutral === null ? "Hold the phone upright at your forehead, then choose Recalibrate." : "Tilt is calibrated.")
      : "Touch controls are ready.");
    menu.showModal();
  });
  menu.addEventListener("cancel", (event) => {
    event.preventDefault();
    resumePlay();
  });
}

function resumePlay() {
  calibration++;
  armed = false;
  gestureSign = 0;
  motionFeedback = "";
  get("controls-menu").close();
}

function touchAnswer(correct) {
  resumePlay();
  answer(correct);
}

function tabletopAnswer(correct) {
  const now = performance.now();
  if (now < nextTabletopTap) return;
  nextTabletopTap = now + TABLETOP_TAP_GAP_MS;
  answer(correct);
}

function openModeSwitch() {
  if (mode === "motion") resumePlay();
  get("switch-menu").showModal();
}

function confirmModeSwitch() {
  if (performance.now() >= deadline) {
    endTurn(true);
    return;
  }
  setMode(mode === "motion" ? "tabletop" : "motion");
  nextTabletopTap = performance.now() + TABLETOP_TAP_GAP_MS;
  renderTurn();
}

function showCard() {
  get("term").textContent = queue[0].term;
  get("score").textContent = current().score;
  const cardNote = queue[0].passed ? "Retry · passed earlier" : "Give clues without saying the term.";
  get("card-status").textContent = mode === "tabletop" ? `${queue.length} of 10 left · ${cardNote}` : cardNote;
}

function updateTime(refresh = false) {
  const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
  if (!left) {
    endTurn(true);
    return;
  }
  if (!refresh && left === previousSeconds) return;
  if (left <= 30) {
    get("warning").textContent = "30 seconds or less!";
    get("clock").classList.add("urgent");
    if (previousSeconds > 30) signal([740, 740]);
  }
  previousSeconds = left;
  get("clock").textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

function answer(correct) {
  if (screenName !== "playing") return;
  if (performance.now() >= deadline) {
    endTurn(true);
    return;
  }
  armed = false;
  gestureSign = 0;
  const card = queue.shift();
  if (correct) current().score++;
  else queue.push({ term: card.term, passed: true });
  if (queue.length) showCard();
  else endTurn(false);
}

function endTurn(expired) {
  clearInterval(ticker);
  releaseWake();
  calibration++;
  const player = current();
  turnMessage = expired ? `Time’s up for ${player.name}.` : `${player.name} solved all ten terms!`;
  signal(expired ? [660, 510, 390] : [520, 660, 790]);
  playerIndex++;
  if (playerIndex === players.length) {
    results();
    return;
  }
  handoff();
}

function handoff() {
  show("handoff", `<section class="panel"><p class="eyebrow">${safe(turnMessage)} · ${players[playerIndex - 1].score}/10 correct</p>
    <h1>Great job! Pass the phone to Player ${playerIndex + 1}.</h1>
    <p>${safe(current().name)}, your turn is set to <strong>${modeLabel()}</strong>. Start when you’re ready.</p>
    ${mode === "motion" ? motionPanel() : ""}<div class="actions"><button class="primary" data-action="start">Start turn</button>
    <button class="secondary" data-action="handoff-modes">Change mode</button>
    <button class="secondary" data-action="restart">Restart game</button></div></section>`);
}

function summary() {
  const total = players.reduce((sum, player) => sum + player.score, 0);
  const possible = players.length * CARDS;
  return { total, possible, accuracy: Math.round(total * 1000 / possible) / 10, missed: possible - total };
}

function results() {
  const { total, possible, accuracy, missed } = summary();
  show("results", `<section class="panel results"><p class="eyebrow">Merced College – AGPS-01</p>
    <h1>Week 14 – Plant Propagation Heads Up!</h1>
    <p class="note">${safe(turnMessage)}</p>
    <table><thead><tr><th scope="col">Player</th><th scope="col">Score</th></tr></thead>
    <tbody>${players.map(({ name, score }) => `<tr><th scope="row">${safe(name)}</th><td>${score}/10</td></tr>`).join("")}</tbody></table>
    <div class="metrics"><div><strong>${total}/${possible}</strong>Team score</div>
    <div><strong>${accuracy}%</strong>Team accuracy</div><div><strong>${missed}</strong>Missed terms</div></div>
    <p class="submit-note note">Each player uploads a copy to Canvas Lecture Participation. Credit is based on completion.</p>
    <div class="actions"><button class="primary" data-action="download">Download results image</button>
    <button class="secondary" data-action="new">New Game</button></div><p class="note" id="download-status" role="status"></p></section>`);
}

function download() {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 458 + 60 * players.length;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    get("download-status").textContent = "Image export is unavailable. Take a screenshot of this screen.";
    return;
  }
  const { total, possible, accuracy, missed } = summary();
  ctx.fillStyle = "#fffdf6";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#10283d";
  ctx.fillRect(0, 0, 960, 208);
  ctx.fillStyle = "#f2ca69";
  ctx.font = "bold 28px system-ui";
  ctx.fillText("MERCED COLLEGE – AGPS-01", 50, 63);
  ctx.fillStyle = "#fffdf6";
  ctx.font = "bold 45px Georgia";
  ctx.fillText("Week 14 – Plant Propagation", 50, 126);
  ctx.fillText("Heads Up!", 50, 179);
  players.forEach(({ name, score }, i) => {
    const y = 265 + i * 60;
    ctx.fillStyle = "#17334a";
    ctx.font = "bold 31px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(name, 50, y, 680);
    ctx.textAlign = "right";
    ctx.fillText(score + "/10", 910, y);
    ctx.fillStyle = "#d6e0d5";
    ctx.fillRect(50, y + 13, 860, 2);
  });
  const y = 248 + players.length * 60;
  ctx.fillStyle = "#174936";
  ctx.fillRect(50, y, 860, 110);
  ctx.fillStyle = "#fffdf6";
  ctx.textAlign = "left";
  ctx.font = "bold 30px system-ui";
  ctx.fillText(`Team score ${total}/${possible}   ·   Accuracy ${accuracy}%`, 74, y + 44);
  ctx.fillText(`Missed terms ${missed}`, 74, y + 85);
  ctx.fillStyle = "#17334a";
  ctx.font = "24px system-ui";
  ctx.fillText("Canvas Lecture Participation · Week 14", 50, y + 163);
  const link = document.createElement("a");
  link.download = "AGPS-01-week-14-results.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
  get("download-status").textContent = "If the image opens in your browser, use its save or share menu.";
}

function setMotionStatus(message) {
  const status = get("motion-status");
  if (status) status.textContent = message;
}

async function enableMotion() {
  if (mode !== "motion") return;
  const Orientation = window.DeviceOrientationEvent;
  if (!Orientation || !window.isSecureContext) {
    setMotionStatus("Motion is unavailable here. Use the Correct and Pass buttons.");
    return;
  }
  try {
    if (typeof Orientation.requestPermission === "function" &&
        await Orientation.requestPermission() !== "granted") {
      setMotionStatus("Motion permission was declined. Use the Correct and Pass buttons.");
      return;
    }
    motionEnabled = true;
    if (mode !== "motion") return;
    window.addEventListener("deviceorientation", readMotion);
    if (get("calibrate")) get("calibrate").disabled = false;
    setMotionStatus("Hold the phone upright at your forehead, then tap Calibrate.");
  } catch {
    setMotionStatus("Could not enable motion. Use the Correct and Pass buttons.");
  }
}

function orientationChanged() {
  if (mode !== "motion") return;
  calibration++;
  neutral = null;
  recent = [];
  armed = false;
  gestureSign = 0;
  if (motionEnabled) {
    motionFeedback = screenName === "playing"
      ? "Phone rotated. Choose Recalibrate in Controls to use tilt."
      : "Phone rotated. Recalibrate to use tilt.";
    setMotionStatus(motionFeedback);
    if (screenName === "playing") get("tilt-notice").textContent = motionFeedback;
  }
}

function calibrate() {
  if (mode !== "motion" || !motionEnabled) return;
  const attempt = ++calibration;
  recent = [];
  armed = false;
  gestureSign = 0;
  setMotionStatus("Hold still with the display facing your teammates…");
  setTimeout(() => {
    if (attempt !== calibration) return;
    if (recent.length < 3) {
      setMotionStatus("No usable motion signal. Use the buttons or try again.");
      return;
    }
    const samples = recent.map(({ pitch }) => pitch);
    const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    if (Math.max(...samples) - Math.min(...samples) > 10 || Math.abs(average) > 35) {
      setMotionStatus("Hold the screen upright and steady, then try Calibrate again.");
      return;
    }
    neutral = average;
    motionFeedback = "Motion ready. Return to neutral after each tilt.";
    setMotionStatus(motionFeedback);
    if (screenName === "playing") get("tilt-notice").textContent = "";
  }, 850);
}

function readMotion({ beta, gamma }) {
  if (mode !== "motion" || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
  const now = performance.now();
  // Component of the screen-facing normal along world up. This axis is
  // independent of whether the player holds the phone in portrait or landscape.
  const rad = Math.PI / 180;
  const pitch = Math.asin(Math.cos(beta * rad) * Math.cos(gamma * rad)) / rad;
  recent.push({ pitch, now });
  while (recent[0].now < now - 420) recent.shift();
  if (screenName !== "playing" || app.querySelector("dialog[open]") || neutral === null || document.hidden) return;
  const delta = pitch - neutral;
  if (Math.abs(delta) < 10) armed = true;
  const sign = Math.abs(delta) >= 27 ? Math.sign(delta) : 0;
  if (!armed || sign === 0) {
    gestureSign = 0;
    return;
  }
  if (sign !== gestureSign) {
    gestureSign = sign;
    gestureStart = now;
  } else if (now - gestureStart >= 100) {
    answer(sign < 0);
  }
}

function restart(clearNames) {
  if (!clearNames && !window.confirm("Restart the game? Current scores will be cleared.")) return;
  players = [];
  queue = [];
  playerIndex = 0;
  if (clearNames) {
    drafts = ["", "", "", ""];
    count = 4;
  }
  if (clearNames) chooseMode(setup);
  else setup();
}

app.addEventListener("input", (event) => {
  const match = /^player([0-3])$/.exec(event.target.name || "");
  if (match) drafts[Number(match[1])] = event.target.value;
});
app.addEventListener("change", (event) => {
  if (event.target.id !== "count") return;
  count = Number(event.target.value);
  showNames();
});
app.addEventListener("submit", (event) => {
  if (event.target.id !== "players") return;
  event.preventDefault();
  const names = drafts.slice(0, count).map((name) => name.trim().replace(/\s+/g, " "));
  const invalid = names.findIndex((name) => !/^.+\s\p{L}\.?$/u.test(name));
  if (invalid >= 0) {
    get("setup-error").textContent = `Enter a first name and last initial for Player ${invalid + 1} (for example, Sam R.).`;
    get("names").children[invalid].querySelector("input").focus();
    return;
  }
  try {
    const decks = deal(count);
    players = names.map((name, i) => ({ name, cards: decks[i], score: 0 }));
    playerIndex = 0;
    instructions();
  } catch (error) {
    get("setup-error").textContent = error.message;
  }
});
app.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (screenName === "playing") {
    const menu = app.querySelector("dialog[open]");
    if (menu && !menu.contains(button)) return;
    if (!menu && mode === "motion") return;
  }
  const actions = {
    modes: () => chooseMode(setup), "handoff-modes": () => chooseMode(handoff), handoff,
    "choose-motion": () => selectMode("motion"), "choose-tabletop": () => selectMode("tabletop"),
    setup, enable: enableMotion, calibrate, start: startTurn,
    correct: () => touchAnswer(true), pass: () => touchAnswer(false), resume: resumePlay,
    "table-correct": () => tabletopAnswer(true), "table-pass": () => tabletopAnswer(false),
    "switch-mode": openModeSwitch, "cancel-switch": () => get("switch-menu").close(),
    "confirm-switch": confirmModeSwitch,
    download, restart: () => restart(false), new: () => restart(true)
  };
  actions[button.dataset.action]?.();
});
app.addEventListener("contextmenu", (event) => {
  if (screenName === "playing") event.preventDefault();
});
if (window.screen.orientation?.addEventListener) {
  window.screen.orientation.addEventListener("change", orientationChanged);
} else {
  window.addEventListener("orientationchange", orientationChanged);
}
document.addEventListener("visibilitychange", () => {
  armed = false;
  gestureSign = 0;
  if (document.hidden) return;
  if (screenName === "playing") updateTime();
  if (["countdown", "playing"].includes(screenName)) keepAwake();
});
