import { transformToMatrix, multiplyMatrix, multiplyColor } from './model';
import type { Animation, Color, Matrix6, LayerSnapshot, SpriteTimeline, TimelinesMap } from './types';

const DEFAULT_COLOR: Color = { r: 1, g: 1, b: 1, a: 1 };
const IDENTITY_MATRIX: Matrix6 = [1, 0, 0, 1, 0, 0];

// Cache for SVG colour-matrix filter strings keyed by rounded RGB values
const colorFilterCache = new Map<string, string>();

function buildColorFilter(r: number, g: number, b: number): string {
  const key = `${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)}`;
  let filter = colorFilterCache.get(key);
  if (filter === undefined) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><filter id="cm"><feColorMatrix type="matrix" values="${r} 0 0 0 0 0 ${g} 0 0 0 0 0 ${b} 0 0 0 0 0 1 0"/></filter></svg>`;
    filter = `url("data:image/svg+xml,${encodeURIComponent(svg)}#cm")`;
    colorFilterCache.set(key, filter);
  }
  return filter;
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

export function buildSpriteTimeline(_animation: Animation, sprite: Animation['sprite'][0]): SpriteTimeline {
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
      });
    }

    for (const action of frame.change) {
      const layer = layers.get(action.index);
      if (!layer || layer.removed) continue;
      layer.transform = transformToMatrix(action.transform);
      if (action.color) {
        layer.color = action.color;
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

// Returns true if any sprite layer in this snapshot will be rendered as an
// erase mask (Flash "Erase" blend mode).  A sprite is treated as an erase
// mask when all three RGB channels of its effective world colour are zero
// while the alpha channel is non-zero — this is the PAM-format encoding of
// a Flash clip that uses the Erase blend mode to punch transparent holes
// through the layers below it.
function snapshotHasEraseLayers(snapshot: LayerSnapshot[], parentColor: Color): boolean {
  for (const layer of snapshot) {
    if (!layer.isSprite) continue;
    const wc = multiplyColor(parentColor, layer.color);
    if (wc.r === 0 && wc.g === 0 && wc.b === 0 && wc.a > 0) return true;
  }
  return false;
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
  _noIsolate = false,
): void {
  const timelineKey = spriteIndex === -1 ? 'main' : spriteIndex;
  const timeline = spriteTimelines[timelineKey];
  if (!timeline) return;

  const sprite = spriteIndex === -1
    ? animation.mainSprite
    : animation.sprite[spriteIndex];
  if (!sprite) return;

  const actualFrame = frameIndex % sprite.frame.length;
  const snapshot = timeline[actualFrame];
  if (!snapshot) return;

  // If this sprite contains any erase-mode sub-sprites it must be composited
  // through an isolated off-screen canvas.  Without isolation the destination-out
  // operation used for erase layers would remove pixels from the main canvas
  // (including content drawn by sibling layers that precede this sprite).
  if (!_noIsolate && snapshotHasEraseLayers(snapshot, parentColor)) {
    const offCanvas = acquireOffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) { releaseOffscreenCanvas(offCanvas); return; }
    offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
    renderFrame(
      offCtx, animation, textures, spriteTimelines,
      spriteIndex, frameIndex,
      parentMatrix, parentColor,
      imageFilter, spriteFilter,
      true,   // _noIsolate: skip isolation in the recursive call
    );
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(offCanvas, 0, 0);
    ctx.restore();
    releaseOffscreenCanvas(offCanvas);
    return;
  }

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
      const childFrame = ((actualFrame - layer.firstFrame) + layer.preloadFrame) % childSprite.frame.length;
      const adjustedFrame = childFrame < 0 ? childFrame + childSprite.frame.length : childFrame;

      // Erase-mode: all RGB channels zero, non-zero alpha.  Render the sprite
      // shape into an off-screen canvas and apply it with destination-out so
      // that it punches a transparent hole through the layers already drawn in
      // the current (isolated) canvas, replicating Flash's Erase blend mode.
      if (worldColor.r === 0 && worldColor.g === 0 && worldColor.b === 0 && worldColor.a > 0) {
        const offCanvas = acquireOffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
        const offCtx = offCanvas.getContext('2d');
        if (!offCtx) { releaseOffscreenCanvas(offCanvas); continue; }
        offCtx.clearRect(0, 0, offCanvas.width, offCanvas.height);
        // Render with opaque white so only the shape's alpha channel matters
        // for the destination-out operation.
        const shapeColor: Color = { r: 1, g: 1, b: 1, a: worldColor.a };
        renderFrame(
          offCtx, animation, textures, spriteTimelines,
          childSpriteIndex, adjustedFrame,
          worldMatrix, shapeColor,
          imageFilter, spriteFilter,
        );
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(offCanvas, 0, 0);
        ctx.restore();
        releaseOffscreenCanvas(offCanvas);
      } else if (layer.additive) {
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
      // Apply RGB colour-multiplier channels.  Canvas has no built-in API for
      // per-channel multiply so we use an inline SVG feColorMatrix filter.
      // The alpha column is kept at identity (0 0 0 1 0) because globalAlpha
      // already handles the alpha multiplier above.
      if (worldColor.r !== 1 || worldColor.g !== 1 || worldColor.b !== 1) {
        ctx.filter = buildColorFilter(worldColor.r, worldColor.g, worldColor.b);
      }

      const w = imageDef.size ? imageDef.size.width : texture.naturalWidth;
      const h = imageDef.size ? imageDef.size.height : texture.naturalHeight;
      ctx.drawImage(texture, 0, 0, w, h);

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
