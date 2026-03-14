import { transformToMatrix, multiplyMatrix, multiplyColor } from './model';
import type { Animation, Color, Matrix6, LayerSnapshot, SpriteTimeline, TimelinesMap } from './types';

const DEFAULT_COLOR: Color = { r: 1, g: 1, b: 1, a: 1 };
const IDENTITY_MATRIX: Matrix6 = [1, 0, 0, 1, 0, 0];

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

  const actualFrame = frameIndex % sprite.frame.length;
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

      const childFrame = ((actualFrame - layer.firstFrame) + layer.preloadFrame) % childSprite.frame.length;

      renderFrame(
        ctx, animation, textures, spriteTimelines,
        layer.resource === animation.sprite.length ? -1 : layer.resource,
        childFrame < 0 ? childFrame + childSprite.frame.length : childFrame,
        worldMatrix, worldColor,
        imageFilter, spriteFilter,
      );
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
