# Hexhaven

An original island-settling board game for 2–6 players, played hot-seat in the browser. Gather resources, trade, and build roads, villages and towns until someone reaches the target score.

## Play

Open `index.html` in any modern browser. There's no build step, no server and no dependencies. Your game is saved automatically in the browser.

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
- `js/ui.js`: SVG rendering, setup screen, dialogs
