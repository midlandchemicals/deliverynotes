# MAIZE RAISER — The Growth Protocol

A launch experience for a fictional, futuristic fertiliser brand where **the
product *is* the interface**. Built to feel less like a fertiliser website and
more like the reveal page for a consumer-technology brand: a floating 3D can,
oversized type, an OS-style HUD, and crypto-native language.

> _"Less fertiliser. More technology."_

## What it does

- **Floating 3D can** — the hero is a procedurally-built aluminium can (no model
  files), rendered with Three.js + WebGL. It floats, auto-rotates, reacts to the
  pointer (parallax + tilt), can be **dragged to spin** (with momentum), and is
  **choreographed by scroll** — repositioning and re-scaling as you move between
  sections so content and 3D stay fused.
- **Oversized typography** — a giant `MAIZE / RAISER` lockup brackets the can and
  dominates the viewport; every section headline is display-scale.
- **OS / HUD framing** — fixed corner brackets, vertical rails, a live
  coordinate + clock readout, a scroll telemetry %, and a faint interface grid
  overlay give the whole page a "futuristic operating system" feel.
- **Crypto-native dressing** — a boot/mint sequence, a `CONNECT` control, batch
  hashes, `$MZR`, on-chain "verification", a terminal-style reservation form, and
  a scrolling marquee.
- **Premium motion** — custom cursor, magnetic buttons, reveal-on-scroll,
  count-up stats, subtle bloom on the lime accents. Honors
  `prefers-reduced-motion` and falls back to a static styled hero without WebGL.

## Run it

It's a **zero-build static site**. Three.js (r160) is **vendored locally** under
`vendor/three/` and loaded as native ES modules via an import map — there is **no
runtime CDN dependency** for the 3D engine, so it works fully offline (only the
Google Fonts request needs the network, and the layout degrades gracefully
without it). You just need any static file server:

```bash
# from this folder — pick any one:
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed URL (e.g. http://localhost:8080).

> Opening `index.html` directly via `file://` will **not** work — ES module
> imports require an `http(s)` origin. Use one of the servers above.

## Files

| File         | Role                                                                |
|--------------|---------------------------------------------------------------------|
| `index.html` | Structure, HUD, sections, Three.js import map                       |
| `styles.css` | All styling — palette, oversized type, HUD, reveals, responsiveness |
| `scene.js`   | Three.js scene: the can geometry, canvas label, lights, bloom, input|
| `ui.js`      | DOM layer: boot, cursor, HUD, reveals, counters, nav, form          |
| `main.js`    | Entry point — wires scene ↔ UI, WebGL fallback                      |
| `vendor/three/` | Pinned Three.js r160 (core + the postprocessing/env addons used) |

## Design notes

- **Palette is deliberately minimal**: near-black `#06070b`, a single acid-lime
  accent `#c6ff3a`, off-white, and greys — high contrast keeps attention on the
  can.
- The can label is **drawn to a `<canvas>` at runtime** and wrapped onto the
  cylinder, so the brand is baked into the geometry with no image assets.
- Reflections come from a procedural `RoomEnvironment` (no HDR files).
- Tuned for performance: pixel ratio capped, rendering pauses on hidden tabs,
  particle field disabled under reduced-motion.
