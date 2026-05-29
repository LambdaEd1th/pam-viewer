import { Container, Sprite, Texture, Graphics } from 'pixi.js';
import { renderFrame } from './renderer';
import type { Animation, Matrix6, Color, TimelinesMap } from './types';

// ── Persistent render-to-texture state ──
let offscreenCanvas: HTMLCanvasElement | null = null;
let frameSprite: Sprite | null = null;
let frameTexture: Texture | null = null;
let prevCanvasW = 0;
let prevCanvasH = 0;

function ensureOffscreen(canvasW: number, canvasH: number): CanvasRenderingContext2D {
  if (!offscreenCanvas || canvasW !== prevCanvasW || canvasH !== prevCanvasH) {
    // Destroy old texture / sprite so we don't leak GPU memory
    if (frameTexture) {
      frameTexture.destroy(true);
      frameTexture = null;
    }
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = canvasW;
    offscreenCanvas.height = canvasH;
    prevCanvasW = canvasW;
    prevCanvasH = canvasH;
    frameSprite = null; // will be recreated
  }
  const ctx = offscreenCanvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvasW, canvasH);
  return ctx;
}

/**
 * Render one animation frame to a persistent offscreen Canvas 2D, then return
 * a PixiJS Container with an up-to-date Sprite.  The offscreen canvas and GPU
 * texture are reused across frames to avoid allocations.
 */
export function renderFrameToPixiContainer(
  animation: Animation,
  imageTextures: Map<string, HTMLImageElement>,
  timelines: TimelinesMap,
  spriteIndex: number,
  frameIndex: number,
  imageFilter: boolean[],
  spriteFilter: boolean[],
  zoom: number,
  panX: number,
  panY: number,
  canvasW: number,
  canvasH: number,
  dpr: number,
): Container {
  const ctx = ensureOffscreen(canvasW, canvasH);

  const sx = zoom;
  const sy = zoom;
  const cx = canvasW / 2 + panX * dpr;
  const cy = canvasH / 2 + panY * dpr;

  const baseMatrix: Matrix6 = [sx, 0, 0, sy, cx, cy];
  const baseColor: Color = { r: 1, g: 1, b: 1, a: 1 };

  renderFrame(
    ctx, animation, imageTextures, timelines,
    spriteIndex, frameIndex,
    baseMatrix, baseColor,
    imageFilter, spriteFilter,
  );

  // Create or update the PixiJS texture from the offscreen canvas
  if (!frameTexture) {
    frameTexture = Texture.from(offscreenCanvas!);
  } else {
    // Tell PixiJS that the canvas source has changed
    frameTexture.source.update();
  }

  // Create or reuse the Sprite
  if (!frameSprite) {
    frameSprite = new Sprite(frameTexture);
  } else if (frameSprite.texture !== frameTexture) {
    frameSprite.texture = frameTexture;
  }

  // Size the sprite to fill the physical-pixel stage
  frameSprite.setSize(canvasW, canvasH);

  const container = new Container();
  container.addChild(frameSprite);
  return container;
}

/**
 * Draw the boundary overlay (blue rectangle + corner handles + center crosshair)
 * using PixiJS Graphics.
 */
export function createBoundaryOverlay(
  animation: Animation,
  zoom: number,
  panX: number,
  panY: number,
  canvasW: number,
  canvasH: number,
  dpr: number,
): Container {
  const overlay = new Container();
  const g = new Graphics();

  const sx = zoom;
  const sy = zoom;
  const cx = canvasW / 2 + panX * dpr;
  const cy = canvasH / 2 + panY * dpr;
  const bw = animation.size[0];
  const bh = animation.size[1];
  const originX = animation.position[0];
  const originY = animation.position[1];

  // Blue boundary rectangle
  g.rect(-originX * sx + cx, -originY * sy + cy, bw * sx, bh * sy);
  g.stroke({ color: 'rgba(0, 200, 255, 0.5)', width: 1, pixelLine: true });

  // Corner and edge handles
  const handleSize = 5;
  const handles: [number, number][] = [
    [0, 0], [bw / 2, 0], [bw, 0],
    [0, bh / 2], [bw, bh / 2],
    [0, bh], [bw / 2, bh], [bw, bh],
  ];
  for (const [hx, hy] of handles) {
    g.rect(
      -originX * sx + cx + hx * sx - handleSize / 2,
      -originY * sy + cy + hy * sy - handleSize / 2,
      handleSize,
      handleSize,
    );
    g.fill({ color: 'rgba(0, 200, 255, 0.8)' });
  }

  // Center crosshair
  g.moveTo(cx - 10, cy);
  g.lineTo(cx + 10, cy);
  g.moveTo(cx, cy - 10);
  g.lineTo(cx, cy + 10);
  g.stroke({ color: 'rgba(255, 100, 100, 0.6)', width: 1, pixelLine: true });

  overlay.addChild(g);
  return overlay;
}

/** Release all cached GPU / canvas resources. Call when clearing the animation. */
export function resetPixiRenderer(): void {
  if (frameTexture) {
    frameTexture.destroy(true);
    frameTexture = null;
  }
  frameSprite = null;
  offscreenCanvas = null;
  prevCanvasW = 0;
  prevCanvasH = 0;
}
