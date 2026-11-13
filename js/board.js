// Hexhaven — board generation: map shapes, resources, number tokens, harbors, vertex/edge graph.
'use strict';

const RES = ['timber', 'clay', 'fiber', 'grain', 'stone'];
const RES_INFO = {
  timber: { name: 'Timber', color: '#3d7a3a', icon: '🌲', land: 'Forest' },
  clay:   { name: 'Clay',   color: '#c2683f', icon: '🧱', land: 'Clay Pit' },
  fiber:  { name: 'Fiber',  color: '#9bc45a', icon: '🌿', land: 'Flax Meadow' },
  grain:  { name: 'Grain',  color: '#e3bf4a', icon: '🌾', land: 'Fields' },
  stone:  { name: 'Stone',  color: '#8a8f99', icon: '🪨', land: 'Quarry' },
  waste:  { name: 'Wasteland', color: '#d9c49a', icon: '🏜️', land: 'Wasteland' },
};

const HEX_SIZE = 60;
const SQRT3 = Math.sqrt(3);
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const hkey = (q, r) => q + ',' + r;
const hdist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
const neighbors = (h) => DIRS.map(([dq, dr]) => ({ q: h.q + dq, r: h.r + dr }));

function hexagon(radius, minRadius = 0) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const h = { q, r };
      const d = hdist(h, { q: 0, r: 0 });
      if (d <= radius && d >= minRadius) out.push(h);
    }
  }
  return out;
}

// Grow separate islands from centres; islands never touch (always at least one water hex between them).
function growIslands(rng, centers, sizes) {
  const owner = new Map();
  const islands = centers.map((c, i) => {
    owner.set(hkey(c.q, c.r), i);
    return [c];
  });
  const touchesOther = (h, i) =>
    neighbors(h).some((n) => owner.has(hkey(n.q, n.r)) && owner.get(hkey(n.q, n.r)) !== i);
  let progress = true;
  while (progress) {
    progress = false;
    islands.forEach((isl, i) => {
      if (isl.length >= sizes[i]) return;
      const frontier = [];
      isl.forEach((h) => neighbors(h).forEach((n) => {
        if (!owner.has(hkey(n.q, n.r)) && !touchesOther(n, i)) frontier.push(n);
      }));
      if (!frontier.length) return;
      // Prefer cells with more same-island neighbours, so islands stay compact-ish.
      const scored = frontier.map((n) => ({
        n,
        s: neighbors(n).filter((m) => owner.get(hkey(m.q, m.r)) === i).length + rng() * 2.5,
      }));
      scored.sort((a, b) => b.s - a.s);
      const pick = scored[0].n;
      owner.set(hkey(pick.q, pick.r), i);
      isl.push(pick);
      progress = true;
    });
  }
  return islands.flat();
}

const MAPS = {
  classic: {
    name: 'Classic Isle', desc: '19 tiles · best for 3–4',
    shape: () => hexagon(2),
  },
  grand: {
    name: 'Grand Isle', desc: '37 tiles · best for 5–6',
    shape: () => hexagon(3),
  },
  lagoon: {
    name: 'Lagoon Ring', desc: '18 tiles around an inland sea',
    shape: () => hexagon(2, 1),
  },
  twin: {
    name: 'Twin Isles', desc: 'Two islands · 22 tiles',
    shape: (rng) => growIslands(rng, [{ q: -3, r: 0 }, { q: 3, r: 0 }], [11, 11]),
  },
  archipelago: {
    name: 'Archipelago', desc: 'Seven small islands · 28 tiles',
    shape: (rng) => growIslands(rng, [{ q: 0, r: 0 }, ...DIRS.map(([q, r]) => ({ q: q * 4, r: r * 4 }))], [4, 4, 4, 4, 4, 4, 4]),
  },
  coast: {
    name: 'Long Coast', desc: 'A 3×7 strip of land · 21 tiles',
    shape: () => {
      const out = [];
      for (let row = 0; row < 3; row++) for (let col = 0; col < 7; col++) out.push({ q: col - Math.floor(row / 2) - 3, r: row - 1 });
      return out;
    },
  },
  wild: {
    name: 'Wild Shores', desc: 'Random coastline · 24 tiles',
    shape: (rng) => growIslands(rng, [{ q: 0, r: 0 }], [24]),
  },
};

const NUMBER_POOL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const pips = (n) => (n ? 6 - Math.abs(7 - n) : 0);

function hexCenter(q, r) {
  return { x: HEX_SIZE * SQRT3 * (q + r / 2), y: HEX_SIZE * 1.5 * r };
}
function hexCorner(cx, cy, i, size = HEX_SIZE) {
  const a = (Math.PI / 180) * (60 * i - 30);
  return { x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) };
}

function assignTerrain(rng, n) {
  const deserts = Math.max(1, Math.round(n / 19));
  const weights = { timber: 4, fiber: 4, grain: 4, clay: 3, stone: 3 };
  const totalW = 18;
  const remaining = n - deserts;
  const counts = {};
  let assigned = 0;
  RES.forEach((r) => { counts[r] = Math.floor((remaining * weights[r]) / totalW); assigned += counts[r]; });
  // Distribute leftovers to the higher-weight resources first.
  const order = ['timber', 'fiber', 'grain', 'clay', 'stone'];
  for (let i = 0; assigned < remaining; i++, assigned++) counts[order[i % 5]]++;
  const list = [];
  for (let i = 0; i < deserts; i++) list.push('waste');
  RES.forEach((r) => { for (let i = 0; i < counts[r]; i++) list.push(r); });
  return shuffle(list, rng);
}

function assignNumbers(rng, tiles) {
  const prod = tiles.filter((t) => t.type !== 'waste');
  const pool = [];
  while (pool.length < prod.length) pool.push(...NUMBER_POOL);
  pool.length = prod.length;
  const byKey = new Map(tiles.map((t) => [hkey(t.q, t.r), t]));
  let best = null;
  let bestBad = Infinity;
  for (let attempt = 0; attempt < 400; attempt++) {
    shuffle(pool, rng);
    prod.forEach((t, i) => { t.number = pool[i]; });
    let bad = 0;
    prod.forEach((t) => {
      if (t.number !== 6 && t.number !== 8) return;
      neighbors(t).forEach((n) => {
        const o = byKey.get(hkey(n.q, n.r));
        if (o && (o.number === 6 || o.number === 8)) bad++;
      });
    });
    if (bad < bestBad) { bestBad = bad; best = pool.slice(); }
    if (bad === 0) break;
  }
  prod.forEach((t, i) => { t.number = best[i]; });
}

function generateBoard(mapKey, seed) {
  const rng = mulberry32(seed);
  const def = MAPS[mapKey] || MAPS.classic;
  const shape = def.shape(rng);
  const types = assignTerrain(rng, shape.length);
  const tiles = shape.map((h, i) => {
    const c = hexCenter(h.q, h.r);
    return { id: i, q: h.q, r: h.r, x: c.x, y: c.y, type: types[i], number: 0, v: [], e: [] };
  });
  assignNumbers(rng, tiles);

  // Vertex / edge graph.
  const vertices = [];
  const edges = [];
  const vmap = new Map();
  const emap = new Map();
  tiles.forEach((t) => {
    for (let i = 0; i < 6; i++) {
      const p = hexCorner(t.x, t.y, i);
      const k = Math.round(p.x * 10) + ',' + Math.round(p.y * 10);
      let v = vmap.get(k);
      if (v === undefined) {
        v = vertices.length;
        vmap.set(k, v);
        vertices.push({ id: v, x: p.x, y: p.y, tiles: [], adj: [], edges: [], harbor: null, building: null });
      }
      vertices[v].tiles.push(t.id);
      t.v.push(v);
    }
    for (let i = 0; i < 6; i++) {
      const a = t.v[i];
      const b = t.v[(i + 1) % 6];
      const k = Math.min(a, b) + '-' + Math.max(a, b);
      let e = emap.get(k);
      if (e === undefined) {
        e = edges.length;
        emap.set(k, e);
        edges.push({ id: e, a, b, tiles: [], road: null });
        vertices[a].adj.push(b); vertices[a].edges.push(e);
        vertices[b].adj.push(a); vertices[b].edges.push(e);
      }
      edges[e].tiles.push(t.id);
      t.e.push(e);
    }
  });

  // Water ring for drawing.
  const landKeys = new Set(tiles.map((t) => hkey(t.q, t.r)));
  const waterKeys = new Set();
  const water = [];
  // Two rings of sea around every coast, so channels between islands are filled in.
  let ring = tiles.map((t) => ({ q: t.q, r: t.r }));
  for (let depth = 0; depth < 2; depth++) {
    const next = [];
    ring.forEach((h) => neighbors(h).forEach((n) => {
      const k = hkey(n.q, n.r);
      if (!landKeys.has(k) && !waterKeys.has(k)) { waterKeys.add(k); water.push({ q: n.q, r: n.r, ...hexCenter(n.q, n.r) }); next.push(n); }
    }));
    ring = next;
  }

  // Harbors on coastal edges, spread around the coastline.
  const cx = tiles.reduce((s, t) => s + t.x, 0) / tiles.length;
  const cy = tiles.reduce((s, t) => s + t.y, 0) / tiles.length;
  const coastal = edges.filter((e) => e.tiles.length === 1).map((e) => {
    const A = vertices[e.a]; const B = vertices[e.b];
    const mx = (A.x + B.x) / 2; const my = (A.y + B.y) / 2;
    return { e, mx, my, ang: Math.atan2(my - cy, mx - cx) };
  });
  coastal.sort((a, b) => a.ang - b.ang);
  const H = Math.max(3, Math.min(Math.round(coastal.length * 0.3), Math.round(tiles.length * 0.5)));
  const step = coastal.length / H;
  const offset = rng() * step;
  const harbors = [];
  const used = new Set();
  for (let i = 0; i < H; i++) {
    const c = coastal[Math.floor(offset + i * step) % coastal.length];
    if (used.has(c.e.a) || used.has(c.e.b)) continue;
    // Keep a vertex gap between harbors.
    if (vertices[c.e.a].adj.some((x) => used.has(x)) || vertices[c.e.b].adj.some((x) => used.has(x))) continue;
    used.add(c.e.a); used.add(c.e.b);
    const t = tiles[c.e.tiles[0]];
    harbors.push({ edge: c.e.id, tile: t.id, type: null });
  }
  const htypes = harbors.map((_, i) => (i % 9 < 5 ? RES[i % 9] : 'any'));
  shuffle(htypes, rng);
  harbors.forEach((h, i) => {
    h.type = htypes[i];
    const e = edges[h.edge];
    vertices[e.a].harbor = h.type;
    vertices[e.b].harbor = h.type;
  });

  const storm = tiles.findIndex((t) => t.type === 'waste');
  return { mapKey, seed, tiles, vertices, edges, water, harbors, storm };
}
