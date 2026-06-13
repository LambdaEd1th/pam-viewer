import { Container, Graphics, Matrix, Rectangle, Sprite, Texture } from 'pixi.js';
import { multiplyColor, multiplyMatrix, transformToMatrix } from '../domain/model';
import type { Animation, Color, Matrix6, TimelinesMap } from '../domain/types';

const IDENTITY_MATRIX: Matrix6 = [1, 0, 0, 1, 0, 0];
const IDENTITY_PIXI_MATRIX = new Matrix(1, 0, 0, 1, 0, 0);
const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };
const MAX_CONTAINER_POOL_SIZE = 4096;
const MAX_SPRITE_POOL_SIZE = 8192;

let frameRoot: Container | null = null;
let containerPool: Container[] = [];
let spritePool: Sprite[] = [];
let containerCursor = 0;
let spriteCursor = 0;

const imageTextures = new Map<HTMLImageElement, Texture>();
const sourceRectTextures = new Map<HTMLImageElement, Map<string, Texture>>();

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function rgbToHex(r: number, g: number, b: number): number {
  const rr = Math.round(clamp01(r) * 255);
  const gg = Math.round(clamp01(g) * 255);
  const bb = Math.round(clamp01(b) * 255);
  return (rr << 16) | (gg << 8) | bb;
}

function moduloFrameIndex(value: number, count: number): number {
  // Keep frame index in [0, count) even when playback delta is negative.
  return ((value % count) + count) % count;
}

function getFrameRoot(): Container {
  if (!frameRoot) {
    frameRoot = new Container();
  }
  return frameRoot;
}

function acquireContainer(): Container {
  const index = containerCursor++;
  const container = containerPool[index] ?? (containerPool[index] = new Container());
  container.removeChildren();
  container.visible = true;
  container.alpha = 1;
  container.blendMode = 'normal';
  container.eventMode = 'none';
  container.setFromMatrix(IDENTITY_PIXI_MATRIX);
  return container;
}

function acquireSprite(): Sprite {
  const index = spriteCursor++;
  const sprite = spritePool[index] ?? (spritePool[index] = new Sprite(Texture.WHITE));
  sprite.visible = true;
  sprite.alpha = 1;
  sprite.tint = 0xffffff;
  sprite.blendMode = 'normal';
  sprite.width = 1;
  sprite.height = 1;
  sprite.eventMode = 'none';
  sprite.setFromMatrix(IDENTITY_PIXI_MATRIX);
  return sprite;
}

function resetFramePoolsUsage(): void {
  containerCursor = 0;
  spriteCursor = 0;
}

function cleanupUnusedContainerPoolObjects(): void {
  for (let i = containerCursor; i < containerPool.length; i++) {
    // Remove previous-frame descendants from pooled containers.
    containerPool[i].removeChildren();
  }
}

function enforcePoolCaps(): void {
  if (containerPool.length <= MAX_CONTAINER_POOL_SIZE && spritePool.length <= MAX_SPRITE_POOL_SIZE) {
    return;
  }

  while (containerPool.length > MAX_CONTAINER_POOL_SIZE) {
    containerPool.pop()?.destroy();
  }

  while (spritePool.length > MAX_SPRITE_POOL_SIZE) {
    spritePool.pop()?.destroy();
  }
}

function applyMatrix(displayObject: Container | Sprite, matrix: Matrix6): void {
  const pixiMatrix = new Matrix(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
  displayObject.setFromMatrix(pixiMatrix);
}

function applyMatrixWithLocalScale(
  displayObject: Container | Sprite,
  matrix: Matrix6,
  scaleX: number,
  scaleY: number,
): void {
  const scaledMatrix = multiplyMatrix(matrix, [scaleX, 0, 0, scaleY, 0, 0]);
  const pixiMatrix = new Matrix(
    scaledMatrix[0],
    scaledMatrix[1],
    scaledMatrix[2],
    scaledMatrix[3],
    scaledMatrix[4],
    scaledMatrix[5],
  );
  displayObject.setFromMatrix(pixiMatrix);
}

function getImageTexture(image: HTMLImageElement): Texture {
  const cached = imageTextures.get(image);
  if (cached) return cached;
  const texture = Texture.from(image);
  imageTextures.set(image, texture);
  return texture;
}

function getLayerTexture(
  animation: Animation,
  imageSource: Map<string, HTMLImageElement>,
  imageIndex: number,
  sourceRect: [number, number, number, number] | null,
): Texture | null {
  const imageDef = animation.image[imageIndex];
  if (!imageDef) return null;

  const image = imageSource.get(imageDef.name);
  if (!image) return null;

  const baseTexture = getImageTexture(image);
  if (!sourceRect) return baseTexture;

  const [sx, sy, sw, sh] = sourceRect;
  if (sw <= 0 || sh <= 0) return null;

  const key = `${sx}|${sy}|${sw}|${sh}`;
  let rectTextureMap = sourceRectTextures.get(image);
  if (!rectTextureMap) {
    rectTextureMap = new Map<string, Texture>();
    sourceRectTextures.set(image, rectTextureMap);
  }
  const cached = rectTextureMap.get(key);
  if (cached) return cached;

  const texture = new Texture({
    source: baseTexture.source,
    frame: new Rectangle(sx, sy, sw, sh),
  });
  rectTextureMap.set(key, texture);
  return texture;
}

function renderSpriteTree(
  target: Container,
  animation: Animation,
  textures: Map<string, HTMLImageElement>,
  timelines: TimelinesMap,
  spriteIndex: number,
  frameIndex: number,
  parentMatrix: Matrix6,
  parentColor: Color,
  imageFilter: boolean[],
  spriteFilter: boolean[],
): void {
  const timelineKey = spriteIndex === -1 ? 'main' : spriteIndex;
  const timeline = timelines[timelineKey];
  if (!timeline) return;

  const spriteData = spriteIndex === -1 ? animation.mainSprite : animation.sprite[spriteIndex];
  if (!spriteData || spriteData.frame.length === 0) return;

  const actualFrame = moduloFrameIndex(frameIndex, spriteData.frame.length);
  const snapshot = timeline[actualFrame];
  if (!snapshot) return;

  for (const layer of snapshot) {
    const layerMatrix = multiplyMatrix(parentMatrix, layer.transform);
    const layerColor = multiplyColor(parentColor, layer.color);

    if (layer.isSprite) {
      if (layer.resource < spriteFilter.length && !spriteFilter[layer.resource]) continue;

      const childSpriteData = layer.resource === animation.sprite.length
        ? animation.mainSprite
        : animation.sprite[layer.resource];
      if (!childSpriteData || childSpriteData.frame.length === 0) continue;

      const childSpriteIndex = layer.resource === animation.sprite.length ? -1 : layer.resource;
      const childFrameCount = childSpriteData.frame.length;
      const scaledDelta = Math.floor((actualFrame - layer.firstFrame) * layer.timeScale);
      const adjustedFrame = moduloFrameIndex(scaledDelta + layer.preloadFrame, childFrameCount);

      const childContainer = acquireContainer();
      applyMatrix(childContainer, layerMatrix);
      // Keep alpha on leaf sprites only; otherwise parent alpha would be
      // multiplied again with recursively propagated layerColor.a.
      childContainer.alpha = 1;
      childContainer.blendMode = layer.additive ? 'add' : 'normal';
      target.addChild(childContainer);

      renderSpriteTree(
        childContainer,
        animation,
        textures,
        timelines,
        childSpriteIndex,
        adjustedFrame,
        IDENTITY_MATRIX,
        layerColor,
        imageFilter,
        spriteFilter,
      );

      continue;
    }

    if (layer.resource < imageFilter.length && !imageFilter[layer.resource]) continue;

    const imageDef = animation.image[layer.resource];
    if (!imageDef) continue;

    const texture = getLayerTexture(animation, textures, layer.resource, layer.sourceRect);
    if (!texture) continue;

    const imgMatrix = transformToMatrix(imageDef.transform);
    const finalMatrix = multiplyMatrix(layerMatrix, imgMatrix);

    const drawW = imageDef.size?.width ?? texture.orig.width;
    const drawH = imageDef.size?.height ?? texture.orig.height;
    if (drawW <= 0 || drawH <= 0) continue;

    const baseW = texture.orig.width;
    const baseH = texture.orig.height;
    if (baseW <= 0 || baseH <= 0) continue;

    const imageSprite = acquireSprite();
    imageSprite.texture = texture;
    imageSprite.alpha = clamp01(layerColor.a);
    imageSprite.tint = rgbToHex(layerColor.r, layerColor.g, layerColor.b);
    imageSprite.blendMode = layer.additive ? 'add' : 'normal';
    applyMatrixWithLocalScale(imageSprite, finalMatrix, drawW / baseW, drawH / baseH);
    target.addChild(imageSprite);
  }
}

export function renderFrameToPixiContainer(
  animation: Animation,
  textures: Map<string, HTMLImageElement>,
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
  const root = getFrameRoot();
  root.removeChildren();
  enforcePoolCaps();
  resetFramePoolsUsage();

  const sx = zoom * dpr;
  const sy = zoom * dpr;
  const cx = canvasW / 2 + panX * dpr;
  const cy = canvasH / 2 + panY * dpr;
  const baseMatrix: Matrix6 = [sx, 0, 0, sy, cx, cy];

  renderSpriteTree(
    root,
    animation,
    textures,
    timelines,
    spriteIndex,
    frameIndex,
    baseMatrix,
    WHITE,
    imageFilter,
    spriteFilter,
  );

  cleanupUnusedContainerPoolObjects();
  return root;
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

  const sx = zoom * dpr;
  const sy = zoom * dpr;
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
  if (frameRoot) {
    frameRoot.removeChildren();
    frameRoot = null;
  }

  // sourceRect textures share the same source as base image textures,
  // so keep source alive here and let imageTextures release it below.
  for (const textureMap of sourceRectTextures.values()) {
    for (const texture of textureMap.values()) {
      texture.destroy(false); // keep shared source alive
    }
  }
  sourceRectTextures.clear();

  for (const texture of imageTextures.values()) {
    texture.destroy(true);
  }
  imageTextures.clear();

  for (const sprite of spritePool) {
    sprite.destroy();
  }
  spritePool = [];

  for (const container of containerPool) {
    container.destroy();
  }
  containerPool = [];

  resetFramePoolsUsage();
}
