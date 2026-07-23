# PAM Viewer

A Web and native viewer/editor for PopCap PAM (PopAnim) animations used by *Plants vs. Zombies 2*.

**Live demo:** https://lambdaed1th.github.io/pam-viewer/

## Highlights

- Dioxus 0.7 application shared by WebAssembly and native desktop builds
- Pure Rust WGPU renderer running in an OffscreenCanvas Worker on Web and directly on the native window
- Processing Worker pool for PAM/image decoding and every export format, with Rayon-backed native parity
- Direct `pam-codec` Git dependency for PAM binary decoding/encoding and strict serde JSON
- Folder and drag-and-drop loading for PAM, JSON, YAML, TOML, FLA/XFL, and PNG textures
- Movable tabs and toolbar groups, persistent preferences, resizable side panels, regex filters, and PvZ2-specific layer controls
- Adjustable PAM boundary and independent PNG/APNG/WebP export dimensions
- PNG, APNG, animated WebP, PAM, JSON, YAML, TOML, and Adobe Animate FLA export
- Simplified Chinese and English UI with light, dark, and system themes

## Run

Install stable Rust and the Dioxus CLI once:

```bash
rustup target add wasm32-unknown-unknown
cargo install dioxus-cli --version 0.7.9 --locked
cargo install wasm-pack --version 0.15.0 --locked
```

Start the Web application:

```bash
./scripts/build-web-runtime.sh
dx serve --platform web --package pam-viewer-app
```

Start the native application:

```bash
cargo run -p pam-viewer-app
```

Production builds:

```bash
./scripts/build-web-runtime.sh
dx build --release --platform web --package pam-viewer-app
cargo build --release -p pam-viewer-app
```

The Web build is written to `target/dx/pam-viewer/release/web/public/`. GitHub Actions checks native and Web builds for every change. Tags matching `v*` publish native packages and a Web archive to GitHub Releases, then deploy the Web build to GitHub Pages.

## Input

Load a folder containing an animation definition and its PNG textures. Supported definitions are:

- Binary `.pam`
- Strict pam-codec `.json` / `.pam.json`
- `.yaml`, `.yml`, and `.toml`
- Adobe Animate `.fla` or unpacked XFL files

JSON is serialized and deserialized directly by `pam-codec` serde types. The legacy `[x, y, width, height]` source-rectangle shape is intentionally rejected; source rectangles use `{ "position": [x, y], "size": [width, height] }`.

## FLA/XFL

FLA export follows Twinning's XFL symbol and metadata structure while retaining the established sidecar filename:

```text
animation.fla
├── main.xfl
├── DOMDocument.xml
├── PAM.sidecar.json
└── LIBRARY/
    ├── source/source_N.xml
    ├── image/image_N.xml
    ├── sprite/sprite_N.xml
    ├── main_sprite.xml
    └── media/*.png
```

`PAM.sidecar.json` stores Twinning-compatible `position`, `image`, `sprite`, and `main_sprite` metadata. FLA round trips are tested by comparing labels, commands, assets, and every rendered timeline frame rather than requiring the reconstructed sparse command stream to have identical grouping.

## Architecture

```text
app/
  src/
    components/       Dioxus toolbar, tabs, panels, stage, and status UI
    actions/          Loading, playback, filtering, preferences, workspace, and export actions
    platform.rs       Native dialogs/filesystem and browser storage/drop/download APIs
    platform/
      processing.rs   Web Worker pool and native Rayon processing service
      web_renderer.rs Binary-safe bridge to the Web render host
    state.rs          Shared application and tab state
crates/
  core/               pam-codec types, timeline compiler, Worker/render protocols
  formats/            PAM assets, text formats, FLA/XFL, PNG/APNG/WebP
  renderer/           Shared WGPU renderer, OffscreenCanvas host, and native custom paint backend
  worker/             Cached document processing runtime for Web Workers and native tasks
scripts/
  build-web-runtime.sh  Builds the processing and render Worker WASM packages
```

The Web application WASM contains the Dioxus UI only. Parsing, texture decoding, serialization, FLA generation, and raster export run in a separate processing Worker pool. Preview rendering uses a separate WGPU WASM module with OffscreenCanvas and automatically falls back to the same renderer on the browser main thread when OffscreenCanvas Worker rendering is unavailable. Native builds use the same processing requests through Rayon and render directly with WGPU.

There is no React, Vite, PixiJS, shadcn/ui, daisyUI, or Node build step. The UI uses project-local CSS tokens inspired by the compact MoeSekai/rton-editor workspace style.

## Verification

```bash
cargo fmt --all --check
cargo test --workspace
./scripts/build-web-runtime.sh
cargo check --target wasm32-unknown-unknown -p pam-viewer-app
```

The test suite includes strict PAM/JSON round trips, Twinning-style FLA structure and visual-semantic round trips, APNG/WebP container checks, hidden child-sprite behavior, and a real WGPU render of the included sunflower sample.

## License

[GNU Affero General Public License v3.0 or later](LICENSE)
