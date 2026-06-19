import { t } from '../../localization/i18n';
import type { Animation } from '../../domain/types';
import type { ViewerFormSnapshot, ViewerOption } from '../viewer-bridge';
import type { ExportSize, ThemePreference } from './types';

interface FrameLabel {
  name: string;
  begin: number;
  end: number;
}

interface ViewerFormSnapshotOptions {
  animation: Animation | null;
  activeSprite: Animation['mainSprite'];
  frameLabels: FrameLabel[];
  plantCustomLayers: number[];
  zombieStateLayers: number[];
  groundSwatchLayers: number[];
  spriteValue: string;
  labelValue: string;
  plantLayerValue: string;
  zombieStateValue: string;
  groundSwatchChecked: boolean;
  speedValue: string;
  speedPresetValue: string;
  currentExportSize: ExportSize;
  sizeScaleValue: string;
  loopChecked: boolean;
  reverseChecked: boolean;
  autoplayChecked: boolean;
  keepSpeedChecked: boolean;
  boundaryChecked: boolean;
  themePreference: ThemePreference;
}

function buildSpriteOptions(animation: Animation | null): ViewerOption[] {
  if (!animation) return [];
  return [
    ...(animation.mainSprite
      ? [{ value: 'main', label: `MainSprite (${animation.mainSprite.frame.length} frames)` }]
      : []),
    ...animation.sprite.map((sp, i) => ({
      value: String(i),
      label: `${sp.name || 'sprite_' + i} (${sp.frame.length}f)`,
    })),
  ];
}

function buildLabelOptions(activeSprite: Animation['mainSprite'], frameLabels: FrameLabel[]): ViewerOption[] {
  if (!activeSprite) return [];
  return [
    { value: 'all', label: t('label.allFrames') },
    ...frameLabels.map(label => ({
      value: JSON.stringify({ begin: label.begin, end: label.end }),
      label: `${label.name} [${label.begin}\u2013${label.end}]`,
    })),
  ];
}

function buildSpecialLayerOptions(animation: Animation | null, layerIndices: number[], stripPrefix = 0): ViewerOption[] {
  if (!animation || layerIndices.length === 0) return [];
  return [
    ...layerIndices.map(idx => ({
      value: String(idx),
      label: (animation.sprite[idx].name ?? '').substring(stripPrefix),
    })),
    { value: 'none', label: 'none' },
  ];
}

export function buildViewerFormSnapshot(options: ViewerFormSnapshotOptions): ViewerFormSnapshot {
  const spriteOptions = buildSpriteOptions(options.animation);
  const labelOptions = buildLabelOptions(options.activeSprite, options.frameLabels);
  const plantLayerOptions = buildSpecialLayerOptions(options.animation, options.plantCustomLayers, 7);
  const zombieStateOptions = buildSpecialLayerOptions(options.animation, options.zombieStateLayers);

  return {
    spriteOptions,
    spriteValue: options.spriteValue,
    spriteDisabled: spriteOptions.length === 0,
    labelOptions,
    labelValue: options.labelValue,
    labelDisabled: labelOptions.length === 0,
    plantLayerOptions,
    plantLayerValue: options.plantLayerValue,
    plantLayerDisabled: plantLayerOptions.length === 0,
    zombieStateOptions,
    zombieStateValue: options.zombieStateValue,
    zombieStateDisabled: zombieStateOptions.length === 0,
    groundSwatchChecked: options.groundSwatchChecked,
    groundSwatchDisabled: options.groundSwatchLayers.length === 0,
    speedValue: options.speedValue,
    speedDisabled: !options.activeSprite,
    speedPresetValue: options.activeSprite ? options.speedPresetValue : 'custom',
    speedPresetDisabled: !options.activeSprite,
    sizeWidthValue: options.animation ? String(options.currentExportSize.width) : '0',
    sizeHeightValue: options.animation ? String(options.currentExportSize.height) : '0',
    sizeScaleValue: options.sizeScaleValue,
    sizeDisabled: !options.animation,
    sizeScaleDisabled: !options.animation,
    loopChecked: options.loopChecked,
    reverseChecked: options.reverseChecked,
    autoplayChecked: options.autoplayChecked,
    keepSpeedChecked: options.keepSpeedChecked,
    boundaryChecked: options.boundaryChecked,
    themeValue: options.themePreference,
  };
}
