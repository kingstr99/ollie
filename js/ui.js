// Hexhaven — rendering, online lobbies (claude.ai artifact db) and one-device play.
'use strict';

const SAVE_KEY = 'hexhaven-local-v2';
const TAB_ID = Math.random().toString(36).slice(2, 8);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let S = null;        // current game state (unpacked), or null
let local = false;   // true = one-device game, false = online game
const ui = { view: 'home', mode: null, modal: null, winSeen: false, nick: '', joinCode: '' };
const net = {
  db: null, user: null, uid: null, canWrite: null, checked: false, reason: '',
  games: [], gamesState: 'loading', gameId: null, game: null, unsubGame: null, busy: false, error: '',
};

const $ = (sel) => document.querySelector(sel);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ======================= STATE PACKING =======================
// The static board is regenerated from (mapKey, seed); only pieces and the storm are stored.
function pack(s) {
  const b = s.board;
  const buildings = {};
  const roads = {};
  b.vertices.forEach((v) => { if (v.building) buildings[v.id] = v.building; });
  b.edges.forEach((e) => { if (e.road !== null) roads[e.id] = e.road; });
  const { board, ...rest } = s;
  return clone({ ...rest, board: { mapKey: b.mapKey, seed: b.seed, storm: b.storm, buildings, roads } });
}
function unpack(p) {
  const s = clone(p);
  const b = generateBoard(s.board.mapKey, s.board.seed);
  b.storm = s.board.storm;
  Object.entries(s.board.buildings || {}).forEach(([v, bl]) => { b.vertices[v].building = bl; });
  Object.entries(s.board.roads || {}).forEach(([e, p2]) => { b.edges[e].road = p2; });
  s.board = b;
  if (s.offer === undefined) s.offer = null;
  return s;
}

// ======================= LOCAL STORAGE =======================
function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storeSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* unavailable */ } }
function saveLocal() { if (local && S) storeSet(SAVE_KEY, JSON.stringify(pack(S))); }
function loadLocal() {
  try { const p = JSON.parse(storeGet(SAVE_KEY)); return p && p.phase !== 'over' ? p : null; } catch (e) { return null; }
}

// ======================= WHO CONTROLS WHAT =======================
function mySeat() {
  if (local || !net.game) return -1;
  return (net.game.seats || []).findIndex((s) => s.uid === net.uid);
}
const controls = (p) => local || (p >= 0 && mySeat() === p);
const handOwner = () => (local ? S.cur : mySeat());

// Every action runs as fn(state, rng). Random numbers are drawn once so the
// optimistic local run and the saved run agree.
async function act(fn) {
  if (!S) return;
  const vals = Array.from({ length: 8 }, Math.random);
  const mkRng = () => { let i = 0; return () => vals[i++ % vals.length]; };
  if (local) { if (fn(S, mkRng())) saveLocal(); render(); return; }
  const trial = unpack(pack(S));
  if (!fn(trial, mkRng())) { render(); return; }
  S = trial;
  render();
  await mutate((g) => {
    if (!g.state) return false;
    const st = unpack(g.state);
    if (!fn(st, mkRng())) return false;
    g.state = pack(st);
    g.status = st.phase === 'over' ? 'over' : 'playing';
    return true;
  });
}

// Read-modify-write of the current online game doc under a short lease.
async function mutate(fn) {
  const ref = net.db.doc('games/' + net.gameId);
  net.busy = true; net.error = '';
  renderStatus();
  try {
    let got = false;
    for (let i = 0; i < 30 && !got; i++) {
      const r = await ref.acquire({ holder: net.uid + '.' + TAB_ID, ttlMs: 1000 });
      got = r.acquired;
      if (!got) await sleep(150 + Math.random() * 250);
    }
    if (!got) throw { message: 'Another player is saving a move. Try again in a moment.' };
    const snap = await ref.get();
    if (!snap.exists) throw { message: 'This game no longer exists.' };
    const g = clone(snap.data());
    if (fn(g)) {
      g.rev = (g.rev || 0) + 1;
      g.updatedAt = Date.now();
      await ref.set(g);
    }
    applyGame(g);
  } catch (e) {
    net.error = friendlyError(e);
    if (net.game) applyGame(net.game);
  } finally {
    net.busy = false;
    render();
  }
}

function friendlyError(e) {
  const code = e && e.code;
  if (code === 'invalid_argument') return 'Your access to this page is view-only, so you can watch but not play. Ask the owner to invite you as an Editor.';
  if (code === 'quota_exceeded') return 'Storage is full. Delete some finished games and try again.';
  if (code === 'revoked') return 'Your access to this page changed. Reload to continue.';
  if (code === 'resource_exhausted') return 'Too many moves at once. Wait a moment and try again.';
  return (e && e.message) || 'Something went wrong. Try again.';
}

function applyGame(g) {
  net.game = g;
  if (g.status === 'lobby' || !g.state) {
    S = null;
    if (ui.view !== 'lobby') { ui.view = 'lobby'; ui.mode = null; }
  } else {
    S = unpack(g.state);
    if (ui.view !== 'game') { ui.view = 'game'; ui.mode = null; ui.winSeen = false; }
  }
}

// ======================= ONLINE: GAMES LIST & LOBBY =======================
async function initNet() {
  if (!(window.claude && typeof window.claude.use === 'function')) {
    net.checked = true; net.reason = 'plain'; render(); return;
  }
  const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
  net.db = db; net.user = user;
  if (user) {
    const me = await user.me();
    net.uid = me.id;
    if (!ui.nick && me.name) ui.nick = me.name.split(' ')[0].slice(0, 16);
    net.canWrite = await user.can('data.write');
  }
  net.checked = true;
  if (!db || !net.uid) { net.reason = 'signin'; net.db = null; render(); return; }
  const timer = setTimeout(() => { if (net.gamesState === 'loading') { net.gamesState = 'slow'; render(); } }, 10000);
  db.collection('games').orderBy('updatedAt', 'desc').limit(40).onSnapshot((snap) => {
    if (!snap.metadata.fromCache) clearTimeout(timer);
    net.games = snap.docs.map((d) => d.data());
    net.gamesState = 'ok';
    if (ui.view === 'home') render();
  }, (err) => { clearTimeout(timer); net.gamesState = 'error'; net.error = friendlyError(err); render(); });
  const m = /^#g-([A-Z0-9]{5})$/.exec(location.hash || '');
  if (m) openGame(m[1]); else render();
}

function openGame(id) {
  if (!net.db) return;
  if (net.unsubGame) net.unsubGame();
  local = false; S = null;
  net.gameId = id; net.game = null; net.error = '';
  ui.view = 'loading'; ui.mode = null; ui.winSeen = false; closeModal();
  try { location.hash = 'g-' + id; } catch (e) { /* ignore */ }
  render();
  const timer = setTimeout(() => { if (!net.game && ui.view === 'loading') { net.error = 'Can’t reach this game yet. Check your connection.'; render(); } }, 10000);
  net.unsubGame = net.db.doc('games/' + id).onSnapshot((snap) => {
    if (net.gameId !== id) return;
    if (!snap.exists) {
      if (!snap.metadata.fromCache) { clearTimeout(timer); goHome(net.game ? 'That game was deleted.' : `No game with code ${id}.`); }
      return;
    }
    clearTimeout(timer);
    const g = clone(snap.data());
    if (net.game && (g.rev || 0) < (net.game.rev || 0)) return;
    if (net.busy && net.game && g.rev === net.game.rev) return;
    applyGame(g);
    render();
  }, (err) => { clearTimeout(timer); net.error = friendlyError(err); render(); });
}

function goHome(msg = '') {
  if (net.unsubGame) { net.unsubGame(); net.unsubGame = null; }
  net.gameId = null; net.game = null; S = null; local = false;
  net.error = msg;
  ui.view = 'home'; ui.mode = null; closeModal();
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  render();
}

const nickname = () => (ui.nick || '').trim().slice(0, 16) || 'Player';

async function createGame() {
  const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const now = Date.now();
  try {
    await net.db.doc('games/' + code).set({
      code, host: net.uid, status: 'lobby', rev: 1, createdAt: now, updatedAt: now,
      config: { mapKey: 'classic', seed: Math.floor(Math.random() * 1e6), target: 10 },
      seats: [{ uid: net.uid, name: nickname() }], state: null,
    });
    openGame(code);
  } catch (e) { net.error = friendlyError(e); render(); }
}

const isHost = () => net.game && net.game.host === net.uid;
const lobbyMutate = (fn) => mutate((g) => g.status === 'lobby' && fn(g));

function joinLobby() {
  lobbyMutate((g) => {
    if (g.seats.some((s) => s.uid === net.uid) || g.seats.length >= 6) return false;
    g.seats.push({ uid: net.uid, name: nickname() });
    return true;
  });
}
function leaveLobby() {
  lobbyMutate((g) => { const n = g.seats.length; g.seats = g.seats.filter((s) => s.uid !== net.uid); return g.seats.length !== n; });
}
function setConfig(patch) {
  if (!isHost()) return;
  lobbyMutate((g) => { if (g.host !== net.uid) return false; Object.assign(g.config, patch); return true; });
}
function startOnline() {
  lobbyMutate((g) => {
    if (g.host !== net.uid || g.seats.length < 2) return false;
    g.seats = shuffle(g.seats.slice(), Math.random);
    const players = g.seats.map((s, i) => ({ name: s.name, color: PLAYER_COLORS[i] }));
    const st = newGame({ players, mapKey: g.config.mapKey, seed: g.config.seed, target: g.config.target });
    log(st, `🎲 Seating order: ${players.map((p) => p.name).join(', ')}.`);
    g.state = pack(st);
    g.status = 'playing';
    return true;
  });
}
async function deleteGame() {
  try { await net.db.doc('games/' + net.gameId).delete(); goHome(); } catch (e) { net.error = friendlyError(e); render(); }
}

// ======================= BOARD SVG =======================
function hexPoints(x, y, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) { const c = hexCorner(x, y, i, size); pts.push(c.x.toFixed(1) + ',' + c.y.toFixed(1)); }
  return pts.join(' ');
}

function boardSVG(board, opt = {}) {
  const all = board.tiles;
  const pad = HEX_SIZE * 1.9;
  const minX = Math.min(...all.map((t) => t.x)) - pad;
  const maxX = Math.max(...all.map((t) => t.x)) + pad;
  const minY = Math.min(...all.map((t) => t.y)) - pad;
  const maxY = Math.max(...all.map((t) => t.y)) + pad;
  const gid = 'sea' + Math.random().toString(36).slice(2, 7);
  const out = [];
  out.push(`<svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Game board">`);
  out.push(`<defs><radialGradient id="${gid}" cx="50%" cy="50%" r="70%"><stop offset="0%" style="stop-color:var(--sea-1)"/><stop offset="100%" style="stop-color:var(--sea-2)"/></radialGradient></defs>`);

  board.water.forEach((w) => out.push(`<polygon class="water" fill="url(#${gid})" points="${hexPoints(w.x, w.y, HEX_SIZE)}"/>`));

  const hintTiles = new Set(opt.hintTiles || []);
  board.tiles.forEach((t) => {
    const info = RES_INFO[t.type];
    const hint = hintTiles.has(t.id);
    out.push(`<g class="tile${hint ? ' hint-tile' : ''}" ${hint ? `data-t="${t.id}"` : ''}>`);
    out.push(`<polygon points="${hexPoints(t.x, t.y, HEX_SIZE - 1.5)}" fill="${info.color}" class="tile-poly"/>`);
    out.push(`<polygon points="${hexPoints(t.x, t.y, HEX_SIZE * 0.8)}" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/>`);
    out.push(`<text x="${t.x}" y="${t.y - 24}" class="tile-icon">${info.icon}</text>`);
    if (t.number) {
      const hot = t.number === 6 || t.number === 8;
      out.push(`<circle cx="${t.x}" cy="${t.y + 8}" r="17" class="token"/>`);
      out.push(`<text x="${t.x}" y="${t.y + 13}" class="token-num${hot ? ' hot' : ''}">${t.number}</text>`);
      const n = pips(t.number);
      for (let i = 0; i < n; i++) {
        out.push(`<circle cx="${t.x + (i - (n - 1) / 2) * 4.5}" cy="${t.y + 19.5}" r="1.5" class="pip${hot ? ' hot' : ''}"/>`);
      }
    }
    if (hint) out.push(`<polygon points="${hexPoints(t.x, t.y, HEX_SIZE - 4)}" class="hint-tile-outline"/>`);
    out.push('</g>');
  });

  board.harbors.forEach((h) => {
    const e = board.edges[h.edge];
    const A = board.vertices[e.a]; const B = board.vertices[e.b];
    const t = board.tiles[h.tile];
    const mx = (A.x + B.x) / 2; const my = (A.y + B.y) / 2;
    const dx = mx - t.x; const dy = my - t.y; const d = Math.hypot(dx, dy);
    const hx = mx + (dx / d) * 30; const hy = my + (dy / d) * 30;
    out.push(`<line x1="${A.x}" y1="${A.y}" x2="${hx}" y2="${hy}" class="pier"/><line x1="${B.x}" y1="${B.y}" x2="${hx}" y2="${hy}" class="pier"/>`);
    out.push(`<circle cx="${hx}" cy="${hy}" r="16" class="harbor"/>`);
    if (h.type === 'any') out.push(`<text x="${hx}" y="${hy + 4}" class="harbor-txt">3:1</text>`);
    else out.push(`<text x="${hx}" y="${hy - 1}" class="harbor-ico">${RES_INFO[h.type].icon}</text><text x="${hx}" y="${hy + 11}" class="harbor-txt small">2:1</text>`);
  });

  const colors = opt.colors || [];
  board.edges.forEach((e) => {
    if (e.road === null) return;
    const A = board.vertices[e.a]; const B = board.vertices[e.b];
    const k = 0.14;
    const x1 = A.x + (B.x - A.x) * k; const y1 = A.y + (B.y - A.y) * k;
    const x2 = B.x + (A.x - B.x) * k; const y2 = B.y + (A.y - B.y) * k;
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="road-bg"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="road" stroke="${colors[e.road]}"/>`);
  });

  if (board.storm >= 0) {
    const t = board.tiles[board.storm];
    out.push(`<g class="storm"><circle cx="${t.x}" cy="${t.y + 8}" r="22" class="storm-bg"/><text x="${t.x}" y="${t.y + 17}" class="storm-ico">⛈️</text></g>`);
  }

  board.vertices.forEach((v) => {
    if (!v.building) return;
    const c = colors[v.building.p];
    if (v.building.t === 'village') out.push(`<path d="M${v.x - 9},${v.y + 8} v-10 l9,-8 l9,8 v10 z" class="bld" fill="${c}"/>`);
    else out.push(`<path d="M${v.x - 13},${v.y + 10} v-12 l6,-6 l6,6 v-4 h8 v-4 h4 v20 z" class="bld" fill="${c}"/>`);
  });

  (opt.hintEdges || []).forEach((id) => {
    const e = board.edges[id];
    const A = board.vertices[e.a]; const B = board.vertices[e.b];
    out.push(`<g class="hint" data-e="${id}"><line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" class="hit"/><line x1="${(A.x * 3 + B.x) / 4}" y1="${(A.y * 3 + B.y) / 4}" x2="${(A.x + B.x * 3) / 4}" y2="${(A.y + B.y * 3) / 4}" class="hint-edge"/></g>`);
  });
  (opt.hintVertices || []).forEach((id) => {
    const v = board.vertices[id];
    out.push(`<g class="hint" data-v="${id}"><circle cx="${v.x}" cy="${v.y}" r="16" class="hit"/><circle cx="${v.x}" cy="${v.y}" r="8" class="hint-vertex"/></g>`);
  });

  out.push('</svg>');
  return out.join('');
}

// ======================= RENDER DISPATCH =======================
function render() {
  const inGame = ui.view === 'game' && S;
  $('#game').hidden = !inGame;
  $('#setup').hidden = !!inGame;
  if (inGame) renderGame();
  else if (ui.view === 'lobby' && net.game) renderLobby();
  else if (ui.view === 'local-setup') renderLocalSetup();
  else if (ui.view === 'loading') renderLoading();
  else renderHome();
}

// Re-rendering replaces the DOM; keep focus and caret in text inputs.
function keepFocus(fn) {
  const a = document.activeElement;
  const id = a && a.id;
  const sel = a && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
  fn();
  if (id) {
    const el = document.getElementById(id);
    if (el && el !== document.activeElement) { el.focus(); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } }
  }
}

function renderStatus() {
  const el = document.getElementById('net-status');
  if (!el) return;
  el.className = 'net-status' + (net.error ? ' err' : net.busy ? ' busy' : '');
  el.textContent = net.error || (net.busy ? 'Saving…' : 'Live');
}

function shell(previewBoard, panelHTML) {
  keepFocus(() => {
    $('#setup').innerHTML = `
      <div class="setup-preview">${previewBoard ? boardSVG(previewBoard) : ''}</div>
      <div class="setup-form">${panelHTML}</div>`;
  });
}

function mapPicker(selected, editable) {
  return `<div class="maps">${Object.entries(MAPS).map(([k, m]) => `
    <button class="map${k === selected ? ' sel' : ''}" data-map="${k}" ${editable ? '' : 'disabled'}><b>${m.name}</b><small>${m.desc}</small></button>`).join('')}</div>`;
}

const errBanner = () => (net.error ? `<p class="banner err" role="alert">${esc(net.error)}</p>` : '');

// ---------- Home ----------
function onlineSection() {
  if (!net.checked) return '<p class="muted">Connecting…</p>';
  if (!net.db) {
    return net.reason === 'plain'
      ? '<p class="note">Online play works when Hexhaven is opened as a shared page on claude.ai. You can still play on one device below.</p>'
      : '<p class="note">Sign in to claude.ai to play online with friends. You can still play on one device below.</p>';
  }
  const mine = (g) => (g.seats || []).some((s) => s.uid === net.uid);
  const games = net.games.filter((g) => g.status !== 'over' || mine(g));
  let list;
  if (net.gamesState === 'loading') list = '<p class="muted">Loading games…</p>';
  else if (net.gamesState === 'slow') list = '<p class="muted">Can’t reach the game list yet. Check your connection.</p>';
  else if (!games.length) list = '<p class="muted">No games yet. Create one, then tell your friends the code.</p>';
  else {
    list = `<div class="glist">${games.map((g) => {
      const status = g.status === 'lobby' ? 'Waiting to start' : g.status === 'over' ? 'Finished' : 'In progress';
      return `<button class="gitem" data-open="${esc(g.code)}">
        <span class="gcode">${esc(g.code)}</span>
        <span class="gmeta"><b>${esc((MAPS[g.config && g.config.mapKey] || MAPS.classic).name)}</b> · ${status}${mine(g) ? ' · <span class="you">you’re in</span>' : ''}<br>
        <small>${(g.seats || []).map((s) => esc(s.name)).join(', ')}</small></span>
        <span class="gopen">${g.status === 'lobby' && !mine(g) ? 'Join' : 'Open'} ›</span></button>`;
    }).join('')}</div>`;
  }
  return `
    ${net.canWrite === false ? '<p class="note">You have view-only access, so you can watch games but not join them. Ask the owner to invite you as an Editor.</p>' : ''}
    <div class="row">
      <label for="nick">Your name</label><input id="nick" maxlength="16" value="${esc(ui.nick)}" placeholder="Name shown to others">
    </div>
    <button class="primary wide" id="create">Create online game</button>
    <div class="row">
      <input id="code" maxlength="5" placeholder="Game code" value="${esc(ui.joinCode)}" autocomplete="off" spellcheck="false">
      <button id="open-code" class="ghost">Open</button>
    </div>
    ${list}`;
}

function renderHome() {
  const saved = loadLocal();
  shell(generateBoard('classic', 7), `
    <h1>Hexhaven</h1>
    <p class="tag">Settle the islands. Gather, trade, build. Every map is free.</p>
    ${errBanner()}
    <h3>Play online</h3>
    ${onlineSection()}
    <h3>Play on this device</h3>
    ${saved ? `<button class="wide" id="continue">▶ Continue (${saved.players.length} players, turn ${saved.turn})</button>` : ''}
    <button class="wide ghost" id="local">New game on this device</button>
    <button class="ghost" id="help">How to play</button>`);
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  const nick = document.getElementById('nick');
  if (nick) nick.oninput = () => { ui.nick = nick.value; };
  const code = document.getElementById('code');
  if (code) {
    code.oninput = () => { code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); ui.joinCode = code.value; };
    code.onkeydown = (e) => { if (e.key === 'Enter' && code.value.length === 5) openGame(code.value); };
  }
  on('open-code', () => { if (ui.joinCode.length === 5) openGame(ui.joinCode); else { net.error = 'Game codes have 5 letters or digits.'; render(); } });
  on('create', createGame);
  on('continue', () => startLocal(unpack(saved)));
  on('local', () => { ui.view = 'local-setup'; net.error = ''; render(); });
  on('help', helpModal);
  document.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => openGame(b.dataset.open); });
}

function renderLoading() {
  shell(null, `<button class="ghost" id="back">← All games</button>${errBanner()}<p class="muted">Opening game ${esc(net.gameId || '')}…</p>`);
  $('#back').onclick = () => goHome();
}

// ---------- Online lobby ----------
function renderLobby() {
  const g = net.game;
  const host = isHost();
  const seated = mySeat() >= 0;
  const cfg = g.config;
  shell(generateBoard(cfg.mapKey, cfg.seed), `
    <button class="ghost" id="back">← All games</button>
    ${errBanner()}
    <p class="eyebrow">Game code</p>
    <h1 class="code-big">${esc(g.code)}</h1>
    <p class="tag">Friends open this page, then pick <b>${esc(g.code)}</b> from the list or type the code.</p>
    <h3>Players (${g.seats.length}/6) <span id="net-status" class="net-status"></span></h3>
    <div class="players">${g.seats.map((s, i) => `
      <div class="pl" style="--pc:${PLAYER_COLORS[i]}"><span class="dot"></span><span class="pl-name">${esc(s.name)}</span>
      ${s.uid === g.host ? '<span class="pl-stat">host</span>' : ''}${s.uid === net.uid ? '<span class="you">you</span>' : ''}</div>`).join('')}</div>
    ${!seated && g.seats.length < 6 ? `
      <div class="row"><label for="nick">Your name</label><input id="nick" maxlength="16" value="${esc(ui.nick)}"></div>
      <button class="primary wide" id="join">Join this game</button>` : ''}
    ${!seated && g.seats.length >= 6 ? '<p class="muted">This game is full.</p>' : ''}
    ${seated && !host ? '<p class="muted">Waiting for the host to start…</p><button class="ghost" id="leave">Leave game</button>' : ''}
    <h3>Map ${host ? '' : '<span class="muted small">(host chooses)</span>'}</h3>
    ${mapPicker(cfg.mapKey, host)}
    <div class="row">
      <label for="seed">Seed</label><input id="seed" type="number" value="${cfg.seed}" ${host ? '' : 'disabled'}>
      ${host ? '<button id="reroll" class="ghost">🎲 New layout</button>' : ''}
    </div>
    <div class="row"><label for="target">Points to win</label>
      <select id="target" ${host ? '' : 'disabled'}>${[6, 8, 10, 12, 14].map((n) => `<option ${n === cfg.target ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    ${host ? `<button class="primary wide" id="start" ${g.seats.length >= 2 ? '' : 'disabled'}>${g.seats.length >= 2 ? 'Start game' : 'Need at least 2 players'}</button>
      <button class="ghost" id="delete">Delete game</button>` : ''}`);
  renderStatus();
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('back', () => goHome());
  on('join', joinLobby);
  on('leave', leaveLobby);
  on('start', startOnline);
  on('delete', () => confirmModal('Delete this game for everyone?', deleteGame));
  on('reroll', () => setConfig({ seed: Math.floor(Math.random() * 1e6) }));
  const nick = document.getElementById('nick');
  if (nick) nick.oninput = () => { ui.nick = nick.value; };
  if (host) {
    document.querySelectorAll('[data-map]').forEach((b) => { b.onclick = () => setConfig({ mapKey: b.dataset.map }); });
    $('#seed').onchange = (e) => setConfig({ seed: Math.abs(parseInt(e.target.value, 10) || 0) });
    $('#target').onchange = (e) => setConfig({ target: +e.target.value });
  }
}

// ---------- One-device setup ----------
const localCfg = { count: 4, names: ['Amber', 'Basil', 'Cedar', 'Dune', 'Ember', 'Fjord'], mapKey: 'classic', seed: Math.floor(Math.random() * 1e6), target: 10 };

function renderLocalSetup() {
  const cfg = localCfg;
  shell(generateBoard(cfg.mapKey, cfg.seed), `
    <button class="ghost" id="back">← Back</button>
    <h1>One-device game</h1>
    <p class="tag">Pass the device around. Saved in this browser.</p>
    <h3>Map</h3>
    ${mapPicker(cfg.mapKey, true)}
    <div class="row">
      <label for="seed">Seed</label><input id="seed" type="number" value="${cfg.seed}">
      <button id="reroll" class="ghost">🎲 New layout</button>
    </div>
    <h3>Players</h3>
    <div class="row"><label for="count">Count</label>
      <select id="count">${[2, 3, 4, 5, 6].map((n) => `<option ${n === cfg.count ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <label for="target">Points to win</label>
      <select id="target">${[6, 8, 10, 12, 14].map((n) => `<option ${n === cfg.target ? 'selected' : ''}>${n}</option>`).join('')}</select>
    </div>
    <div class="names">${Array.from({ length: cfg.count }, (_, i) => `
      <label class="pname" style="--pc:${PLAYER_COLORS[i]}"><span class="dot"></span><input id="pname-${i}" data-name="${i}" maxlength="16" value="${esc(cfg.names[i])}"></label>`).join('')}</div>
    <button class="primary wide" id="start">Start game</button>`);
  $('#back').onclick = () => { ui.view = 'home'; render(); };
  document.querySelectorAll('[data-map]').forEach((b) => { b.onclick = () => { cfg.mapKey = b.dataset.map; render(); }; });
  document.querySelectorAll('[data-name]').forEach((inp) => { inp.oninput = () => { cfg.names[+inp.dataset.name] = inp.value; }; });
  $('#seed').onchange = (e) => { cfg.seed = Math.abs(parseInt(e.target.value, 10) || 0); render(); };
  $('#reroll').onclick = () => { cfg.seed = Math.floor(Math.random() * 1e6); render(); };
  $('#count').onchange = (e) => { cfg.count = +e.target.value; render(); };
  $('#target').onchange = (e) => { cfg.target = +e.target.value; };
  $('#start').onclick = () => {
    const players = Array.from({ length: cfg.count }, (_, i) => ({ name: (cfg.names[i] || '').trim() || `Player ${i + 1}`, color: PLAYER_COLORS[i] }));
    startLocal(newGame({ players, mapKey: cfg.mapKey, seed: cfg.seed, target: cfg.target }));
  };
}

function startLocal(state) {
  if (net.unsubGame) { net.unsubGame(); net.unsubGame = null; }
  net.gameId = null; net.game = null; net.error = '';
  local = true; S = state;
  ui.view = 'game'; ui.mode = null; ui.winSeen = false; closeModal();
  saveLocal();
  render();
}

// ======================= GAME SCREEN =======================
function currentHints() {
  const o = { hintVertices: [], hintEdges: [], hintTiles: [] };
  if (!S || S.phase === 'over' || !controls(S.cur) || net.busy) return o;
  const p = S.cur;
  if (S.phase === 'setup') {
    if (S.setup.need === 'village') o.hintVertices = validSpots(S, p, 'village');
    else o.hintEdges = validSpots(S, p, 'road');
    return o;
  }
  if (S.pending && S.pending.type === 'storm') {
    o.hintTiles = S.board.tiles.filter((t) => t.id !== S.board.storm).map((t) => t.id);
    return o;
  }
  if (ui.mode === 'road') o.hintEdges = validSpots(S, p, 'road');
  if (ui.mode === 'village') o.hintVertices = validSpots(S, p, 'village');
  if (ui.mode === 'town') o.hintVertices = validSpots(S, p, 'town');
  return o;
}

function instruction() {
  const P = S.players[S.cur];
  if (S.phase === 'over') return `${esc(S.players[S.winner].name)} has won!`;
  const mine = controls(S.cur);
  const who = esc(P.name);
  if (S.pending && S.pending.type === 'discard') {
    const waiting = S.pending.queue.map((q) => esc(S.players[q].name)).join(', ');
    return `Storm! Waiting for ${waiting} to discard half their cards.`;
  }
  if (!mine) {
    if (S.phase === 'setup') return `${who} is placing a ${S.setup.need}…`;
    if (S.pending && S.pending.type === 'storm') return `${who} is moving the storm…`;
    if (S.pending && S.pending.type === 'steal') return `${who} is choosing who to steal from…`;
    return S.rolled ? `${who} is building and trading…` : `Waiting for ${who} to roll…`;
  }
  if (S.phase === 'setup') {
    const round = S.setup.step < S.players.length ? 1 : 2;
    return S.setup.need === 'village'
      ? `Setup round ${round}: place a <b>village</b> on a glowing corner.${round === 2 ? ' You’ll collect from its tiles.' : ''}`
      : 'Now place a <b>road</b> next to it.';
  }
  if (S.pending && S.pending.type === 'storm') return 'Move the <b>storm</b> ⛈️ to a new tile. It blocks production there.';
  if (S.pending && S.pending.type === 'steal') return 'Choose who to steal from.';
  if (!S.rolled) return 'Roll the dice to start your turn.';
  if (ui.mode) return `Click a glowing spot to build a <b>${ui.mode}</b>, or click the button again to cancel.`;
  return `Build, trade, or end your turn. First to <b>${S.target}</b> points wins.`;
}

const costHTML = (cost) => Object.entries(cost).map(([r, n]) => `<span class="cost">${n > 1 ? n : ''}${RES_INFO[r].icon}</span>`).join('');
const diceFace = (n) => ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][n - 1];
const fmtHand = (h) => RES.filter((r) => h[r]).map((r) => `${h[r]} ${RES_INFO[r].icon}`).join(', ') || 'nothing';

function renderGame() {
  if (ui.mode && !(canAct(S) && controls(S.cur))) ui.mode = null;
  const colors = S.players.map((p) => p.color);
  $('#board').innerHTML = boardSVG(S.board, { colors, ...currentHints() });

  const p = S.cur;
  const P = S.players[p];
  const mine = controls(p);
  const act_ = canAct(S) && mine && !net.busy;
  const hp = handOwner();
  const H = hp >= 0 ? S.players[hp] : null;
  const buildBtn = (kind, label) => {
    const left = kind === 'town' ? LIMITS.town - P.towns : kind === 'village' ? LIMITS.village - P.villages : LIMITS.road - P.roads;
    const ok = act_ && canAfford(P.hand, COSTS[kind]) && left > 0 && validSpots(S, p, kind).length > 0;
    return `<button class="build${ui.mode === kind ? ' active' : ''}" data-build="${kind}" ${ok || ui.mode === kind ? '' : 'disabled'}>
      <span>${label}</span><span class="costs">${costHTML(COSTS[kind])}</span><small>${left} left</small></button>`;
  };
  const offer = S.offer;
  const myOffer = offer && controls(offer.from) && !local;

  $('#side').innerHTML = `
    ${!local ? `<section class="online-bar"><button class="ghost small-btn" id="games">← Games</button>
      <span>Game <b>${esc(net.gameId)}</b>${mySeat() >= 0 ? ` · you’re <b style="color:${S.players[mySeat()].color}">${esc(S.players[mySeat()].name)}</b>` : ' · watching'}</span>
      <span id="net-status" class="net-status"></span></section>` : ''}
    <section class="turn" style="--pc:${P.color}">
      <div class="turn-name"><span class="dot"></span>${esc(P.name)}${!local && mine ? ' <span class="you">your turn</span>' : ''}</div>
      <div class="turn-sub">${S.phase === 'setup' ? 'Setup' : `Turn ${S.turn}`}</div>
      <p class="instr">${instruction()}</p>
      ${S.phase === 'main' ? `
      <div class="dice-row">
        <div class="dice">${S.dice ? `${diceFace(S.dice[0])}${diceFace(S.dice[1])}<span class="dice-total">${S.dice[0] + S.dice[1]}</span>` : '<span class="muted">—</span>'}</div>
        ${mine ? (!S.rolled ? `<button class="primary" id="roll" ${net.busy || S.pending ? 'disabled' : ''}>🎲 Roll</button>` : `<button class="primary" id="end" ${act_ ? '' : 'disabled'}>End turn ➜</button>`) : ''}
      </div>` : ''}
      ${myOffer ? `<div class="offer-wait">Offer to <b>${esc(S.players[offer.to].name)}</b>: ${fmtHand(offer.give)} for ${fmtHand(offer.get)}. Waiting for an answer… <button class="ghost small-btn" id="cancel-offer">Cancel</button></div>` : ''}
    </section>
    <section>
      <h3>${local || hp < 0 ? '' : 'Your '}hand${local ? ` · ${esc(P.name)}` : ''}</h3>
      ${H ? `<div class="hand">${RES.map((r) => `<div class="card" style="--rc:${RES_INFO[r].color}" title="${RES_INFO[r].name}"><span>${RES_INFO[r].icon}</span><b>${H.hand[r]}</b><small>${RES_INFO[r].name}</small></div>`).join('')}</div>`
        : '<p class="muted">You’re watching this game.</p>'}
    </section>
    ${S.phase === 'main' && mine ? `
    <section>
      <h3>Build</h3>
      <div class="builds">${buildBtn('road', 'Road')}${buildBtn('village', 'Village')}${buildBtn('town', 'Town')}</div>
      <div class="trades">
        <button id="bank" ${act_ ? '' : 'disabled'}>🏦 Bank trade</button>
        <button id="ptrade" ${act_ && !offer ? '' : 'disabled'}>🤝 Trade with player</button>
      </div>
    </section>` : ''}
    <section>
      <h3>Players</h3>
      <div class="players">${S.players.map((Q, i) => `
        <div class="pl${i === p ? ' cur' : ''}" style="--pc:${Q.color}">
          <span class="dot"></span><span class="pl-name">${esc(Q.name)}${!local && i === mySeat() ? ' <span class="you">you</span>' : ''}</span>
          <span class="pl-stat" title="Cards in hand">🃏 ${handSize(Q.hand)}</span>
          <span class="pl-stat" title="Longest road">🛤️ ${Q.road}${S.longestHolder === i ? ' 🏅' : ''}</span>
          <span class="pl-vp" title="Victory points">${vp(S, i)}<small>VP</small></span>
        </div>`).join('')}</div>
    </section>
    <section class="log-wrap">
      <h3>Log</h3>
      <div class="log" id="log">${S.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
    </section>
    <section class="menu">${local ? '<button id="newgame" class="ghost">New game</button>' : ''}<button id="help" class="ghost">How to play</button></section>
  `;
  const lg = $('#log'); lg.scrollTop = lg.scrollHeight;
  renderStatus();
  bindSide();
  syncModal();
}

function bindSide() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('roll', () => { ui.mode = null; act((s, rng) => rollDice(s, rng)); });
  on('end', () => { ui.mode = null; act((s) => endTurn(s)); });
  on('bank', () => { ui.mode = null; bankModal(); });
  on('ptrade', () => { ui.mode = null; tradeModal(); });
  on('cancel-offer', () => act((s) => cancelOffer(s)));
  on('games', () => goHome());
  on('newgame', () => confirmModal('Abandon this game and start a new one?', () => { storeSet(SAVE_KEY, null); ui.view = 'local-setup'; S = null; local = false; render(); }));
  on('help', helpModal);
  document.querySelectorAll('[data-build]').forEach((b) => {
    b.onclick = () => { ui.mode = ui.mode === b.dataset.build ? null : b.dataset.build; render(); };
  });
}

function onBoardClick(ev) {
  if (!S || !controls(S.cur) || net.busy) return;
  const g = ev.target.closest('[data-v],[data-e],[data-t]');
  if (!g) return;
  if (g.dataset.t !== undefined) { const t = +g.dataset.t; act((s, rng) => moveStorm(s, t, rng)); return; }
  if (g.dataset.e !== undefined) {
    const e = +g.dataset.e;
    if (S.phase === 'main') ui.mode = null;
    act((s) => placeRoad(s, e));
  } else if (g.dataset.v !== undefined) {
    const v = +g.dataset.v;
    if (S.phase === 'setup') act((s) => placeVillage(s, v));
    else if (ui.mode === 'village') { ui.mode = null; act((s) => placeVillage(s, v)); }
    else if (ui.mode === 'town') { ui.mode = null; act((s) => placeTown(s, v)); }
  }
}

// ======================= MODALS =======================
const SYSTEM_MODALS = new Set(['discard', 'steal', 'offer', 'win']);

function openModal(html, key, { dismissable = true } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  ui.modal = key;
  m.onclick = dismissable ? (e) => { if (e.target === m) closeModal(); } : null;
  return m.firstElementChild;
}
function closeModal() { const m = $('#modal'); if (!m) return; m.hidden = true; m.innerHTML = ''; m.onclick = null; ui.modal = null; }

function confirmModal(text, yes) {
  const c = openModal(`<p>${esc(text)}</p><div class="row end"><button class="ghost" id="no">Cancel</button><button class="primary" id="yes">Yes</button></div>`, 'confirm');
  c.querySelector('#no').onclick = closeModal;
  c.querySelector('#yes').onclick = () => { closeModal(); yes(); };
}

function requiredModal() {
  if (!S) return null;
  if (S.phase === 'over') return ui.winSeen ? null : 'win';
  const pd = S.pending;
  if (pd && pd.type === 'discard') {
    const p = local ? pd.queue[0] : (pd.queue.includes(mySeat()) ? mySeat() : -1);
    if (p >= 0) return 'discard:' + p;
  }
  if (pd && pd.type === 'steal' && controls(S.cur)) return 'steal';
  if (S.offer && controls(S.offer.to)) return 'offer:' + S.offer.id;
  return null;
}

function syncModal() {
  const want = requiredModal();
  if (want) {
    if (ui.modal !== want) {
      const [kind, arg] = want.split(':');
      if (kind === 'win') winModal();
      else if (kind === 'discard') discardModal(+arg, want);
      else if (kind === 'steal') stealModal();
      else if (kind === 'offer') offerModal(want);
    }
    return;
  }
  if (ui.modal && SYSTEM_MODALS.has(ui.modal.split(':')[0])) closeModal();
}

function stepperRow(prefix, counts, max) {
  return RES.map((r) => `
    <div class="stepper" style="--rc:${RES_INFO[r].color}">
      <span class="st-ico" title="${RES_INFO[r].name}">${RES_INFO[r].icon}</span>
      <button data-${prefix}-dec="${r}" aria-label="Fewer ${RES_INFO[r].name}" ${counts[r] <= 0 ? 'disabled' : ''}>−</button>
      <b>${counts[r]}</b>
      <button data-${prefix}-inc="${r}" aria-label="More ${RES_INFO[r].name}" ${max && counts[r] >= max[r] ? 'disabled' : ''}>+</button>
    </div>`).join('');
}
function bindSteppers(card, prefix, counts, max, redraw) {
  card.querySelectorAll(`[data-${prefix}-inc]`).forEach((b) => {
    b.onclick = () => { const r = b.getAttribute(`data-${prefix}-inc`); if (!max || counts[r] < max[r]) counts[r]++; redraw(); };
  });
  card.querySelectorAll(`[data-${prefix}-dec]`).forEach((b) => {
    b.onclick = () => { const r = b.getAttribute(`data-${prefix}-dec`); if (counts[r] > 0) counts[r]--; redraw(); };
  });
}

function discardModal(p, key) {
  const pick = emptyHand();
  const draw = () => {
    const P = S.players[p];
    const need = discardNeeded(S, p);
    const n = handSize(pick);
    const c = openModal(`
      <h2 style="color:${P.color}">${esc(P.name)}: discard ${need}</h2>
      <p class="muted">The storm scatters your goods.${local ? ` Pass the device to ${esc(P.name)}.` : ''}</p>
      <p>Your hand: ${RES.map((r) => `${RES_INFO[r].icon}${P.hand[r]}`).join(' &nbsp; ')}</p>
      <div class="steppers">${stepperRow('d', pick, P.hand)}</div>
      <div class="row end"><span class="muted">${n} / ${need}</span><button class="primary" id="ok" ${n === need ? '' : 'disabled'}>Discard</button></div>`, key, { dismissable: false });
    bindSteppers(c, 'd', pick, P.hand, draw);
    c.querySelector('#ok').onclick = () => { const cards = { ...pick }; closeModal(); act((s) => discard(s, p, cards)); };
  };
  draw();
}

function stealModal() {
  const c = openModal(`<h2>Steal from…</h2><div class="choices">${S.pending.victims.map((v) =>
    `<button data-victim="${v}" style="--pc:${S.players[v].color}"><span class="dot"></span>${esc(S.players[v].name)} <span class="muted">(${handSize(S.players[v].hand)} cards)</span></button>`).join('')}</div>`, 'steal', { dismissable: false });
  c.querySelectorAll('[data-victim]').forEach((b) => { b.onclick = () => { const v = +b.dataset.victim; closeModal(); act((s, rng) => steal(s, v, rng)); }; });
}

function offerModal(key) {
  const o = S.offer;
  const A = S.players[o.from];
  const B = S.players[o.to];
  const can = canAfford(B.hand, o.get);
  const c = openModal(`
    <h2 style="color:${B.color}">${esc(B.name)}, trade offer</h2>
    <p>${esc(A.name)} offers <b>${fmtHand(o.give)}</b><br>for your <b>${fmtHand(o.get)}</b>.</p>
    ${can ? '' : '<p class="warn">You don’t have the cards they asked for.</p>'}
    <div class="row end"><button class="ghost" id="no">Decline</button><button class="primary" id="yes" ${can ? '' : 'disabled'}>Accept</button></div>`, key, { dismissable: false });
  const to = o.to;
  c.querySelector('#no').onclick = () => { closeModal(); act((s) => respondOffer(s, to, false)); };
  c.querySelector('#yes').onclick = () => { closeModal(); act((s) => respondOffer(s, to, true)); };
}

function bankModal() {
  let give = null; let get = null;
  const draw = () => {
    const P = S.players[S.cur];
    const c = openModal(`
      <h2>🏦 Bank trade</h2>
      <p class="muted">Harbors improve your rate. 3:1 harbors work for any resource; 2:1 harbors for one type.</p>
      <h4>Give</h4>
      <div class="pick">${RES.map((r) => { const rate = tradeRate(S, S.cur, r); return `<button data-give="${r}" class="${give === r ? 'sel' : ''}" ${P.hand[r] >= rate ? '' : 'disabled'}>${RES_INFO[r].icon}<small>${rate}:1 · have ${P.hand[r]}</small></button>`; }).join('')}</div>
      <h4>Receive</h4>
      <div class="pick">${RES.map((r) => `<button data-get="${r}" class="${get === r ? 'sel' : ''}" ${r === give ? 'disabled' : ''}>${RES_INFO[r].icon}<small>${RES_INFO[r].name}</small></button>`).join('')}</div>
      <div class="row end"><button class="ghost" id="close">Done</button><button class="primary" id="ok" ${give && get && give !== get && !net.busy ? '' : 'disabled'}>Trade</button></div>`, 'bank');
    c.querySelectorAll('[data-give]').forEach((b) => { b.onclick = () => { give = b.dataset.give; if (get === give) get = null; draw(); }; });
    c.querySelectorAll('[data-get]').forEach((b) => { b.onclick = () => { get = b.dataset.get; draw(); }; });
    c.querySelector('#close').onclick = closeModal;
    c.querySelector('#ok').onclick = async () => {
      const g1 = give; const g2 = get;
      await act((s) => bankTrade(s, g1, g2));
      if (!S || ui.view !== 'game') return;
      if (S.players[S.cur].hand[give] < tradeRate(S, S.cur, give)) give = null;
      if (ui.modal === 'bank' || ui.modal === null) draw();
    };
  };
  draw();
}

function tradeModal() {
  const others = S.players.map((_, i) => i).filter((i) => i !== S.cur);
  let partner = others[0];
  const give = emptyHand(); const get = emptyHand();
  const draw = () => {
    const A = S.players[S.cur];
    const B = S.players[partner];
    const valid = handSize(give) + handSize(get) > 0 && canAfford(A.hand, give);
    const c = openModal(`
      <h2>🤝 Trade with a player</h2>
      <h4>Partner</h4>
      <div class="choices inline">${others.map((i) => `<button data-partner="${i}" class="${i === partner ? 'sel' : ''}" style="--pc:${S.players[i].color}"><span class="dot"></span>${esc(S.players[i].name)} <span class="muted">${handSize(S.players[i].hand)}🃏</span></button>`).join('')}</div>
      <h4>You give</h4><div class="steppers">${stepperRow('g', give, A.hand)}</div>
      <h4>You get</h4><div class="steppers">${stepperRow('r', get, null)}</div>
      <div class="row end"><button class="ghost" id="close">Cancel</button><button class="primary" id="ok" ${valid ? '' : 'disabled'}>Offer to ${esc(B.name)}</button></div>`, 'trade');
    c.querySelectorAll('[data-partner]').forEach((b) => { b.onclick = () => { partner = +b.dataset.partner; draw(); }; });
    bindSteppers(c, 'g', give, A.hand, draw);
    bindSteppers(c, 'r', get, null, draw);
    c.querySelector('#close').onclick = closeModal;
    c.querySelector('#ok').onclick = () => {
      const to = partner; const gv = { ...give }; const gt = { ...get };
      closeModal();
      act((s, rng) => makeOffer(s, to, gv, gt, rng));
    };
  };
  draw();
}

function winModal() {
  const ranked = S.players.map((P, i) => ({ P, i, v: vp(S, i) })).sort((a, b) => b.v - a.v);
  const c = openModal(`
    <h2 class="win">🏆 ${esc(S.players[S.winner].name)} wins!</h2>
    <ol class="ranks">${ranked.map((x) => `<li style="--pc:${x.P.color}"><span class="dot"></span>${esc(x.P.name)} <b>${x.v} VP</b></li>`).join('')}</ol>
    <div class="row end"><button class="ghost" id="view">View board</button><button class="primary" id="again">${local ? 'New game' : 'Back to games'}</button></div>`, 'win', { dismissable: false });
  c.querySelector('#view').onclick = () => { ui.winSeen = true; closeModal(); };
  c.querySelector('#again').onclick = () => {
    closeModal();
    if (local) { storeSet(SAVE_KEY, null); local = false; S = null; ui.view = 'local-setup'; render(); } else goHome();
  };
}

function helpModal() {
  const c = openModal(`
    <h2>How to play Hexhaven</h2>
    <ul class="help">
      <li><b>Goal:</b> be the first to reach the target score. Villages are worth 1 point, towns 2, and holding <b>Longest Road</b> (5+ connected road segments) is worth 2.</li>
      <li><b>Setup:</b> everyone places a village and a road, then again in reverse order. Your second village gives you one card from each tile it touches.</li>
      <li><b>Each turn:</b> roll the dice. Every tile showing that number produces for adjacent villages (1 card) and towns (2 cards).</li>
      <li><b>Rolling 7:</b> anyone holding more than 7 cards discards half. The roller moves the ⛈️ storm (that tile stops producing) and steals a card from someone next to it.</li>
      <li><b>Building:</b> Road ${costHTML(COSTS.road)} · Village ${costHTML(COSTS.village)} · Town ${costHTML(COSTS.town)} (upgrade from a village).</li>
      <li><b>Placement:</b> villages need at least one empty corner between them and any other building, and (after setup) must touch one of your roads.</li>
      <li><b>Trading:</b> trade with the bank at 4:1, or 3:1 / 2:1 if you’ve built at a harbor. On your turn you can also offer a trade to another player.</li>
      <li><b>Online:</b> create a game, share its code, and everyone joins from their own device. Each player only sees their own hand.</li>
    </ul>
    <div class="row end"><button class="primary" id="ok">Got it</button></div>`, 'help');
  c.querySelector('#ok').onclick = closeModal;
}

// ======================= BOOT =======================
function boot() {
  $('#board').addEventListener('click', onBoardClick);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#modal').hidden && $('#modal').onclick) closeModal();
    else if (ui.mode) { ui.mode = null; render(); }
  });
  render();
  initNet();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

// Exposed for automated testing.
window.Hexhaven = { get state() { return S; }, render, startLocal, act, get ui() { return ui; }, get net() { return net; } };
