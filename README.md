# Realm of Crystals

A real-time strategy game in 3D, built with three.js for **DisplayXR** glasses-free 3D displays.
Gather crystal and wood, build a base, train an army and destroy the AI's Keep.

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # static build in dist/
```

Live build: https://realm-of-crystals.vercel.app

## DisplayXR

The game uses the official DisplayXR web SDK, [`@displayxr/inline3d`](https://www.npmjs.com/package/@displayxr/inline3d):

- **DisplayXR Browser on a spatial display:** the game canvas becomes a woven 3D window. The top bar shows **DisplayXR 3D**.
- **Any other browser:** the game runs as a normal 2D game. The top bar shows **2D**. Press **F3** for a red/cyan stereo preview.

The stereo code is in `src/displayxr.js`. It follows the SDK's porting guide:

- **Rig:** it uses a camera rig with the attach pattern, so the stereo does not lag the camera by a frame.
- **Depth:** `groundPlaneRig()` sets convergence and eye separation. The ground at the centre of the view sits on the glass, and the map is tilted in depth.
- **Zoom limit:** zoom-in stops before tall objects at the bottom of the screen come too far out of the screen.
- **Frame safety:** if a frame cannot draw both eyes, the last good stereo frame is drawn again instead of a blank one.
- **Fallback:** if the 3D layer is lost, the game switches back to 2D.

The page passes all checks of the SDK's headless `inline3d-check` (in a simulated DisplayXR Browser and in plain 2D). That is a simulated check, not a test on a real 3D panel.

## Gameplay

You play the **Azure Order** (KayKit adventurers) against the undead **Bone Legion** (KayKit skeletons).

| Unit / building | Role |
|---|---|
| Worker | Gathers crystal and wood, builds structures |
| Knight | Sword-and-shield melee fighter, trained at the Barracks |
| Ranger | Crossbow fighter, trained at the Archery Range |
| Mage | Fires arcane orbs with splash damage, trained at the Arcane Sanctum |
| Catapult | Siege unit with splash damage, built at the Siege Workshop |
| Castle | Trains workers, accepts resources, shoots arrows. If it falls, you lose |
| House | +6 population |
| Lumber Mill / Crystal Mine | Drop-off points for wood / crystal |
| Guard Tower | Defensive tower |

**Map layout:**
- 96×96 map, identical for both sides when rotated 180°.
- A river with three shallow fords separates the two bases.
- Each base has a crystal line and a wood line nearby.
- Expansion crystal fields sit near the side fords, and a contested field sits near the centre ford.
- Forests and rock outcrops make natural chokepoints.

**AI opponent (`src/ai.js`):**
- Runs its economy and builds more windmills as it needs population.
- Builds barracks, towers and a siege workshop.
- Trains a mix of knights, rangers and catapults.
- Defends its base and sends larger attack waves over time.
- Has Easy, Normal and Hard difficulty.

### Controls

| Input | Action |
|---|---|
| Left click / drag | Select units. Shift adds to the selection; double-click selects all units of that type |
| Right click | Context command: move, attack, gather, build, set rally point |
| Arrows, screen edge, middle-drag | Pan the camera |
| Wheel, `[` `]`, Ctrl+wheel | Zoom, rotate |
| Q W E R Z X C V / A / S / D | Command-card buttons / attack-move / stop / return cargo |
| Ctrl+1–9, 1–9 | Save / recall control groups |
| H or Space, `.` | Jump to the Keep, cycle through idle workers |
| P, F2, F3 | Pause, toggle graphics quality, toggle the stereo preview |

## Code layout

```
src/main.js       renderer, 2D loop, menus
src/displayxr.js  DisplayXR inline-3D stereo path
src/terrain.js    height field, river and fords, walkability grid, A* pathfinding
src/world.js      map population: resources, forests, rocks, decor (instanced)
src/assets.js     model loading, team colours, building assembly from modular kits
src/entities.js   Unit and Building behaviour (gather / build / fight / train)
src/game.js       game state, combat, projectiles, commands
src/fx.js         GPU particle effects (fire, smoke, magic, dust, shockwaves)
src/icons.js      3D unit/building portraits for the HUD
src/ai.js         enemy AI
src/input.js      selection, orders, building placement
src/hud.js        resource bar, selection panel, command card, rotating minimap
```

## Credits (all CC0)

- KayKit by Kay Lousberg: Character Pack Adventures, Character Pack Skeletons, Medieval Hexagon Pack. https://kaylousberg.com

- Kenney: Castle Kit, Fantasy Town Kit, Tower Defense Kit, Nature Kit. https://kenney.nl (licenses in `public/licenses/`)
