# PAM Viewer

A browser-based viewer and exporter for PopCap PAM (PopAnim) animation files, commonly used in *Plants vs. Zombies 2*.

**Live Demo**: https://lambdaed1th.github.io/pam-viewer/

## Features

- **Load & Play**: Drag-and-drop a folder containing `.pam.json` (or `.pam` binary) and PNG textures
- **Playback Controls**: Play/pause, frame stepping, speed adjustment, loop, reverse
- **Frame Labels**: Jump to named animation labels (idle, walk, attack, etc.)
- **Sprite & Image Filters**: Toggle individual sprites/images on or off with regex filtering
- **Plant Layers / Zombie States**: Specialized layer selectors for PvZ2 animations
- **Zoom & Pan**: Scroll to zoom, drag to pan, reset with one click
- **Export**:
  - **PNG** — current frame
  - **GIF** — animated GIF of the current frame range
  - **Sprite Sheet** — all frames in a single PNG
  - **FLA** — Adobe Animate project (XFL format in ZIP), including media textures

## Usage

1. Open the page in a modern browser
2. Click 📂 or drag-and-drop a folder containing:
   - A `.pam.json` or `.pam` file (the animation definition)
   - PNG images referenced by the animation
3. Use the toolbar to control playback and export

## File Format

PAM (PopAnim) is PopCap's proprietary animation format. Each animation contains:
- **Images**: bitmap references with affine transforms
- **Sprites**: timelines of layered image/sprite instances with per-frame transforms and color tinting
- **Main Sprite**: the root timeline that composes all sprites

The viewer can load both the JSON representation (`.pam.json`) and the raw binary format (`.pam`).

## XFL/FLA Export

The FLA export generates a complete Adobe Animate project structure:
- `DOMDocument.xml` — project metadata, flow/command/sprite layers
- `LIBRARY/source/` — bitmap source symbols
- `LIBRARY/image/` — image symbols with transforms
- `LIBRARY/sprite/` — animated sprite symbols
- `LIBRARY/main.xml` — main animation timeline
- `LIBRARY/media/` — PNG textures (when loaded)

## Tech Stack

Pure HTML5/CSS/JavaScript (ES modules), no build tools or dependencies. Runs entirely in the browser.

## Author

[LambdaEd1th](https://github.com/LambdaEd1th)

## License

This project is licensed under the GNU General Public License v3.0 — see the [LICENSE](LICENSE) file for details.
