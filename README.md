# PAM Viewer

A browser-based tool for **PopCap PAM / PopAnim** animation assets, with preview, filtering, export, and format-conversion features for *Plants vs. Zombies 2* workflows.

- Live Demo: <https://lambdaed1th.github.io/pam-viewer/>
- Author: [@LambdaEd1th](https://github.com/LambdaEd1th)

## Features

- **Multi-format loading**: `.pam`, `.pam.json`, `.yaml`, `.toml`, plus `.fla` / XFL folders
- **Playback controls**: play/pause, frame step, loop, reverse, frame range, FPS presets
- **Visual filters**: Sprite/Image panels with regex filtering and quick all/none toggles
- **Stage interaction**: zoom, pan, reset view, optional boundary display
- **PvZ2-specific options**: plant layer, zombie state, ground swatch
- **Export**: PNG (current frame), APNG, WebP, FLA
- **Format conversion**: export as JSON / YAML / TOML / PAM binary
- **Multilingual UI**: Chinese / English

## Quick Start

### 1) Install dependencies

```bash
npm install
```

### 2) Start local development

```bash
npm run dev
```

### 3) Build

```bash
npm run build
```

### 4) Preview production build

```bash
npm run preview
```

## Usage

1. Open the app, click **📂 Load**, or drag a resource folder onto the canvas.
2. A typical resource folder contains:
   - one animation definition file (`.pam` / `.pam.json` / `.yaml` / `.toml` / `.fla`)
   - related PNG texture files
3. Use the top toolbar for playback control, filtering, export, and conversion.

## Tech Stack

- TypeScript
- Vite
- HTML5 Canvas
- js-yaml / smol-toml

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.
See [LICENSE](LICENSE) for details.
