// Hexhaven — rendering and interaction.
'use strict';

const SAVE_KEY = 'hexhaven-save-v1';
let S = null;                 // game state
const ui = { mode: null };    // build mode: null | 'road' | 'village' | 'town'
const $ = (sel) => document.querySelector(sel);
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* storage unavailable */ }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.version === 1 && s.phase !== 'over' ? s : null;
  } catch (e) { return null; }
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
  const out = [];
  out.push(`<svg viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Game board">`);
  out.push('<defs><radialGradient id="sea" cx="50%" cy="50%" r="70%"><stop offset="0%" style="stop-color:var(--sea-1)"/><stop offset="100%" style="stop-color:var(--sea-2)"/></radialGradient></defs>');

  board.water.forEach((w) => out.push(`<polygon class="water" points="${hexPoints(w.x, w.y, HEX_SIZE)}"/>`));

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

  // Harbors
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

  // Roads
  const colors = opt.colors || [];
  board.edges.forEach((e) => {
    if (e.road === null) return;
    const A = board.vertices[e.a]; const B = board.vertices[e.b];
    const k = 0.14;
    const x1 = A.x + (B.x - A.x) * k; const y1 = A.y + (B.y - A.y) * k;
    const x2 = B.x + (A.x - B.x) * k; const y2 = B.y + (A.y - B.y) * k;
    out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="road-bg"/><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="road" stroke="${colors[e.road]}"/>`);
  });

  // Storm
  if (board.storm >= 0) {
    const t = board.tiles[board.storm];
    out.push(`<g class="storm"><circle cx="${t.x}" cy="${t.y + 8}" r="22" class="storm-bg"/><text x="${t.x}" y="${t.y + 17}" class="storm-ico">⛈️</text></g>`);
  }

  // Buildings
  board.vertices.forEach((v) => {
    if (!v.building) return;
    const c = colors[v.building.p];
    if (v.building.t === 'village') {
      out.push(`<path d="M${v.x - 9},${v.y + 8} v-10 l9,-8 l9,8 v10 z" class="bld" fill="${c}"/>`);
    } else {
      out.push(`<path d="M${v.x - 13},${v.y + 10} v-12 l6,-6 l6,6 v-4 h8 v-4 h4 v20 z" class="bld" fill="${c}"/>`);
    }
  });

  // Hints
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

// ======================= GAME SCREEN =======================
function currentHints() {
  const o = { hintVertices: [], hintEdges: [], hintTiles: [] };
  if (!S || S.phase === 'over') return o;
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
  if (S.phase === 'setup') {
    const round = S.setup.step < S.players.length ? 1 : 2;
    return S.setup.need === 'village'
      ? `Setup round ${round}: place a <b>village</b> on a glowing corner.${round === 2 ? ' You\'ll collect from its tiles.' : ''}`
      : 'Now place a <b>road</b> next to it.';
  }
  if (S.pending) {
    if (S.pending.type === 'discard') return 'Storm! Players with more than 7 cards discard half.';
    if (S.pending.type === 'storm') return 'Move the <b>storm</b> ⛈️ to a new tile. It blocks production there.';
    if (S.pending.type === 'steal') return 'Choose who to steal from.';
  }
  if (!S.rolled) return 'Roll the dice to start your turn.';
  if (ui.mode) return `Click a glowing spot to build a <b>${ui.mode}</b>, or click the button again to cancel.`;
  return `Build, trade, or end your turn. First to <b>${S.target}</b> points wins.`;
}

const costHTML = (cost) => Object.entries(cost).map(([r, n]) => `<span class="cost">${n > 1 ? n : ''}${RES_INFO[r].icon}</span>`).join('');
const diceFace = (n) => ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'][n - 1];

function render() {
  const colors = S.players.map((p) => p.color);
  $('#board').innerHTML = boardSVG(S.board, { colors, ...currentHints() });

  const p = S.cur;
  const P = S.players[p];
  const act = canAct(S);
  const buildBtn = (kind, label) => {
    const left = kind === 'town' ? LIMITS.town - P.towns : kind === 'village' ? LIMITS.village - P.villages : LIMITS.road - P.roads;
    const ok = act && canAfford(P.hand, COSTS[kind]) && left > 0 && validSpots(S, p, kind).length > 0;
    return `<button class="build${ui.mode === kind ? ' active' : ''}" data-build="${kind}" ${ok || ui.mode === kind ? '' : 'disabled'}>
      <span>${label}</span><span class="costs">${costHTML(COSTS[kind])}</span><small>${left} left</small></button>`;
  };

  $('#side').innerHTML = `
    <section class="turn" style="--pc:${P.color}">
      <div class="turn-name"><span class="dot"></span>${esc(P.name)}</div>
      <div class="turn-sub">${S.phase === 'setup' ? 'Setup' : `Turn ${S.turn}`}</div>
      <p class="instr">${instruction()}</p>
      ${S.phase === 'main' ? `
      <div class="dice-row">
        <div class="dice">${S.dice ? `${diceFace(S.dice[0])}${diceFace(S.dice[1])}<span class="dice-total">${S.dice[0] + S.dice[1]}</span>` : '<span class="muted">—</span>'}</div>
        ${!S.rolled ? '<button class="primary" id="roll">🎲 Roll</button>' : `<button class="primary" id="end" ${act ? '' : 'disabled'}>End turn ➜</button>`}
      </div>` : ''}
    </section>
    <section>
      <h3>Your hand</h3>
      <div class="hand">${RES.map((r) => `<div class="card" style="--rc:${RES_INFO[r].color}" title="${RES_INFO[r].name}"><span>${RES_INFO[r].icon}</span><b>${P.hand[r]}</b><small>${RES_INFO[r].name}</small></div>`).join('')}</div>
    </section>
    ${S.phase === 'main' ? `
    <section>
      <h3>Build</h3>
      <div class="builds">${buildBtn('road', 'Road')}${buildBtn('village', 'Village')}${buildBtn('town', 'Town')}</div>
      <div class="trades">
        <button id="bank" ${act ? '' : 'disabled'}>🏦 Bank trade</button>
        <button id="ptrade" ${act ? '' : 'disabled'}>🤝 Trade with player</button>
      </div>
    </section>` : ''}
    <section>
      <h3>Players</h3>
      <div class="players">${S.players.map((Q, i) => `
        <div class="pl${i === p ? ' cur' : ''}" style="--pc:${Q.color}">
          <span class="dot"></span><span class="pl-name">${esc(Q.name)}</span>
          <span class="pl-stat" title="Cards in hand">🃏 ${handSize(Q.hand)}</span>
          <span class="pl-stat" title="Longest road">🛤️ ${Q.road}${S.longestHolder === i ? ' 🏅' : ''}</span>
          <span class="pl-vp" title="Victory points">${vp(S, i)}<small>VP</small></span>
        </div>`).join('')}</div>
    </section>
    <section class="log-wrap">
      <h3>Log</h3>
      <div class="log" id="log">${S.log.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
    </section>
    <section class="menu"><button id="newgame" class="ghost">New game</button><button id="help" class="ghost">How to play</button></section>
  `;
  const lg = $('#log'); lg.scrollTop = lg.scrollHeight;

  bindSide();
  handlePending();
  save();
}

function bindSide() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('roll', () => { ui.mode = null; rollDice(S); render(); });
  on('end', () => { ui.mode = null; endTurn(S); render(); });
  on('bank', () => { ui.mode = null; render(); bankModal(); });
  on('ptrade', () => { ui.mode = null; render(); tradeModal(); });
  on('newgame', () => confirmModal('Abandon this game and start a new one?', () => { localStorage.removeItem(SAVE_KEY); showSetup(); }));
  on('help', helpModal);
  document.querySelectorAll('[data-build]').forEach((b) => {
    b.onclick = () => { ui.mode = ui.mode === b.dataset.build ? null : b.dataset.build; render(); };
  });
}

function onBoardClick(ev) {
  if (!S) return;
  const g = ev.target.closest('[data-v],[data-e],[data-t]');
  if (!g) return;
  if (g.dataset.t !== undefined) { moveStorm(S, +g.dataset.t); render(); return; }
  if (g.dataset.e !== undefined) {
    if (placeRoad(S, +g.dataset.e) && S.phase === 'main') ui.mode = null;
  } else if (g.dataset.v !== undefined) {
    const v = +g.dataset.v;
    if (S.phase === 'setup') placeVillage(S, v);
    else if (ui.mode === 'village') { if (placeVillage(S, v)) ui.mode = null; }
    else if (ui.mode === 'town') { if (placeTown(S, v)) ui.mode = null; }
  }
  render();
}

// ======================= MODALS =======================
function openModal(html, { dismissable = true } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-card">${html}</div>`;
  m.hidden = false;
  m.onclick = dismissable ? (e) => { if (e.target === m) closeModal(); } : null;
  return m.firstElementChild;
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

function confirmModal(text, yes) {
  const c = openModal(`<p>${esc(text)}</p><div class="row end"><button class="ghost" id="no">Cancel</button><button class="primary" id="yes">Yes</button></div>`);
  c.querySelector('#no').onclick = closeModal;
  c.querySelector('#yes').onclick = () => { closeModal(); yes(); };
}

function handlePending() {
  if (S.phase === 'over') { winModal(); return; }
  if (!S.pending) { closeModal(); return; }
  if (S.pending.type === 'discard') discardModal(S.pending.queue[0]);
  else if (S.pending.type === 'steal') stealModal();
  else closeModal();
}

function stepperRow(prefix, counts, max) {
  return RES.map((r) => `
    <div class="stepper" style="--rc:${RES_INFO[r].color}">
      <span class="st-ico" title="${RES_INFO[r].name}">${RES_INFO[r].icon}</span>
      <button data-${prefix}-dec="${r}" ${counts[r] <= 0 ? 'disabled' : ''}>−</button>
      <b>${counts[r]}</b>
      <button data-${prefix}-inc="${r}" ${max && counts[r] >= max[r] ? 'disabled' : ''}>+</button>
    </div>`).join('');
}
function bindSteppers(card, prefix, counts, max, rerender) {
  card.querySelectorAll(`[data-${prefix}-inc]`).forEach((b) => {
    b.onclick = () => { const r = b.getAttribute(`data-${prefix}-inc`); if (!max || counts[r] < max[r]) counts[r]++; rerender(); };
  });
  card.querySelectorAll(`[data-${prefix}-dec]`).forEach((b) => {
    b.onclick = () => { const r = b.getAttribute(`data-${prefix}-dec`); if (counts[r] > 0) counts[r]--; rerender(); };
  });
}

function discardModal(p) {
  const P = S.players[p];
  const need = discardNeeded(S, p);
  const pick = emptyHand();
  const draw = () => {
    const n = handSize(pick);
    const c = openModal(`
      <h2 style="color:${P.color}">${esc(P.name)}: discard ${need}</h2>
      <p class="muted">The storm scatters your goods. Pass the device to ${esc(P.name)}.</p>
      <p>Your hand: ${RES.map((r) => `${RES_INFO[r].icon}${P.hand[r]}`).join(' &nbsp; ')}</p>
      <div class="steppers">${stepperRow('d', pick, P.hand)}</div>
      <div class="row end"><span class="muted">${n} / ${need}</span><button class="primary" id="ok" ${n === need ? '' : 'disabled'}>Discard</button></div>`, { dismissable: false });
    bindSteppers(c, 'd', pick, P.hand, draw);
    c.querySelector('#ok').onclick = () => { closeModal(); discard(S, p, pick); render(); };
  };
  draw();
}

function stealModal() {
  const c = openModal(`<h2>Steal from…</h2><div class="choices">${S.pending.victims.map((v) =>
    `<button data-victim="${v}" style="--pc:${S.players[v].color}"><span class="dot"></span>${esc(S.players[v].name)} <span class="muted">(${handSize(S.players[v].hand)} cards)</span></button>`).join('')}</div>`, { dismissable: false });
  c.querySelectorAll('[data-victim]').forEach((b) => { b.onclick = () => { closeModal(); steal(S, +b.dataset.victim); render(); }; });
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
      <div class="row end"><button class="ghost" id="close">Done</button><button class="primary" id="ok" ${give && get && give !== get ? '' : 'disabled'}>Trade</button></div>`);
    c.querySelectorAll('[data-give]').forEach((b) => { b.onclick = () => { give = b.dataset.give; if (get === give) get = null; draw(); }; });
    c.querySelectorAll('[data-get]').forEach((b) => { b.onclick = () => { get = b.dataset.get; draw(); }; });
    c.querySelector('#close').onclick = () => { closeModal(); render(); };
    c.querySelector('#ok').onclick = () => {
      bankTrade(S, give, get); render();
      if (S.players[S.cur].hand[give] < tradeRate(S, S.cur, give)) give = null;
      draw();
    };
  };
  draw();
}

function tradeModal() {
  const others = S.players.map((_, i) => i).filter((i) => i !== S.cur);
  let partner = others[0];
  const give = emptyHand(); const get = emptyHand();
  const A = S.players[S.cur];
  const draw = () => {
    const B = S.players[partner];
    const valid = handSize(give) + handSize(get) > 0 && canAfford(B.hand, get);
    const c = openModal(`
      <h2>🤝 Trade with a player</h2>
      <h4>Partner</h4>
      <div class="choices inline">${others.map((i) => `<button data-partner="${i}" class="${i === partner ? 'sel' : ''}" style="--pc:${S.players[i].color}"><span class="dot"></span>${esc(S.players[i].name)} <span class="muted">${handSize(S.players[i].hand)}🃏</span></button>`).join('')}</div>
      <h4>You give</h4><div class="steppers">${stepperRow('g', give, A.hand)}</div>
      <h4>You get</h4><div class="steppers">${stepperRow('r', get, null)}</div>
      ${!canAfford(B.hand, get) ? `<p class="warn">${esc(B.name)} doesn't have those cards.</p>` : ''}
      <div class="row end"><button class="ghost" id="close">Cancel</button><button class="primary" id="ok" ${valid ? '' : 'disabled'}>Offer to ${esc(B.name)}</button></div>`);
    c.querySelectorAll('[data-partner]').forEach((b) => { b.onclick = () => { partner = +b.dataset.partner; draw(); }; });
    bindSteppers(c, 'g', give, A.hand, draw);
    bindSteppers(c, 'r', get, null, draw);
    c.querySelector('#close').onclick = closeModal;
    c.querySelector('#ok').onclick = () => {
      const fmt = (h) => RES.filter((r) => h[r]).map((r) => `${h[r]} ${RES_INFO[r].icon}`).join(', ') || 'nothing';
      const c2 = openModal(`
        <h2 style="color:${B.color}">${esc(B.name)}, do you accept?</h2>
        <p>${esc(A.name)} offers <b>${fmt(give)}</b><br>in exchange for your <b>${fmt(get)}</b>.</p>
        <div class="row end"><button class="ghost" id="no">Decline</button><button class="primary" id="yes">Accept</button></div>`, { dismissable: false });
      c2.querySelector('#no').onclick = draw;
      c2.querySelector('#yes').onclick = () => { playerTrade(S, partner, give, get); closeModal(); render(); };
    };
  };
  draw();
}

function winModal() {
  const ranked = S.players.map((P, i) => ({ P, i, v: vp(S, i) })).sort((a, b) => b.v - a.v);
  const c = openModal(`
    <h2 class="win">🏆 ${esc(S.players[S.winner].name)} wins!</h2>
    <ol class="ranks">${ranked.map((x) => `<li style="--pc:${x.P.color}"><span class="dot"></span>${esc(x.P.name)} <b>${x.v} VP</b></li>`).join('')}</ol>
    <div class="row end"><button class="ghost" id="view">View board</button><button class="primary" id="again">New game</button></div>`, { dismissable: false });
  c.querySelector('#view').onclick = closeModal;
  c.querySelector('#again').onclick = () => { closeModal(); showSetup(); };
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
      <li><b>Trading:</b> trade with the bank at 4:1, or 3:1 / 2:1 if you've built at a harbor. You can also trade freely with other players on your turn.</li>
    </ul>
    <div class="row end"><button class="primary" id="ok">Got it</button></div>`);
  c.querySelector('#ok').onclick = closeModal;
}

// ======================= SETUP SCREEN =======================
const setupCfg = {
  count: 4,
  names: ['Amber', 'Basil', 'Cedar', 'Dune', 'Ember', 'Fjord'],
  mapKey: 'classic',
  seed: Math.floor(Math.random() * 1e6),
  target: 10,
};

function showSetup() {
  S = null;
  ui.mode = null;
  $('#game').hidden = true;
  $('#setup').hidden = false;
  drawSetup();
}

function drawSetup() {
  const cfg = setupCfg;
  const saved = loadSave();
  const preview = generateBoard(cfg.mapKey, cfg.seed);
  $('#setup').innerHTML = `
    <div class="setup-preview">${boardSVG(preview)}</div>
    <div class="setup-form">
      <h1>Hexhaven</h1>
      <p class="tag">Settle the islands. Gather, trade, build. Every map is free.</p>
      ${saved ? `<button class="primary wide" id="continue">▶ Continue saved game (${saved.players.length} players, turn ${saved.turn})</button>` : ''}
      <h3>Map</h3>
      <div class="maps">${Object.entries(MAPS).map(([k, m]) => `
        <button class="map${k === cfg.mapKey ? ' sel' : ''}" data-map="${k}"><b>${m.name}</b><small>${m.desc}</small></button>`).join('')}</div>
      <div class="row">
        <label>Seed <input id="seed" type="number" value="${cfg.seed}"></label>
        <button id="reroll" class="ghost">🎲 New layout</button>
      </div>
      <h3>Players</h3>
      <div class="row"><label>Count
        <select id="count">${[2, 3, 4, 5, 6].map((n) => `<option ${n === cfg.count ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Points to win
        <select id="target">${[6, 8, 10, 12, 14].map((n) => `<option ${n === cfg.target ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="names">${Array.from({ length: cfg.count }, (_, i) => `
        <label class="pname" style="--pc:${PLAYER_COLORS[i]}"><span class="dot"></span><input data-name="${i}" maxlength="16" value="${esc(cfg.names[i])}"></label>`).join('')}</div>
      <button class="primary wide" id="start">Start game</button>
      <p class="muted small">Hot-seat play: pass the device around. Your game is saved automatically in this browser.</p>
    </div>`;

  document.querySelectorAll('[data-map]').forEach((b) => { b.onclick = () => { cfg.mapKey = b.dataset.map; drawSetup(); }; });
  document.querySelectorAll('[data-name]').forEach((inp) => { inp.oninput = () => { cfg.names[+inp.dataset.name] = inp.value; }; });
  $('#seed').onchange = (e) => { cfg.seed = Math.abs(parseInt(e.target.value, 10) || 0); drawSetup(); };
  $('#reroll').onclick = () => { cfg.seed = Math.floor(Math.random() * 1e6); drawSetup(); };
  $('#count').onchange = (e) => { cfg.count = +e.target.value; drawSetup(); };
  $('#target').onchange = (e) => { cfg.target = +e.target.value; };
  $('#start').onclick = () => {
    const players = Array.from({ length: cfg.count }, (_, i) => ({ name: (cfg.names[i] || '').trim() || `Player ${i + 1}`, color: PLAYER_COLORS[i] }));
    startGame(newGame({ players, mapKey: cfg.mapKey, seed: cfg.seed, target: cfg.target }));
  };
  if (saved) $('#continue').onclick = () => startGame(saved);
}

function startGame(state) {
  S = state;
  ui.mode = null;
  $('#setup').hidden = true;
  $('#setup').innerHTML = '';
  $('#game').hidden = false;
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  $('#board').addEventListener('click', onBoardClick);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#modal').hidden && $('#modal').onclick) closeModal(); else if (ui.mode) { ui.mode = null; render(); } }
  });
  showSetup();
});

// Exposed for automated testing.
window.Hexhaven = { get state() { return S; }, render, startGame };
