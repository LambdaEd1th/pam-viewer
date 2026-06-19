import type { Animation } from '../../domain/types';
import type { LoadedAnimation } from '../load-animation';
import { getSpecialLayerIndices } from '../special-layers';
import {
  computeStageViewBoundsFor,
  getPanForStageBounds,
  getPresetExportSize,
} from './geometry';
import type { AnimationTab, FrameRange } from './types';

interface CreateAnimationTabOptions {
  id: number;
  reverseChecked: boolean;
  initialSpeedValue?: string;
}

export function getSpriteForAnimation(anim: Animation, index: number): Animation['mainSprite'] {
  return index === -1 ? anim.mainSprite : (anim.sprite[index] ?? null);
}

export function getInitialFrameRange(sprite: Animation['mainSprite']): FrameRange {
  if (!sprite || sprite.frame.length === 0) return { begin: 0, end: 0 };
  return { begin: 0, end: sprite.frame.length - 1 };
}

export function createAnimationTab(
  loadedAnimation: LoadedAnimation,
  options: CreateAnimationTabOptions,
): AnimationTab {
  const initialSpriteIndex = loadedAnimation.animation.mainSprite
    ? -1
    : (loadedAnimation.animation.sprite.length > 0 ? 0 : -1);
  const initialSprite = getSpriteForAnimation(loadedAnimation.animation, initialSpriteIndex);
  const {
    plantCustomLayers,
    zombieStateLayers,
    groundSwatchLayers,
    defaultHiddenLayers,
  } = getSpecialLayerIndices(loadedAnimation.animation, loadedAnimation.displayName);
  const spriteFilter = loadedAnimation.animation.sprite.map(() => true);
  for (const idx of [...defaultHiddenLayers, ...zombieStateLayers]) {
    spriteFilter[idx] = false;
  }
  const frameRange = getInitialFrameRange(initialSprite);
  const viewBounds = computeStageViewBoundsFor(
    loadedAnimation.animation,
    loadedAnimation.textures,
    loadedAnimation.spriteTimelines,
  );
  const presetPan = getPanForStageBounds(viewBounds);
  const nativeSpeed = String((initialSprite as any)?.frameRate ?? loadedAnimation.animation.frameRate);
  const initialExportSize = getPresetExportSize(loadedAnimation.animation);

  return {
    ...loadedAnimation,
    id: options.id,
    activeSpriteIndex: initialSpriteIndex,
    frameRange,
    currentFrame: options.reverseChecked ? frameRange.end : frameRange.begin,
    zoom: 1.0,
    panX: presetPan.x,
    panY: presetPan.y,
    imageFilter: loadedAnimation.animation.image.map(() => true),
    spriteFilter,
    plantCustomLayers,
    zombieStateLayers,
    groundSwatchLayers,
    speedValue: options.initialSpeedValue ?? nativeSpeed,
    sizeScale: '1',
    exportSize: initialExportSize,
    imageRegex: '',
    spriteRegex: '',
    labelValue: 'all',
  };
}
