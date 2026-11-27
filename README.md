# Definitely Not a Trap!

A browser platformer built with Phaser, TypeScript, and Vite. Play through six Adventure Mode levels, each with its own traps and checkpoints. Progress is stored on the device.

## Run locally

```sh
npm ci
npm run dev
npm run build
npm run preview
```

Move with **A / D** or the **arrow keys**. Jump using **Space**, **W**, or **↑**. Tap jump for a short hop or hold it for height. The game fills the window and enters fullscreen on the first click when the browser allows it. Press **P** to pause or **R** to retry the current checkpoint. Menus support Tab and Enter. On phones, turn the screen sideways and use the on-screen direction arrows, up arrow to jump, and Pause button. Turning the phone upright during a run pauses the game.

Open the `.tmj` maps in `src/maps` with Tiled to edit platforms, traps, coins, and narrator triggers. The map's coordinate system matches the game world. Surface rectangles define platforms. The Objects layer uses point objects with a type. The integer `range` sets patrol distance, bridge width, chase length, or moving-platform travel, depending on the object. Spikes can set an integer `warningMs` to change their warning duration. A matching `channel` links a switch to a platform. Set `mounted` to true to place the switch on the moving deck. Narrator points use a string `text` property.

The six backdrops and the eight-pose hero sprite sheet in `public/art` were generated from the approved Easy Peasy concept using ImageGen. The original concept is in `design/easy-peasy-reference.png`.
