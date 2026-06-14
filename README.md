# PAM Viewer

A browser-based viewer and exporter for PopCap PAM (PopAnim) animation files, used in *Plants vs. Zombies 2*.

**Live Demo**: https://lambdaed1th.github.io/pam-viewer/

## Features

- **Load & Play**: Drag-and-drop a folder containing `.pam.json` (or `.pam` binary) and PNG textures
- **Playback Controls**: Play/pause, frame stepping, speed adjustment, loop, reverse, autoplay
- **Frame Labels**: Jump to named animation segments (idle, walk, attack, …), parsed from PAM `label`/`stop` flags
- **Frame Range**: Custom begin/end range for looping or single-segment playback
- **Sprite & Image Filters**: Regex-based toggle; specialized PvZ2 plant-layer / zombie-state selectors
- **Zoom & Pan**: Scroll-to-zoom, drag-to-pan, reset, coordinate readout
- **Render Features**:
  - Per-channel RGB colour multiplication (feColorMatrix equivalent)
  - Additive sprite compositing (Flash "lighter" blend mode)
  - `spriteFrameNumber` / `timeScale` / `sourceRectangle` support
  - Auto-computed animation bounding box — export & boundary box always fit the content
- **Export**:
  | Format | Description |
  |--------|-------------|
  | **PNG** | Current frame at selected scale |
  | **APNG** | Animated PNG of the current frame range |
  | **WebP** | Animated WebP (Chrome / Firefox; Safari hidden) |
  | **FLA** | Adobe Animate project (XFL-in-ZIP) with media textures — **round-trip safe** |
  | **JSON** | `.pam.json` interchange format |
  | **YAML / TOML** | Alternate text formats |
  | **PAM** | Raw binary `.pam` (version 1–6) |
- **FLA Import**: Load exported FLA files back — preserves image names, version, frame rate, and position via `PAM.sidecar.json`
- **I18N**: Simplified Chinese & English, persisted language preference

## Usage

1. Open the page (or run `npm run dev` for local development)
2. Click 📂 or drag-and-drop a folder containing:
   - A `.pam.json` or `.pam` file (the animation definition)
   - PNG images referenced by the animation
3. Use the toolbar to control playback, filters, and export

### Build

`pam-viewer` builds its local Rust/WASM wrapper crate with `wasm-pack`.
The wrapper depends on `pam-codec` through its GitHub URL: `https://github.com/LambdaEd1th/pam-codec`.

```bash
cargo install wasm-pack
npm install
npm run build:wasm # optional; dev/build run this automatically
npm run dev      # Vite dev server with HMR
npm run build    # type-check + production build → dist/
npm run preview  # preview the production build
```

## File Format

PAM (PopAnim) is PopCap's proprietary animation format. Each animation contains:

- **Images**: bitmap references with affine transforms (translate / rotate-translate / matrix-translate)
- **Sprites**: timelines of layered image/sprite instances with per-frame transforms, colour tinting, and blend modes
- **Main Sprite**: the root timeline that composes all sprites

The viewer loads both the JSON representation (`.pam.json`) and the raw binary format (`.pam`, versions 1–6).

## XFL / FLA Round-Trip

The FLA export generates a complete Adobe Animate project:

```
FLA.zip
├── DOMDocument.xml          — project metadata, flow/command/sprite layers
├── PAM.sidecar.json         — round-trip metadata (version, frame rate, position, size, image names)
└── LIBRARY/
    ├── source/source_N.xml  — bitmap source symbols
    ├── image/image_N.xml    — image symbols with transforms
    ├── sprite/sprite_N.xml  — animated sprite symbols
    ├── main.xml             — main animation timeline
    └── media/*.png          — PNG textures (when loaded)
```

Re-importing the FLA restores the original PAM data via the sidecar, so you can export → edit in Animate → re-import without losing metadata.

## Source Structure

```
src/
  main.tsx                 React/Vite bootstrap
  App.tsx                  Viewer shell mount point
  app/
    controller.ts          Pixi/app state controller behind the React bridge
    viewer-bridge.ts       React/controller snapshot stores and command actions
    viewer-controller.ts   Lazy controller mount helper
    viewer-dom.ts          DOM refs needed by the Pixi viewport bridge
    files.ts               Drag/drop, directory walking, image loading
    load-animation.ts      PAM/FLA/XFL loading + texture resolution
    special-layers.ts      PvZ2-specific layer defaults
  components/
    ui/                    shadcn/ui-compatible primitives
    viewer/                React toolbar, panels, stage, tabs, status, overlay
  domain/
    types.ts               Shared TypeScript type definitions
    model.ts               Data parsing, matrix math, colour blending
    timeline.ts            Timeline build + bounding-box computation
  wasm/
    pam-codec/             Generated JS/WASM package, ignored by git
  rendering/
    pixi-renderer.ts       PixiJS v8 rendering engine
  formats/
    pam/
      wasm.ts              Lazy loader for generated pam-codec wasm
      decoder.ts           PAM binary → RawPamJson via pam-codec wasm
      encoder.ts           RawPamJson → PAM binary via pam-codec wasm
      serializer.ts        Animation → RawPamJson
    fla/
      exporter.ts          Animation → FLA (XFL ZIP)
      importer.ts          FLA (XFL ZIP) → RawPamJson + PNG textures
  export/
    apng.ts                Animated PNG encoder
    animated-webp.ts       Animated WebP encoder
    download.ts            Browser download + export naming helpers
  localization/
    i18n.ts                Internationalisation (zh-CN / en)
    use-i18n.ts            React language hook
  styles/
    app.css                Stylesheet
wasm/
  pam-codec-wasm/          Rust/WASM wrapper around pam-codec
```

## Tech Stack

- **TypeScript** (strict mode, ES2022 target)
- **React + Vite** (dev server + bundler)
- **Tailwind CSS + shadcn/ui-compatible primitives**
- **js-yaml** / **smol-toml** for alternate format export
- PixiJS v8 rendering

## Author

[LambdaEd1th](https://github.com/LambdaEd1th)

## License

[GNU General Public License v3.0](LICENSE)
