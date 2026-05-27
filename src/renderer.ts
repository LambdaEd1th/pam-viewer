import { transformToMatrix, multiplyMatrix, multiplyColor } from './model';
import type { Animation, Color, Matrix6, LayerSnapshot, SpriteTimeline, TimelinesMap } from './types';

const DEFAULT_COLOR: Color = { r: 1, g: 1, b: 1, a: 1 };
const IDENTITY_MATRIX: Matrix6 = [1, 0, 0, 1, 0, 0];

// ── Per-channel RGB colour multiplier ──
// Safari does NOT support ctx.filter with url(#svgFilter) references in
// Canvas 2D (even with DOM-based SVGs).  Instead we pre-colourise textures
// via getImageData / putImageData and cache the results.  This works in
// every browser and the per-(texture,colour) cost is paid only once.

const colorizedCache = new Map<string, HTMLCanvasElement>();

function getColorizedTexture(
  texture: HTMLImageElement,
  texId: string,
  r: number, g: number, b: number,
): HTMLCanvasElement | HTMLImageElement {
  if (r === 1 && g === 1 && b === 1) return texture;

  const key = `${texId}|${r.toFixed(4)}|${g.toFixed(4)}|${b.toFixed(4)}`;
  const cached = colorizedCache.get(key);
  if (cached) return cached;

  const w = texture.naturalWidth;
  const h = texture.naturalHeight;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  if (!octx) return texture;

  octx.drawImage(texture, 0, 0);
  const imgData = octx.getImageData(0, 0, w, h);
  const d = imgData.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = Math.min(255, Math.round(d[i]     * r));
    d[i + 1] = Math.min(255, Math.round(d[i + 1] * g));
    d[i + 2] = Math.min(255, Math.round(d[i + 2] * b));
    // d[i + 3] α is kept as-is — globalAlpha handles opacity separately
  }
  octx.putImageData(imgData, 0, 0);
  colorizedCache.set(key, off);
  return off;
}

// Pool of reusable offscreen canvases for additive sprite compositing.
// A stack-based pool is safe for recursive renderFrame calls: each nested
// call pops its own distinct canvas, avoiding aliasing between levels.
const offscreenCanvasPool: HTMLCanvasElement[] = [];

function acquireOffscreenCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = offscreenCanvasPool.pop() ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function releaseOffscreenCanvas(canvas: HTMLCanvasElement): void {
  offscreenCanvasPool.push(canvas);
}

export function buildSpriteTimeline(animation: Animation, sprite: Animation['sprite'][0]): SpriteTimeline {
  const layers = new Map<number, {
    resource: number;
    isSprite: boolean;
    additive: boolean;
    timeScale: number;
    preloadFrame: number;
    firstFrame: number;
    transform: Matrix6;
    color: Color;
    removed: boolean;
    changed: boolean;
    spriteFrameNumber: number | null;
    sourceRect: [number, number, number, number] | null;
  }>();
  const timeline: SpriteTimeline = [];

  for (let fi = 0; fi < sprite.frame.length; fi++) {
    const frame = sprite.frame[fi];

    for (const action of frame.remove) {
      const layer = layers.get(action.index);
      if (layer) layer.removed = true;
    }

    for (const action of frame.append) {
      layers.set(action.index, {
        resource: action.resource,
        isSprite: action.sprite,
        additive: action.additive,
        timeScale: action.timeScale,
        preloadFrame: action.preloadFrame,
        firstFrame: fi,
        transform: IDENTITY_MATRIX,
        color: { ...DEFAULT_COLOR },
        removed: false,
        changed: true,
        spriteFrameNumber: null,
        sourceRect: null,
      });
    }

    for (const action of frame.change) {
      const layer = layers.get(action.index);
      if (!layer || layer.removed) continue;
      layer.transform = transformToMatrix(action.transform);
      if (action.color) {
        layer.color = action.color;
      }
      // spriteFrameNumber: adjust preloadFrame so child shows this frame at `fi`
      if (action.spriteFrameNumber != null && layer.isSprite) {
        const childSprite = layer.resource === animation.sprite.length
          ? animation.mainSprite
          : animation.sprite[layer.resource];
        if (childSprite) {
          const childCount = childSprite.frame.length;
          const offset = action.spriteFrameNumber - (fi - layer.firstFrame);
          layer.preloadFrame = ((offset % childCount) + childCount) % childCount;
        }
      }
      if (action.sourceRectangle != null) {
        layer.sourceRect = [...action.sourceRectangle] as [number, number, number, number];
      }
      layer.changed = true;
    }

    const sortedKeys = [...layers.keys()].sort((a, b) => a - b);
    const snapshot: LayerSnapshot[] = [];
    for (const key of sortedKeys) {
      const layer = layers.get(key)!;
      if (layer.removed) continue;
      snapshot.push({
        index: key,
        resource: layer.resource,
        isSprite: layer.isSprite,
        additive: layer.additive,
        firstFrame: layer.firstFrame,
        timeScale: layer.timeScale,
        preloadFrame: layer.preloadFrame,
        transform: [...layer.transform] as Matrix6,
        color: { ...layer.color },
        spriteFrameNumber: layer.spriteFrameNumber,
        sourceRect: layer.sourceRect ? [...layer.sourceRect] as [number, number, number, number] : null,
      });
    }
    timeline.push(snapshot);

    for (const layer of layers.values()) {
      if (!layer.removed) {
        layer.changed = false;
      }
    }
  }

  return timeline;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  animation: Animation,
  textures: Map<string, HTMLImageElement>,
  spriteTimelines: TimelinesMap,
  spriteIndex: number,
  frameIndex: number,
  parentMatrix: Matrix6,
  parentColor: Color,
  imageFilter: boolean[],
  spriteFilter: boolean[],
): void {
  const timelineKey = spriteIndex === -1 ? 'main' : spriteIndex;
  const timeline = spriteTimelines[timelineKey];
  if (!timeline) return;

  const sprite = spriteIndex === -1
    ? animation.mainSprite
    : animation.sprite[spriteIndex];
  if (!sprite) return;

  // workArea: restrict playable frame range [start, start+duration)
  let effectiveFrameIndex = frameIndex;
  if (sprite.workArea && sprite.workArea.duration > 0) {
    const wa = sprite.workArea;
    effectiveFrameIndex = wa.start + ((frameIndex % wa.duration) + wa.duration) % wa.duration;
  }
  const actualFrame = effectiveFrameIndex % sprite.frame.length;
  const snapshot = timeline[actualFrame];
  if (!snapshot) return;

  for (const layer of snapshot) {
    const worldMatrix = multiplyMatrix(parentMatrix, layer.transform);
    const worldColor = multiplyColor(parentColor, layer.color);

    if (layer.isSprite) {
      if (layer.resource < spriteFilter.length && !spriteFilter[layer.resource]) continue;

      const childSprite = layer.resource === animation.sprite.length
        ? animation.mainSprite
        : animation.sprite[layer.resource];
      if (!childSprite) continue;

      const childSpriteIndex = layer.resource === animation.sprite.length ? -1 : layer.resource;
      // timeScale: child sprite playback speed multiplier
      const scaledDelta = Math.floor((actualFrame - layer.firstFrame) * layer.timeScale);
      const childFrame = (scaledDelta + layer.preloadFrame) % childSprite.frame.length;
      const adjustedFrame = childFrame < 0 ? childFrame + childSprite.frame.length : childFrame;

      if (layer.additive) {
        // Render the child sprite into an isolated offscreen canvas, then
        // composite the result additively onto the main canvas.  This correctly
        // implements Flash's "additive movie-clip" blend mode where the entire
        // sprite contents are first composited together and then added to the
        // background (rather than each individual child layer being additive).
        const offCanvas = acquireOffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
        const offCtx = offCanvas.getContext('2d');
        if (!offCtx) { releaseOffscreenCanvas(offCanvas); continue; }
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
        renderFrame(
          offCtx, animation, textures, spriteTimelines,
          childSpriteIndex, adjustedFrame,
          worldMatrix, worldColor,
          imageFilter, spriteFilter,
        );
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(offCanvas, 0, 0);
        ctx.restore();
        releaseOffscreenCanvas(offCanvas);
      } else {
        renderFrame(
          ctx, animation, textures, spriteTimelines,
          childSpriteIndex, adjustedFrame,
          worldMatrix, worldColor,
          imageFilter, spriteFilter,
        );
      }
    } else {
      if (layer.resource < imageFilter.length && !imageFilter[layer.resource]) continue;

      const imageDef = animation.image[layer.resource];
      if (!imageDef) continue;

      const texture = textures.get(imageDef.name);
      if (!texture) continue;

      const imgMatrix = transformToMatrix(imageDef.transform);
      const finalMatrix = multiplyMatrix(worldMatrix, imgMatrix);

      ctx.save();
      ctx.setTransform(
        finalMatrix[0], finalMatrix[1],
        finalMatrix[2], finalMatrix[3],
        finalMatrix[4], finalMatrix[5],
      );

      ctx.globalAlpha = worldColor.a;
      if (layer.additive) {
        ctx.globalCompositeOperation = 'lighter';
      }

      const src = getColorizedTexture(texture, imageDef.name, worldColor.r, worldColor.g, worldColor.b);

      const w = imageDef.size ? imageDef.size.width : texture.naturalWidth;
      const h = imageDef.size ? imageDef.size.height : texture.naturalHeight;

      if (layer.sourceRect) {
        const [sx, sy, sw, sh] = layer.sourceRect;
        ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
      } else {
        ctx.drawImage(src, 0, 0, w, h);
      }

      ctx.restore();
    }
  }
}

export function buildAllTimelines(animation: Animation): TimelinesMap {
  const timelines: TimelinesMap = {};
  for (let i = 0; i < animation.sprite.length; i++) {
    timelines[i] = buildSpriteTimeline(animation, animation.sprite[i]);
  }
  if (animation.mainSprite) {
    timelines['main'] = buildSpriteTimeline(animation, animation.mainSprite);
  }
  return timelines;
}
