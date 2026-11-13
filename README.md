# Hexhaven

An original island-settling board game for 2–6 players, played hot-seat in the browser. Gather resources, trade, and build roads, villages and towns until someone reaches the target score.

## Play

**Online with friends:** open the published page on claude.ai, enter your name, and click **Create online game**. Tell friends the 5-character code; they open the same page and join from the list or by typing the code. Each player sees only their own hand. Friends need a claude.ai account and edit access to the page (Share → invite by email as Editor).

**On one device:** open `index.html` in any modern browser and choose **New game on this device**. There's no build step, no server and no dependencies. Your game is saved automatically in the browser.

To republish the online version, run `node tools/build-artifact.js` and publish `dist/hexhaven.html` with the `db` and `user` capabilities.

## Maps

All maps are free. Each has a seed, so you can share a layout or roll a new one.

| Map | Tiles | Notes |
|---|---|---|
| Classic Isle | 19 | Standard hexagon, best for 3–4 |
| Grand Isle | 37 | Big hexagon, best for 5–6 |
| Lagoon Ring | 18 | Ring of land around an inland sea |
| Twin Isles | 22 | Two random islands |
| Archipelago | 28 | Seven small islands |
| Long Coast | 21 | A 3×7 strip |
| Wild Shores | 24 | Randomly grown coastline |

To add a map, add an entry to `MAPS` in `js/board.js` that returns a list of axial `{q, r}` hexes. Terrain, numbers, harbors and the board graph are generated automatically.

## Rules in brief

- **Points:** village 1, town 2, Longest Road (5+ segments) 2. Default target is 10.
- **Costs:** Road = Timber + Clay · Village = Timber + Clay + Fiber + Grain · Town = 2 Grain + 3 Stone.
- **Rolling 7:** players holding more than 7 cards discard half. The roller moves the storm and steals a card.
- **Trading:** 4:1 with the bank, 3:1 or 2:1 at harbors, or any deal with another player.

## Code

- `js/board.js`: map shapes, terrain and number placement, harbors, vertex/edge graph
- `js/rules.js`: game state and rules (plain JSON state)
- `js/ui.js`: SVG rendering, online lobbies and sync, one-device mode, dialogs
- `tools/build-artifact.js`: bundles everything into `dist/hexhaven.html`
