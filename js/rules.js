// Hexhaven — game rules. All state is plain JSON so it can be saved and restored.
'use strict';

const COSTS = {
  road:    { timber: 1, clay: 1 },
  village: { timber: 1, clay: 1, fiber: 1, grain: 1 },
  town:    { grain: 2, stone: 3 },
};
const LIMITS = { road: 15, village: 5, town: 4 };
const PLAYER_COLORS = ['#e04848', '#3a78e0', '#f0a020', '#9b59d0', '#f4f1ea', '#22a8a8'];

const emptyHand = () => ({ timber: 0, clay: 0, fiber: 0, grain: 0, stone: 0 });
const handSize = (h) => RES.reduce((s, r) => s + h[r], 0);
const canAfford = (h, cost) => Object.entries(cost).every(([r, n]) => h[r] >= n);
const pay = (h, cost) => Object.entries(cost).forEach(([r, n]) => { h[r] -= n; });

function newGame({ players, mapKey, seed, target }) {
  const board = generateBoard(mapKey, seed);
  const n = players.length;
  const order = [];
  for (let i = 0; i < n; i++) order.push(i);
  for (let i = n - 1; i >= 0; i--) order.push(i);
  return {
    version: 1,
    board,
    target,
    players: players.map((p, i) => ({
      name: p.name, color: p.color || PLAYER_COLORS[i],
      hand: emptyHand(), roads: 0, villages: 0, towns: 0, road: 0,
    })),
    cur: 0,
    phase: 'setup',            // setup | main | over
    setup: { order, step: 0, need: 'village', lastVertex: null },
    rolled: false,
    dice: null,
    pending: null,             // {type:'discard', queue:[...]} | {type:'storm'} | {type:'steal', victims:[...]}
    offer: null,               // {id, from, to, give, get} — a trade waiting for the other player
    longestHolder: -1,
    winner: -1,
    log: [],
    turn: 1,
  };
}

function log(s, msg) {
  s.log.push(msg);
  if (s.log.length > 80) s.log.shift();
}

function vp(s, p) {
  const P = s.players[p];
  return P.villages + P.towns * 2 + (s.longestHolder === p ? 2 : 0);
}

// ---------- placement validity ----------
function vertexFree(s, v) {
  const V = s.board.vertices[v];
  return !V.building && V.adj.every((a) => !s.board.vertices[a].building);
}

function canPlaceVillage(s, p, v) {
  if (!vertexFree(s, v)) return false;
  if (s.phase === 'setup') return true;
  return s.board.vertices[v].edges.some((e) => s.board.edges[e].road === p);
}

function canPlaceRoad(s, p, e) {
  const E = s.board.edges[e];
  if (E.road !== null) return false;
  if (s.phase === 'setup') return E.a === s.setup.lastVertex || E.b === s.setup.lastVertex;
  return [E.a, E.b].some((x) => {
    const V = s.board.vertices[x];
    if (V.building) return V.building.p === p;
    return V.edges.some((oe) => oe !== e && s.board.edges[oe].road === p);
  });
}

function canPlaceTown(s, p, v) {
  const b = s.board.vertices[v].building;
  return !!b && b.p === p && b.t === 'village';
}

function validSpots(s, p, kind) {
  if (kind === 'village') return s.board.vertices.filter((V) => canPlaceVillage(s, p, V.id)).map((V) => V.id);
  if (kind === 'town') return s.board.vertices.filter((V) => canPlaceTown(s, p, V.id)).map((V) => V.id);
  if (kind === 'road') return s.board.edges.filter((E) => canPlaceRoad(s, p, E.id)).map((E) => E.id);
  return [];
}

// ---------- longest road ----------
function longestRoadOf(s, p) {
  const { vertices, edges } = s.board;
  let best = 0;
  const blocked = (v) => vertices[v].building && vertices[v].building.p !== p;
  const used = new Set();
  function dfs(v, len) {
    if (len > best) best = len;
    if (len > 0 && blocked(v)) return;
    for (const e of vertices[v].edges) {
      if (edges[e].road !== p || used.has(e)) continue;
      used.add(e);
      dfs(edges[e].a === v ? edges[e].b : edges[e].a, len + 1);
      used.delete(e);
    }
  }
  const starts = new Set();
  edges.forEach((E) => { if (E.road === p) { starts.add(E.a); starts.add(E.b); } });
  starts.forEach((v) => dfs(v, 0));
  return best;
}

function updateLongestRoad(s) {
  s.players.forEach((P, i) => { P.road = longestRoadOf(s, i); });
  const lens = s.players.map((P) => P.road);
  const max = Math.max(...lens);
  const h = s.longestHolder;
  const prev = h;
  if (h >= 0 && lens[h] >= 5 && lens[h] === max) return; // holder keeps it on ties
  const leaders = lens.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
  s.longestHolder = max >= 5 && leaders.length === 1 ? leaders[0] : -1;
  if (s.longestHolder !== prev) {
    if (s.longestHolder >= 0) log(s, `🛤️ ${s.players[s.longestHolder].name} takes Longest Road (${max}).`);
    else log(s, '🛤️ Longest Road is now unclaimed.');
  }
}

// ---------- actions ----------
function checkWin(s) {
  if (s.phase !== 'main') return;
  const p = s.cur;
  if (vp(s, p) >= s.target) {
    s.phase = 'over';
    s.winner = p;
    log(s, `🏆 ${s.players[p].name} wins with ${vp(s, p)} points!`);
  }
}

function placeVillage(s, v) {
  const p = s.cur;
  const P = s.players[p];
  if (!canPlaceVillage(s, p, v) || P.villages >= LIMITS.village) return false;
  if (s.phase === 'main') {
    if (!canAfford(P.hand, COSTS.village)) return false;
    pay(P.hand, COSTS.village);
  }
  s.board.vertices[v].building = { p, t: 'village' };
  P.villages++;
  log(s, `🏠 ${P.name} founds a village.`);
  if (s.phase === 'setup') {
    // Second round of setup: collect from neighbouring tiles.
    if (s.setup.step >= s.players.length) {
      const got = [];
      s.board.vertices[v].tiles.forEach((ti) => {
        const T = s.board.tiles[ti];
        if (RES.includes(T.type)) { P.hand[T.type]++; got.push(RES_INFO[T.type].icon); }
      });
      if (got.length) log(s, `   ${P.name} collects ${got.join(' ')}`);
    }
    s.setup.need = 'road';
    s.setup.lastVertex = v;
  } else {
    updateLongestRoad(s);
    checkWin(s);
  }
  return true;
}

function placeRoad(s, e) {
  const p = s.cur;
  const P = s.players[p];
  if (!canPlaceRoad(s, p, e) || P.roads >= LIMITS.road) return false;
  if (s.phase === 'main') {
    if (!canAfford(P.hand, COSTS.road)) return false;
    pay(P.hand, COSTS.road);
  }
  s.board.edges[e].road = p;
  P.roads++;
  updateLongestRoad(s);
  if (s.phase === 'setup') {
    s.setup.step++;
    s.setup.need = 'village';
    s.setup.lastVertex = null;
    if (s.setup.step >= s.setup.order.length) {
      s.phase = 'main';
      s.cur = 0;
      log(s, '⛵ Setup complete — let the trading begin!');
      log(s, `— Turn ${s.turn}: ${s.players[0].name} —`);
    } else {
      s.cur = s.setup.order[s.setup.step];
    }
  } else {
    log(s, `🛤️ ${P.name} builds a road.`);
    checkWin(s);
  }
  return true;
}

function placeTown(s, v) {
  const p = s.cur;
  const P = s.players[p];
  if (!canPlaceTown(s, p, v) || P.towns >= LIMITS.town || !canAfford(P.hand, COSTS.town)) return false;
  pay(P.hand, COSTS.town);
  s.board.vertices[v].building.t = 'town';
  P.villages--;
  P.towns++;
  log(s, `🏰 ${P.name} upgrades to a town.`);
  checkWin(s);
  return true;
}

function rollDice(s, rng = Math.random) {
  if (s.phase !== 'main' || s.rolled || s.pending) return false;
  const a = 1 + Math.floor(rng() * 6);
  const b = 1 + Math.floor(rng() * 6);
  s.dice = [a, b];
  s.rolled = true;
  const total = a + b;
  log(s, `🎲 ${s.players[s.cur].name} rolls ${total}.`);
  if (total === 7) {
    const queue = s.players.map((P, i) => (handSize(P.hand) > 7 ? i : -1)).filter((i) => i >= 0);
    log(s, '⛈️ A storm gathers!');
    s.pending = queue.length ? { type: 'discard', queue } : { type: 'storm' };
    return true;
  }
  const gains = s.players.map(() => emptyHand());
  s.board.tiles.forEach((T) => {
    if (T.number !== total || T.id === s.board.storm) return;
    T.v.forEach((v) => {
      const b = s.board.vertices[v].building;
      if (b) gains[b.p][T.type] += b.t === 'town' ? 2 : 1;
    });
  });
  gains.forEach((g, i) => {
    const parts = RES.filter((r) => g[r]).map((r) => `${g[r]}${RES_INFO[r].icon}`);
    RES.forEach((r) => { s.players[i].hand[r] += g[r]; });
    if (parts.length) log(s, `   ${s.players[i].name} gets ${parts.join(' ')}`);
  });
  return true;
}

function discardNeeded(s, p) { return Math.floor(handSize(s.players[p].hand) / 2); }

function discard(s, p, cards) {
  if (!s.pending || s.pending.type !== 'discard' || !s.pending.queue.includes(p)) return false;
  const P = s.players[p];
  const n = RES.reduce((t, r) => t + (cards[r] || 0), 0);
  if (n !== discardNeeded(s, p) || RES.some((r) => (cards[r] || 0) > P.hand[r] || (cards[r] || 0) < 0)) return false;
  RES.forEach((r) => { P.hand[r] -= cards[r] || 0; });
  log(s, `   ${P.name} discards ${n} cards.`);
  s.pending.queue = s.pending.queue.filter((q) => q !== p);
  if (!s.pending.queue.length) s.pending = { type: 'storm' };
  return true;
}

function stealVictims(s, tile) {
  const set = new Set();
  s.board.tiles[tile].v.forEach((v) => {
    const b = s.board.vertices[v].building;
    if (b && b.p !== s.cur && handSize(s.players[b.p].hand) > 0) set.add(b.p);
  });
  return [...set];
}

function moveStorm(s, tile, rng = Math.random) {
  if (!s.pending || s.pending.type !== 'storm' || tile === s.board.storm) return false;
  s.board.storm = tile;
  log(s, `⛈️ ${s.players[s.cur].name} moves the storm.`);
  const victims = stealVictims(s, tile);
  if (victims.length === 0) s.pending = null;
  else if (victims.length === 1) { s.pending = null; steal(s, victims[0], rng); }
  else s.pending = { type: 'steal', victims };
  return true;
}

function steal(s, victim, rng = Math.random) {
  const V = s.players[victim];
  const pool = [];
  RES.forEach((r) => { for (let i = 0; i < V.hand[r]; i++) pool.push(r); });
  if (s.pending && s.pending.type === 'steal') s.pending = null;
  if (!pool.length) return false;
  const r = pool[Math.floor(rng() * pool.length)];
  V.hand[r]--;
  s.players[s.cur].hand[r]++;
  log(s, `   ${s.players[s.cur].name} steals a card from ${V.name}.`);
  return true;
}

function tradeRate(s, p, res) {
  let rate = 4;
  s.board.vertices.forEach((V) => {
    if (!V.harbor || !V.building || V.building.p !== p) return;
    if (V.harbor === res) rate = Math.min(rate, 2);
    else if (V.harbor === 'any') rate = Math.min(rate, 3);
  });
  return rate;
}

function canAct(s) { return s.phase === 'main' && s.rolled && !s.pending; }

function bankTrade(s, give, get) {
  const P = s.players[s.cur];
  const rate = tradeRate(s, s.cur, give);
  if (!canAct(s) || give === get || P.hand[give] < rate) return false;
  P.hand[give] -= rate;
  P.hand[get]++;
  log(s, `🏦 ${P.name} trades ${rate}${RES_INFO[give].icon} → 1${RES_INFO[get].icon}`);
  return true;
}

function playerTrade(s, other, give, get) {
  const A = s.players[s.cur];
  const B = s.players[other];
  if (!canAct(s) || other === s.cur) return false;
  if (!canAfford(A.hand, give) || !canAfford(B.hand, get)) return false;
  if (handSize(give) + handSize(get) === 0) return false;
  RES.forEach((r) => {
    A.hand[r] += (get[r] || 0) - (give[r] || 0);
    B.hand[r] += (give[r] || 0) - (get[r] || 0);
  });
  const fmt = (h) => RES.filter((r) => h[r]).map((r) => `${h[r]}${RES_INFO[r].icon}`).join(' ') || 'nothing';
  log(s, `🤝 ${A.name} gives ${fmt(give)} to ${B.name} for ${fmt(get)}`);
  return true;
}

function makeOffer(s, to, give, get, rng = Math.random) {
  const A = s.players[s.cur];
  if (!canAct(s) || to === s.cur || !s.players[to] || !canAfford(A.hand, give)) return false;
  if (handSize(give) + handSize(get) === 0) return false;
  s.offer = { id: Math.floor(rng() * 1e9), from: s.cur, to, give: { ...emptyHand(), ...give }, get: { ...emptyHand(), ...get } };
  log(s, `📨 ${A.name} offers a trade to ${s.players[to].name}.`);
  return true;
}

function cancelOffer(s) {
  if (!s.offer) return false;
  s.offer = null;
  return true;
}

function respondOffer(s, p, accept) {
  const o = s.offer;
  if (!o || o.to !== p || o.from !== s.cur) return false;
  s.offer = null;
  if (!accept) { log(s, `   ${s.players[p].name} declines.`); return true; }
  if (!playerTrade(s, p, o.give, o.get)) log(s, '   The trade fell through: someone no longer has the cards.');
  return true;
}

function endTurn(s) {
  if (!canAct(s)) return false;
  s.offer = null;
  s.cur = (s.cur + 1) % s.players.length;
  s.rolled = false;
  s.dice = null;
  if (s.cur === 0) s.turn++;
  log(s, `— Turn ${s.turn}: ${s.players[s.cur].name} —`);
  return true;
}
