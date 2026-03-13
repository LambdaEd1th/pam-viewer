// Canvas rendering engine — ported from Twinning's visual_helper.dart
// Uses imperative Canvas 2D drawing with affine transforms per frame.

import { transformToMatrix, multiplyMatrix, multiplyColor } from './model.js';

const DEFAULT_COLOR = { r: 1, g: 1, b: 1, a: 1 };
const IDENTITY_MATRIX = [1, 0, 0, 1, 0, 0];

/**
 * Pre-compute per-frame layer state for a sprite.
 * Returns an array[frameIndex] of Map<layerIndex, {resource, isSprite, transform, color}>
 *
 * This mirrors Twinning's visualizeSprite logic:
 *   - append → create layer
 *   - change → update transform/color
 *   - remove → mark layer removed
 *   - unchanged layers carry forward previous frame state
 *
 * @param {object} animation
 * @param {object} sprite
 * @returns {object[]}  Array of frame snapshots
 */
export function buildSpriteTimeline(animation, sprite) {
  // layers: Map<index, {resource, isSprite, transform:[6], color:{r,g,b,a}, removed, changed}>
  const layers = new Map();
  const timeline = [];

  for (let fi = 0; fi < sprite.frame.length; fi++) {
    const frame = sprite.frame[fi];

    // Process removes
    for (const action of frame.remove) {
      const layer = layers.get(action.index);
      if (layer) layer.removed = true;
    }

    // Process appends
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

    // Process changes
    for (const action of frame.change) {
      const layer = layers.get(action.index);
      if (!layer || layer.removed) continue;
      layer.transform = transformToMatrix(action.transform);
      if (action.color) {
        layer.color = action.color;
      } else if (!layer.changed) {
        // keep previous color (already set)
      }
      layer.changed = true;
    }

    // Build snapshot: ordered by layer index (SplayTreeMap equivalent)
    const sortedKeys = [...layers.keys()].sort((a, b) => a - b);
    const snapshot = [];
    for (const key of sortedKeys) {
      const layer = layers.get(key);
      if (layer.removed) continue;
      snapshot.push({
        index: key,
        resource: layer.resource,
        isSprite: layer.isSprite,
        additive: layer.additive,
        firstFrame: layer.firstFrame,
        timeScale: layer.timeScale,
        preloadFrame: layer.preloadFrame,
        transform: [...layer.transform],
        color: { ...layer.color },
      });
    }
    timeline.push(snapshot);

    // Reset changed flags; carry forward for next frame
    for (const layer of layers.values()) {
      if (!layer.removed) {
        layer.changed = false;
      }
    }
  }

  return timeline;
}

/**
 * Render one frame of a sprite to the canvas 2D context.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} animation    - parsed animation
 * @param {Map<string, HTMLImageElement>} textures - loaded image textures
 * @param {object[][]} spriteTimelines - pre-built timelines for all sprites
 * @param {number} spriteIndex  - which sprite to render (-1 for mainSprite)
 * @param {number} frameIndex   - current frame number
 * @param {number[]} parentMatrix - parent affine [a,b,c,d,e,f]
 * @param {{r,g,b,a}} parentColor
 * @param {boolean[]} imageFilter
 * @param {boolean[]} spriteFilter
 */
export function renderFrame(
  ctx, animation, textures, spriteTimelines,
  spriteIndex, frameIndex,
  parentMatrix, parentColor,
  imageFilter, spriteFilter,
) {
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

  for (const layer of snapshot) {
    const worldMatrix = multiplyMatrix(parentMatrix, layer.transform);
    const worldColor = multiplyColor(parentColor, layer.color);

    if (layer.isSprite) {
      // Skip filtered sprites
      if (layer.resource < spriteFilter.length && !spriteFilter[layer.resource]) continue;

      // Compute child frame: (parentFrame - firstFrame) % childLength
      const childSprite = layer.resource === animation.sprite.length
        ? animation.mainSprite
        : animation.sprite[layer.resource];
      if (!childSprite) continue;

      const childFrame = ((actualFrame - layer.firstFrame) + layer.preloadFrame) % childSprite.frame.length;

      renderFrame(
        ctx, animation, textures, spriteTimelines,
        layer.resource === animation.sprite.length ? -1 : layer.resource,
        childFrame < 0 ? childFrame + childSprite.frame.length : childFrame,
        worldMatrix, worldColor,
        imageFilter, spriteFilter,
      );
    } else {
      // Image layer
      if (layer.resource < imageFilter.length && !imageFilter[layer.resource]) continue;

      const imageDef = animation.image[layer.resource];
      if (!imageDef) continue;

      const texture = textures.get(imageDef.name);
      if (!texture) continue;

      // Apply image's own transform on top
      const imgMatrix = transformToMatrix(imageDef.transform);
      const finalMatrix = multiplyMatrix(worldMatrix, imgMatrix);

      ctx.save();
      ctx.setTransform(
        finalMatrix[0], finalMatrix[1],
        finalMatrix[2], finalMatrix[3],
        finalMatrix[4], finalMatrix[5],
      );

      // Apply color tint via globalAlpha + composite
      ctx.globalAlpha = worldColor.a;
      if (layer.additive) {
        ctx.globalCompositeOperation = 'lighter';
      }

      const w = imageDef.size ? imageDef.size.width : texture.naturalWidth;
      const h = imageDef.size ? imageDef.size.height : texture.naturalHeight;
      ctx.drawImage(texture, 0, 0, w, h);

      ctx.restore();
    }
  }
}

/**
 * Build all sprite timelines for an animation (including mainSprite).
 * @param {object} animation
 * @returns {Object<string|number, object[][]>}
 */
export function buildAllTimelines(animation) {
  const timelines = {};
  for (let i = 0; i < animation.sprite.length; i++) {
    timelines[i] = buildSpriteTimeline(animation, animation.sprite[i]);
  }
  if (animation.mainSprite) {
    timelines['main'] = buildSpriteTimeline(animation, animation.mainSprite);
  }
  return timelines;
}
