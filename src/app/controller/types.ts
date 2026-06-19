import type { Animation } from '../../domain/types';
import type { LoadedAnimation } from '../load-animation';

export type ThemePreference = 'system' | 'light' | 'dark';
export type FrameRange = { begin: number; end: number };
export type StageBounds = { x: number; y: number; width: number; height: number };
export type ExportSize = { width: number; height: number };

export interface AnimationTab extends LoadedAnimation {
  id: number;
  activeSpriteIndex: number;
  frameRange: FrameRange;
  currentFrame: number;
  zoom: number;
  panX: number;
  panY: number;
  imageFilter: boolean[];
  spriteFilter: boolean[];
  plantCustomLayers: number[];
  zombieStateLayers: number[];
  groundSwatchLayers: number[];
  speedValue: string;
  sizeScale: string;
  exportSize: ExportSize;
  imageRegex: string;
  spriteRegex: string;
  labelValue: string;
}

export type ActiveSprite = Animation['mainSprite'];
