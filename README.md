# Definitely Not a Trap!

A desktop-first browser platformer built with Phaser, TypeScript, and Vite. Play through five short Adventure Mode levels. Progress is stored on the device.

## Run locally

```sh
npm ci
npm run dev
npm run build
npm run preview
```

Move with **A / D** or the **arrow keys**. Jump using **Space**, **W**, or **↑**. Tap jump for a short hop or hold it for height. Press **Esc** to pause and **R** to retry the current checkpoint. Menus support Tab and Enter.

Open the `.tmj` maps in `src/maps` with Tiled to edit platforms, traps, coins, and narrator triggers. The map's coordinate system matches the game world. Surface rectangles define platforms. The Objects layer uses point objects with a type and an optional integer `range` property. Narrator points use a string `text` property.

The five backdrops and the eight-pose hero sprite sheet in `public/art` were generated from the approved Easy Peasy concept using ImageGen. The original concept is in `design/easy-peasy-reference.png`.
