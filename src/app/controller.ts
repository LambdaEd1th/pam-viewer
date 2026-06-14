import { Application, Rectangle } from 'pixi.js';
import * as jsYamlMod from 'js-yaml';
import * as smolTomlMod from 'smol-toml';
import { parseImageFileName, parseSpriteFrameLabels } from '../domain/model';
import { computeAnimationBounds } from '../domain/timeline';
import { encodePAM } from '../formats/pam/encoder';
import { toRawJson } from '../formats/pam/serializer';
import { loadPamCodecWasm } from '../formats/pam/wasm';
import { exportFLA } from '../formats/fla/exporter';
import { t, onLangChange } from '../localization/i18n';
import { renderFrameToPixiContainer, createBoundaryOverlay, resetPixiRenderer } from '../rendering/pixi-renderer';
import { collectFilesFromDataTransfer } from './files';
import { buildLoadedAnimation, type LoadedAnimation } from './load-animation';
import { getSpecialLayerIndices } from './special-layers';
import { downloadBlob, stripKnownAnimationExtension } from '../export/download';
import { encodeApng } from '../export/apng';
import { encodeAnimatedWebp, initAnimatedWebpEncoder } from '../export/animated-webp';
import type { Animation, TimelinesMap } from '../domain/types';
import { waitForViewerDomRefs } from './viewer-dom';
import {
  publishViewerChrome,
  publishViewerCommand,
  publishViewerExport,
  publishViewerForm,
  publishViewerPanels,
  publishViewerPlayback,
  publishViewerTabs,
  setViewerCommandActions,
  setViewerFormActions,
  setViewerPanelActions,
  setViewerPlaybackActions,
  setViewerStageActions,
  setViewerTabActions,
} from './viewer-bridge';

export type ViewerUnmount = () => void;

let activeControllerPromise: Promise<ViewerUnmount> | null = null;

export function mountPamViewerController(): Promise<ViewerUnmount> {
  activeControllerPromise ??= mountPamViewerControllerInternal().catch((error: unknown) => {
    activeControllerPromise = null;
    throw error;
  });
  return activeControllerPromise;
}

async function mountPamViewerControllerInternal(): Promise<ViewerUnmount> {
const listenerDisposers: Array<() => void> = [];
function listen(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions | boolean,
): void {
  target.addEventListener(type, listener, options);
  listenerDisposers.push(() => target.removeEventListener(type, listener, options));
}

// ── Settings persistence ──
const SETTINGS_KEY = 'pam-viewer-settings';
type ThemePreference = 'system' | 'light' | 'dark';
type FrameRange = { begin: number; end: number };
type StageBounds = { x: number; y: number; width: number; height: number };
type ExportSize = { width: number; height: number };

interface AnimationTab extends LoadedAnimation {
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

function readSettings(): Record<string, unknown> | null {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    return s && typeof s === 'object' ? s as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function getStoredThemePreference(): ThemePreference {
  const s = readSettings();
  return isThemePreference(s?.theme) ? s.theme : 'system';
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isPositiveNumericString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function getStoredSpeedValue(): string | null {
  const value = readSettings()?.speedValue;
  return isPositiveNumericString(value) ? value : null;
}

function getStoredSizeScale(): string {
  const value = readSettings()?.sizeScale;
  return typeof value === 'string' && ['custom', '1', '2', '3', '4'].includes(value) ? value : '1';
}

function clampPanelWidth(width: number): number {
  return Math.max(120, Math.min(500, Math.round(width)));
}

function getPresetExportSize(anim: Animation): ExportSize {
  return {
    width: Math.max(1, Math.round(anim.size[0])),
    height: Math.max(1, Math.round(anim.size[1])),
  };
}

function getExportScaleValueFor(size: ExportSize): string {
  if (!animation || animation.size[0] <= 0 || animation.size[1] <= 0) return 'custom';
  const ratioW = size.width / animation.size[0];
  const ratioH = size.height / animation.size[1];
  if (Math.abs(ratioW - ratioH) > 0.01) return 'custom';
  const rounded = Math.round(ratioW);
  return rounded >= 1 && rounded <= 4 && Math.abs(ratioW - rounded) <= 0.01
    ? String(rounded)
    : 'custom';
}

function parseExportDimensionValue(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(99999, parsed) : fallback;
}

const systemDarkMedia = window.matchMedia('(prefers-color-scheme: dark)');
let themePreference: ThemePreference = getStoredThemePreference();

function applyThemePreference(theme: ThemePreference): void {
  const resolvedTheme = theme === 'system' ? (systemDarkMedia.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = theme;
}

applyThemePreference(themePreference);

listen(systemDarkMedia, 'change', () => {
  if (themePreference === 'system') applyThemePreference(themePreference);
});

function loadSettings(): void {
  const s = readSettings();
  if (!s) return;
  if (typeof s.loop === 'boolean') loopChecked = s.loop;
  if (typeof s.autoPlay === 'boolean') autoplayChecked = s.autoPlay;
  if (typeof s.boundary === 'boolean') boundaryChecked = s.boundary;
  if (typeof s.reverse === 'boolean') reverseChecked = s.reverse;
  if (typeof s.keepSpeed === 'boolean') keepSpeedChecked = s.keepSpeed;
  if (isPositiveNumericString(s.speedValue)) speedValue = s.speedValue;
  if (typeof s.sizeScale === 'string' && ['custom', '1', '2', '3', '4'].includes(s.sizeScale)) sizeScaleValue = s.sizeScale;
  if (isPositiveNumber(s.imagePanelWidth)) setPanelWidth(panelImages, s.imagePanelWidth);
  if (isPositiveNumber(s.spritePanelWidth)) setPanelWidth(panelSprites, s.spritePanelWidth);
  if (typeof s.showImages === 'boolean') setPanelVisible('images', s.showImages);
  if (typeof s.showSprites === 'boolean') setPanelVisible('sprites', s.showSprites);
  if (isThemePreference(s.theme)) {
    themePreference = s.theme;
    applyThemePreference(themePreference);
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      theme: themePreference,
      loop: loopChecked,
      autoPlay: autoplayChecked,
      boundary: boundaryChecked,
      reverse: reverseChecked,
      keepSpeed: keepSpeedChecked,
      speedValue,
      sizeScale: sizeScaleValue,
      imagePanelWidth: readPanelWidth(panelImages),
      spritePanelWidth: readPanelWidth(panelSprites),
      showImages: imagesPanelVisible,
      showSprites: spritesPanelVisible,
    }));
  } catch (error) {
    console.warn('Failed to save viewer settings:', error);
  }
}

const {
  tabStrip,
  stageContainer,
  canvas,
  panelImages,
  panelSprites,
} = await waitForViewerDomRefs();

// ── State ──
let tabStates: AnimationTab[] = [];
let activeTabId: number | null = null;
let nextTabId = 1;
let pixiApp: Application | null = null;
let animation: Animation | null = null;
let textures = new Map<string, HTMLImageElement>();
let spriteTimelines: TimelinesMap | null = null;
let activeSprite: Animation['mainSprite'] = null;
let activeSpriteIndex = -1;
let frameLabels: { name: string; begin: number; end: number }[] = [];
let frameRange = { begin: 0, end: 0 };
let currentFrame = 0;
let playing = false;
let webpEncoderAvailable = true;
let lastTimestamp = 0;
let accumulator = 0;
let rafId: number | null = null;

function setAnimationNameText(animationName: string): void {
  publishViewerChrome({ animationName });
}

function setStatusText(status: string): void {
  publishViewerChrome({ status });
}

function setExportSizeText(exportSize: string): void {
  publishViewerChrome({ exportSize });
}

function setCoordText(coord: string): void {
  publishViewerChrome({ coord });
}

function setZoomText(zoomText: string): void {
  publishViewerChrome({ zoom: zoomText });
}

function setFrameText(frame: string): void {
  publishViewerChrome({ frame });
}

function setPlayingState(isPlaying: boolean): void {
  publishViewerChrome({ playing: isPlaying });
}

publishViewerChrome({
  animationName: t('anim.unloaded'),
  status: t('status.hint'),
  exportSize: '',
  coord: '',
  zoom: '100%',
  frame: '0 / 0',
  playing: false,
  dropHintVisible: true,
  stageDragOver: false,
  stageCursor: '',
  imagesPanelVisible: true,
  spritesPanelVisible: true,
});

// Zoom / Pan
let zoom = 1.0;
let panX = 0;
let panY = 0;
let stageFitScale = 1;
let stageRenderScale = window.devicePixelRatio || 1;
let stageViewBounds: StageBounds | null = null;

function getPamStageBounds(anim: Animation): StageBounds {
  return {
    x: -anim.position[0],
    y: -anim.position[1],
    width: Math.max(1, anim.size[0]),
    height: Math.max(1, anim.size[1]),
  };
}

function unionStageBounds(a: StageBounds, b: StageBounds): StageBounds {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

function computeStageViewBoundsFor(
  anim: Animation,
  tex: Map<string, HTMLImageElement>,
  timelines: TimelinesMap | null,
): StageBounds {
  const pamBounds = getPamStageBounds(anim);
  if (!timelines) return pamBounds;

  const contentBounds = computeAnimationBounds(anim, tex, timelines);
  if (contentBounds.width <= 0 || contentBounds.height <= 0) {
    return pamBounds;
  }
  return unionStageBounds(pamBounds, contentBounds);
}

function refreshStageViewBounds(): void {
  stageViewBounds = animation
    ? computeStageViewBoundsFor(animation, textures, spriteTimelines)
    : null;
}

function getPanForStageBounds(bounds: StageBounds): { x: number; y: number } {
  return {
    x: -bounds.x - bounds.width / 2,
    y: -bounds.y - bounds.height / 2,
  };
}

function resetPanToStageView(): void {
  if (!animation) {
    panX = 0;
    panY = 0;
    return;
  }
  const presetPan = getPanForStageBounds(stageViewBounds ?? getPamStageBounds(animation));
  panX = presetPan.x;
  panY = presetPan.y;
}

function getCanvasBitmapPoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}

let currentExportSize: ExportSize = { width: 1, height: 1 };
let sizeScaleValue = getStoredSizeScale();

function normalizeExportSize(size: ExportSize): ExportSize {
  return {
    width: Math.max(1, Math.min(99999, Math.round(size.width))),
    height: Math.max(1, Math.min(99999, Math.round(size.height))),
  };
}

function getCurrentExportSize(): ExportSize {
  return currentExportSize;
}

function updateSizeControls(): void {
  publishForm();
}

function setExportSizeValue(size: ExportSize, syncScale = true): void {
  currentExportSize = normalizeExportSize(size);
  if (syncScale) sizeScaleValue = getExportScaleValueFor(currentExportSize);
  updateSizeDisplay();
  updateSizeControls();
}

function setExportSizeFromScale(scaleValue: string): void {
  sizeScaleValue = scaleValue;
  if (!animation || scaleValue === 'custom') {
    updateSizeControls();
    return;
  }
  const scale = parseInt(scaleValue, 10);
  if (!Number.isFinite(scale) || scale <= 0) return;
  setExportSizeValue({
    width: Math.round(animation.size[0] * scale),
    height: Math.round(animation.size[1] * scale),
  }, false);
}

function setExportSizeScaleValue(size: ExportSize): void {
  sizeScaleValue = getExportScaleValueFor(size);
  updateSizeControls();
}

// Filters
let imageFilter: boolean[] = [];
let spriteFilter: boolean[] = [];
let imageRegex = '';
let spriteRegex = '';
let imagesPanelVisible = true;
let spritesPanelVisible = true;
let speedValue = getStoredSpeedValue() ?? '30';
let loopChecked = true;
let reverseChecked = false;
let autoplayChecked = true;
let keepSpeedChecked = false;
let boundaryChecked = false;
let spriteValue = '';
let labelValue = '';
let plantLayerValue = '';
let zombieStateValue = '';
let groundSwatchChecked = false;

// Layer detection results
let plantCustomLayers: number[] = [];
let zombieStateLayers: number[] = [];
let groundSwatchLayers: number[] = [];

function getActiveTab(): AnimationTab | null {
  return tabStates.find(tab => tab.id === activeTabId) ?? null;
}

function getSpriteForAnimation(anim: Animation, index: number): Animation['mainSprite'] {
  return index === -1 ? anim.mainSprite : (anim.sprite[index] ?? null);
}

function getInitialFrameRange(sprite: Animation['mainSprite']): FrameRange {
  if (!sprite || sprite.frame.length === 0) return { begin: 0, end: 0 };
  return { begin: 0, end: sprite.frame.length - 1 };
}

function createAnimationTab(loadedAnimation: LoadedAnimation): AnimationTab {
  const initialSpriteIndex = loadedAnimation.animation.mainSprite
    ? -1
    : (loadedAnimation.animation.sprite.length > 0 ? 0 : -1);
  const initialSprite = getSpriteForAnimation(loadedAnimation.animation, initialSpriteIndex);
  const {
    plantCustomLayers,
    zombieStateLayers,
    groundSwatchLayers,
    defaultHiddenLayers,
  } = getSpecialLayerIndices(loadedAnimation.animation);
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
    id: nextTabId++,
    activeSpriteIndex: initialSpriteIndex,
    frameRange,
    currentFrame: reverseChecked ? frameRange.end : frameRange.begin,
    zoom: 1.0,
    panX: presetPan.x,
    panY: presetPan.y,
    imageFilter: loadedAnimation.animation.image.map(() => true),
    spriteFilter,
    plantCustomLayers,
    zombieStateLayers,
    groundSwatchLayers,
    speedValue: keepSpeedChecked ? (getStoredSpeedValue() ?? speedValue) : nativeSpeed,
    sizeScale: '1',
    exportSize: initialExportSize,
    imageRegex: '',
    spriteRegex: '',
    labelValue: 'all',
  };
}

function saveActiveTabState(): void {
  const tab = getActiveTab();
  if (!tab || !animation) return;

  tab.animation = animation;
  tab.textures = textures;
  tab.spriteTimelines = spriteTimelines!;
  tab.activeSpriteIndex = activeSpriteIndex;
  tab.frameRange = { ...frameRange };
  tab.currentFrame = currentFrame;
  tab.zoom = zoom;
  tab.panX = panX;
  tab.panY = panY;
  tab.imageFilter = imageFilter;
  tab.spriteFilter = spriteFilter;
  tab.plantCustomLayers = plantCustomLayers;
  tab.zombieStateLayers = zombieStateLayers;
  tab.groundSwatchLayers = groundSwatchLayers;
  tab.speedValue = speedValue;
  tab.sizeScale = sizeScaleValue;
  tab.exportSize = getCurrentExportSize();
  tab.imageRegex = imageRegex;
  tab.spriteRegex = spriteRegex;
  tab.labelValue = labelValue || 'all';
}

function loadTabState(tab: AnimationTab): void {
  animation = tab.animation;
  textures = tab.textures;
  spriteTimelines = tab.spriteTimelines;
  activeSpriteIndex = tab.activeSpriteIndex;
  activeSprite = getSpriteForAnimation(tab.animation, tab.activeSpriteIndex);
  frameLabels = activeSprite ? parseSpriteFrameLabels(activeSprite) : [];
  frameRange = { ...tab.frameRange };
  currentFrame = tab.currentFrame;
  zoom = tab.zoom;
  panX = tab.panX;
  panY = tab.panY;
  imageFilter = tab.imageFilter;
  spriteFilter = tab.spriteFilter;
  imageRegex = tab.imageRegex;
  spriteRegex = tab.spriteRegex;
  plantCustomLayers = tab.plantCustomLayers;
  zombieStateLayers = tab.zombieStateLayers;
  groundSwatchLayers = tab.groundSwatchLayers;
  refreshStageViewBounds();
}

function renderTabs(): void {
  publishViewerTabs(tabStates, activeTabId);
}

function publishForm(): void {
  const spriteOptions = !animation
    ? []
    : [
        ...(animation.mainSprite
          ? [{ value: 'main', label: `MainSprite (${animation.mainSprite.frame.length} frames)` }]
          : []),
        ...animation.sprite.map((sp, i) => ({
          value: String(i),
          label: `${sp.name || 'sprite_' + i} (${sp.frame.length}f)`,
        })),
      ];
  const labelOptions = activeSprite
    ? [
        { value: 'all', label: t('label.allFrames') },
        ...frameLabels.map(label => ({
          value: JSON.stringify({ begin: label.begin, end: label.end }),
          label: `${label.name} [${label.begin}\u2013${label.end}]`,
        })),
      ]
    : [];
  const plantLayerOptions = plantCustomLayers.length > 0 && animation
    ? [
        ...plantCustomLayers.map(idx => ({
          value: String(idx),
          label: animation!.sprite[idx].name!.substring(7),
        })),
        { value: 'none', label: 'none' },
      ]
    : [];
  const zombieStateOptions = zombieStateLayers.length > 0 && animation
    ? [
        ...zombieStateLayers.map(idx => ({
          value: String(idx),
          label: animation!.sprite[idx].name!,
        })),
        { value: 'none', label: 'none' },
      ]
    : [];

  publishViewerForm({
    spriteOptions,
    spriteValue,
    spriteDisabled: spriteOptions.length === 0,
    labelOptions,
    labelValue,
    labelDisabled: labelOptions.length === 0,
    plantLayerOptions,
    plantLayerValue,
    plantLayerDisabled: plantLayerOptions.length === 0,
    zombieStateOptions,
    zombieStateValue,
    zombieStateDisabled: zombieStateOptions.length === 0,
    groundSwatchChecked,
    groundSwatchDisabled: groundSwatchLayers.length === 0,
    speedValue,
    speedDisabled: !activeSprite,
    speedPresetValue: activeSprite ? getMatchingSpeedPresetValue() : 'custom',
    speedPresetDisabled: !activeSprite,
    sizeWidthValue: animation ? String(currentExportSize.width) : '0',
    sizeHeightValue: animation ? String(currentExportSize.height) : '0',
    sizeScaleValue,
    sizeDisabled: !animation,
    sizeScaleDisabled: !animation,
    loopChecked,
    reverseChecked,
    autoplayChecked,
    keepSpeedChecked,
    boundaryChecked,
    themeValue: themePreference,
  });
}

function renderEmptyAnimationState(): void {
  stop();
  activeTabId = null;
  animation = null;
  textures = new Map();
  spriteTimelines = null;
  activeSprite = null;
  activeSpriteIndex = -1;
  frameLabels = [];
  frameRange = { begin: 0, end: 0 };
  currentFrame = 0;
  imageFilter = [];
  spriteFilter = [];
  imageRegex = '';
  spriteRegex = '';
  spriteValue = '';
  labelValue = '';
  plantLayerValue = '';
  zombieStateValue = '';
  groundSwatchChecked = false;
  plantCustomLayers = [];
  zombieStateLayers = [];
  groundSwatchLayers = [];
  zoom = 1.0;
  panX = 0;
  panY = 0;
  stageViewBounds = null;
  updateZoomDisplay();
  currentExportSize = { width: 1, height: 1 };
  sizeScaleValue = getStoredSizeScale();
  updateSizeDisplay();

  setAnimationNameText(t('anim.unloaded'));
  enableControls(false);
  updateSliderRange();
  updateRangeInputs();
  publishViewerCommand({ clearDisabled: true });
  updateFrameDisplay();
  setStatusText(t('status.hint'));
  publishForm();
  publishPanels();

  if (pixiApp) {
    pixiApp.stage.removeChildren();
    resetPixiRenderer();
    resizeCanvas();
  }
  publishViewerChrome({ dropHintVisible: true });
  renderTabs();
}

function findLabelValueForRange(): string {
  if (!activeSprite) return 'all';
  if (frameRange.begin === 0 && frameRange.end === activeSprite.frame.length - 1) return 'all';
  const rangeValue = JSON.stringify(frameRange);
  return frameLabels.some(label => JSON.stringify({ begin: label.begin, end: label.end }) === rangeValue)
    ? rangeValue
    : 'all';
}

function hasLabelValue(value: string): boolean {
  return value === 'all' || frameLabels.some(label =>
    JSON.stringify({ begin: label.begin, end: label.end }) === value,
  );
}

function renderActiveTabState(startPlayback = false): void {
  const tab = getActiveTab();
  if (!tab || !animation) {
    renderEmptyAnimationState();
    return;
  }

  setAnimationNameText(tab.displayName);
  updateZoomDisplay();
  spriteValue = activeSpriteIndex === -1 ? 'main' : String(activeSpriteIndex);

  if (activeSprite && activeSprite.frame.length > 0) {
    frameLabels = parseSpriteFrameLabels(activeSprite);
    labelValue = hasLabelValue(tab.labelValue)
      ? tab.labelValue
      : findLabelValueForRange();
    enableControls(true);
    updateSliderRange();
    updateRangeInputs();
    updateFrameDisplay();
  } else {
    labelValue = '';
    enableControls(false);
    updateSliderRange();
    updateRangeInputs();
    updateFrameDisplay();
  }

  speedValue = tab.speedValue;
  updateSpeedPresetTrigger();
  currentExportSize = normalizeExportSize(tab.exportSize);
  sizeScaleValue = tab.sizeScale;
  setExportSizeScaleValue(currentExportSize);
  updateSizeDisplay();

  publishForm();
  populateImagePanel();
  populateSpritePanel();
  renderSpecialLayerControls();
  highlightActiveSpriteInPanel();

  publishViewerCommand({ clearDisabled: false });
  setStatusText(t('status.loaded', {
    name: tab.displayName,
    images: String(animation.image.length),
    loaded: String(tab.loaded),
    sprites: String(animation.sprite.length),
  }));
  publishViewerChrome({ dropHintVisible: false });
  renderTabs();
  resizeCanvas();
  if (startPlayback && activeSprite && autoplayChecked) play();
}

function activateAnimationTab(tabId: number, startPlayback = false): void {
  if (activeTabId === tabId) {
    renderTabs();
    return;
  }
  saveActiveTabState();
  stop();
  activeTabId = tabId;
  const tab = getActiveTab();
  if (!tab) {
    renderEmptyAnimationState();
    return;
  }
  loadTabState(tab);
  renderActiveTabState(startPlayback);
}

function closeAnimationTab(tabId: number): void {
  const index = tabStates.findIndex(tab => tab.id === tabId);
  if (index === -1) return;

  const closingActive = activeTabId === tabId;
  if (closingActive) saveActiveTabState();
  const nextActiveId = closingActive
    ? (tabStates[index + 1]?.id ?? tabStates[index - 1]?.id ?? null)
    : activeTabId;

  tabStates.splice(index, 1);
  if (!closingActive) {
    renderTabs();
    return;
  }

  stop();
  activeTabId = null;
  if (nextActiveId !== null) {
    activateAnimationTab(nextActiveId);
  } else {
    renderEmptyAnimationState();
  }
}

const unsetViewerTabActions = setViewerTabActions({
  activateTab: activateAnimationTab,
  closeTab: closeAnimationTab,
});

// ── i18n setup ──
function applyI18n(): void {
  if (!animation) setAnimationNameText(t('anim.unloaded'));
}

function selectThemePreference(value: string): void {
  if (!isThemePreference(value)) return;
  themePreference = value;
  applyThemePreference(themePreference);
  publishForm();
  saveSettings();
}

const unsubscribeLangChange = onLangChange(() => {
  applyI18n();
  if (animation) {
    saveActiveTabState();
    renderActiveTabState();
  } else {
    renderTabs();
  }
});
applyI18n();

// ── Canvas sizing ──
function resizeCanvas(): void {
  if (!pixiApp) return;
  const rect = stageContainer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  let cssW = rect.width;
  let cssH = rect.height;
  stageFitScale = 1;
  stageRenderScale = dpr;

  if (animation) {
    const viewBounds = stageViewBounds ?? getPamStageBounds(animation);
    const presetW = Math.max(1, viewBounds.width);
    const presetH = Math.max(1, viewBounds.height);
    stageFitScale = Math.max(0.001, Math.min(1, rect.width / presetW, rect.height / presetH));
    stageRenderScale = stageFitScale * dpr;
  }

  // Render at physical resolution for pixel-perfect display (no autoDensity)
  pixiApp.renderer.resize(
    Math.max(1, Math.round(cssW * dpr)),
    Math.max(1, Math.round(cssH * dpr)),
  );
  canvas.style.width = Math.max(1, Math.round(cssW)) + 'px';
  canvas.style.height = Math.max(1, Math.round(cssH)) + 'px';
  drawCurrentFrame();
}
function resizeViewport(): void {
  resizeCanvas();
  syncTabStripPanelOffsets();
}

async function loadFilesFromUi(files: File[]): Promise<void> {
  try {
    if (files.length === 0) { setStatusText(t('status.noFiles')); return; }
    await loadFromFiles(files);
  } catch (err: any) {
    setStatusText(t('status.error', { message: err.message }));
    console.error(err);
  }
}

async function loadDroppedFiles(dataTransfer: DataTransfer): Promise<void> {
  try {
    await loadFilesFromUi(await collectFilesFromDataTransfer(dataTransfer));
  } catch (err: any) {
    setStatusText(t('status.error', { message: err.message }));
    console.error(err);
  }
}

async function loadFromFiles(files: File[]): Promise<void> {
  setStatusText(t('status.loading'));
  saveActiveTabState();
  stop();

  const loadedAnimation = await buildLoadedAnimation(files);
  if (!loadedAnimation) {
    setStatusText(t('status.noPam'));
    return;
  }

  const tab = createAnimationTab(loadedAnimation);
  tabStates.push(tab);
  activateAnimationTab(tab.id, true);
}

// ── Clear ──
function clearAnimation(): void {
  if (activeTabId === null) {
    renderEmptyAnimationState();
    return;
  }
  closeAnimationTab(activeTabId);
}

function activateSprite(index: number): void {
  stop();
  activeSpriteIndex = index;
  spriteValue = index === -1 ? 'main' : String(index);
  activeSprite = index === -1 ? animation!.mainSprite : animation!.sprite[index];
  if (!activeSprite || activeSprite.frame.length === 0) return;

  frameLabels = parseSpriteFrameLabels(activeSprite);
  frameRange = { begin: 0, end: activeSprite.frame.length - 1 };
  currentFrame = reverseChecked ? frameRange.end : frameRange.begin;
  labelValue = 'all';

  enableControls(true);
  if (!keepSpeedChecked) {
    speedValue = String((activeSprite as any).frameRate ?? animation!.frameRate);
  }
  updateSpeedPresetTrigger();
  updateSliderRange();
  updateRangeInputs();
  updateFrameDisplay();
  publishForm();
  highlightActiveSpriteInPanel();
  drawCurrentFrame();

  if (autoplayChecked) play();
}

// ── Label selection ──
function selectLabelValue(value: string): void {
  stop();
  labelValue = value;
  if (value === 'all') {
    frameRange = { begin: 0, end: activeSprite!.frame.length - 1 };
  } else {
    frameRange = JSON.parse(value);
  }
  currentFrame = reverseChecked ? frameRange.end : frameRange.begin;
  updateSliderRange();
  updateRangeInputs();
  updateFrameDisplay();
  drawCurrentFrame();
  publishForm();
}

// ── Frame slider ──
let wasPlayingBeforeSlider = false;

function updateSliderRange(): void {
  publishViewerPlayback({
    frameSliderMin: String(frameRange.begin),
    frameSliderMax: String(frameRange.end),
    frameSliderValue: String(currentFrame),
    frameSliderDisabled: !activeSprite,
  });
}

function updateRangeInputs(): void {
  const maxFrame = activeSprite ? activeSprite.frame.length - 1 : 0;
  publishViewerPlayback({
    rangeBeginValue: String(frameRange.begin),
    rangeEndValue: String(frameRange.end),
    rangeMax: String(maxFrame),
    rangeDisabled: !activeSprite,
  });
}

function setRangeBeginValue(value: string): void {
  const v = Math.max(0, Math.min(parseInt(value, 10) || 0, frameRange.end));
  frameRange.begin = v;
  if (currentFrame < v) currentFrame = v;
  updateSliderRange();
  updateRangeInputs();
  updateFrameDisplay();
  drawCurrentFrame();
}

function setRangeEndValue(value: string): void {
  const maxFrame = activeSprite ? activeSprite.frame.length - 1 : 0;
  const v = Math.max(frameRange.begin, Math.min(parseInt(value, 10) || 0, maxFrame));
  frameRange.end = v;
  if (currentFrame > v) currentFrame = v;
  updateSliderRange();
  updateRangeInputs();
  updateFrameDisplay();
  drawCurrentFrame();
}

function beginFrameScrub(): void {
  wasPlayingBeforeSlider = playing;
  if (playing) stop();
}

function setFrameValue(value: string): void {
  currentFrame = parseInt(value, 10);
  updateFrameDisplay();
  drawCurrentFrame();
}

function endFrameScrub(): void {
  if (wasPlayingBeforeSlider) play();
}

// ── Playback controls ──
function enableControls(enabled: boolean): void {
  publishViewerPlayback({ controlsDisabled: !enabled });
  publishViewerCommand({
    commandDisabled: !enabled,
    webpDisabled: !enabled || !webpEncoderAvailable,
  });
}

function togglePlayback(): void {
  if (playing) stop(); else play();
}

function previousFrame(): void {
  stop();
  currentFrame = currentFrame <= frameRange.begin ? frameRange.end : currentFrame - 1;
  updateFrameDisplay();
  drawCurrentFrame();
}

function nextFrame(): void {
  stop();
  currentFrame = currentFrame >= frameRange.end ? frameRange.begin : currentFrame + 1;
  updateFrameDisplay();
  drawCurrentFrame();
}

function play(): void {
  if (!activeSprite) return;
  playing = true;
  setPlayingState(true);
  lastTimestamp = performance.now();
  accumulator = 0;
  tick(lastTimestamp);
}

function stop(): void {
  playing = false;
  setPlayingState(false);
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function tick(timestamp: number): void {
  if (!playing) return;
  const fps = parseFloat(speedValue) || 30;
  const frameDuration = 1000 / fps;
  const delta = timestamp - lastTimestamp;
  lastTimestamp = timestamp;
  accumulator += delta;

  const reverse = reverseChecked;
  let advanced = false;
  while (accumulator >= frameDuration) {
    accumulator -= frameDuration;
    currentFrame += reverse ? -1 : 1;
    if (!reverse && currentFrame > frameRange.end) {
      if (loopChecked) {
        currentFrame = frameRange.begin;
      } else {
        currentFrame = frameRange.end;
        stop(); updateFrameDisplay(); drawCurrentFrame(); return;
      }
    } else if (reverse && currentFrame < frameRange.begin) {
      if (loopChecked) {
        currentFrame = frameRange.end;
      } else {
        currentFrame = frameRange.begin;
        stop(); updateFrameDisplay(); drawCurrentFrame(); return;
      }
    }
    advanced = true;
  }
  if (advanced) {
    updateFrameDisplay();
    drawCurrentFrame();
  }
  rafId = requestAnimationFrame(tick);
}

function updateFrameDisplay(): void {
  const total = activeSprite ? activeSprite.frame.length : 0;
  if (total === 0) {
    setFrameText('0 / 0');
    publishViewerPlayback({ frameSliderValue: '0' });
    return;
  }
  setFrameText(`${currentFrame} / ${total - 1}`);
  publishViewerPlayback({ frameSliderValue: String(currentFrame) });
}

// ── Zoom / Pan ──
function updateZoomDisplay(): void {
  setZoomText(Math.round(zoom * 100) + '%');
}

function updateSizeDisplay(): void {
  if (!animation) {
    setExportSizeText('');
    return;
  }
  const { width: w, height: h } = getCurrentExportSize();
  setExportSizeText(`${w}\u00d7${h}`);
}

function updateCoordDisplayAt(clientX: number, clientY: number): void {
  if (!animation) { setCoordText(''); return; }
  const point = getCanvasBitmapPoint(clientX, clientY);
  const cx = canvas.width / 2 + panX * stageRenderScale;
  const cy = canvas.height / 2 + panY * stageRenderScale;
  const sx = (point.x - cx) / (zoom * stageRenderScale) + animation.position[0];
  const sy = (point.y - cy) / (zoom * stageRenderScale) + animation.position[1];
  setCoordText(`${Math.round(sx)}, ${Math.round(sy)}`);
}

function wheelStage(clientX: number, clientY: number, deltaY: number): void {
  if (!animation) return;
  const point = getCanvasBitmapPoint(clientX, clientY);
  const cx = canvas.width / 2 + panX * stageRenderScale;
  const cy = canvas.height / 2 + panY * stageRenderScale;
  const ax = (point.x - cx) / (zoom * stageRenderScale) + animation.position[0];
  const ay = (point.y - cy) / (zoom * stageRenderScale) + animation.position[1];

  const factor = deltaY > 0 ? 0.9 : 1.1;
  zoom = Math.max(0.05, Math.min(100, zoom * factor));

  panX = (point.x - canvas.width / 2) / stageRenderScale -
    (ax - animation.position[0]) * zoom;
  panY = (point.y - canvas.height / 2) / stageRenderScale -
    (ay - animation.position[1]) * zoom;

  updateZoomDisplay();
  drawCurrentFrame();
}

let isPanning = false;
let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;

// ── Boundary drag-resize state ──
type EdgeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
let boundaryDragEdge: EdgeDir | null = null;
let boundaryDragStart: {
  mx: number; my: number;
  origW: number; origH: number;
  origPosX: number; origPosY: number;
  origPanX: number; origPanY: number;
  exportScale: string;
} | null = null;
const EDGE_HIT = 6;

function clientToAnimSpace(clientX: number, clientY: number): { ax: number; ay: number } {
  const point = getCanvasBitmapPoint(clientX, clientY);
  const cx = canvas.width / 2 + panX * stageRenderScale;
  const cy = canvas.height / 2 + panY * stageRenderScale;
  const ox = animation!.position[0];
  const oy = animation!.position[1];
  const ax = (point.x - cx) / (zoom * stageRenderScale) + ox;
  const ay = (point.y - cy) / (zoom * stageRenderScale) + oy;
  return { ax, ay };
}

function hitTestBoundaryEdge(clientX: number, clientY: number): EdgeDir | null {
  if (!animation || !boundaryChecked) return null;
  const w = animation.size[0];
  const h = animation.size[1];
  const { ax, ay } = clientToAnimSpace(clientX, clientY);
  const threshold = EDGE_HIT / (zoom * stageFitScale);

  const nearLeft   = Math.abs(ax) < threshold;
  const nearRight  = Math.abs(ax - w) < threshold;
  const nearTop    = Math.abs(ay) < threshold;
  const nearBottom = Math.abs(ay - h) < threshold;
  const inX = ax > -threshold && ax < w + threshold;
  const inY = ay > -threshold && ay < h + threshold;

  if (nearTop && nearLeft && inX && inY) return 'nw';
  if (nearTop && nearRight && inX && inY) return 'ne';
  if (nearBottom && nearLeft && inX && inY) return 'sw';
  if (nearBottom && nearRight && inX && inY) return 'se';
  if (nearTop && inX) return 'n';
  if (nearBottom && inX) return 's';
  if (nearLeft && inY) return 'w';
  if (nearRight && inY) return 'e';
  return null;
}

const EDGE_CURSORS: Record<EdgeDir, string> = {
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  nw: 'nwse-resize', se: 'nwse-resize',
};

function syncExportSizeAfterBoundaryResize(exportScale: string): void {
  if (exportScale === 'custom') {
    setExportSizeScaleValue(getCurrentExportSize());
    updateSizeDisplay();
    return;
  }

  setExportSizeFromScale(exportScale);
}

function pointerDownStage(clientX: number, clientY: number, button: number): boolean {
  const edge = hitTestBoundaryEdge(clientX, clientY);
  if (edge && button === 0) {
    boundaryDragEdge = edge;
    boundaryDragStart = {
      mx: clientX, my: clientY,
      origW: animation!.size[0], origH: animation!.size[1],
      origPosX: animation!.position[0], origPosY: animation!.position[1],
      origPanX: panX, origPanY: panY,
      exportScale: sizeScaleValue,
    };
    return true;
  }

  if (button === 0 || button === 1) {
    isPanning = true;
    panStartX = clientX;
    panStartY = clientY;
    panOriginX = panX;
    panOriginY = panY;
    return true;
  }
  return false;
}

function pointerMoveStage(clientX: number, clientY: number): void {
  updateCoordDisplayAt(clientX, clientY);

  if (boundaryDragEdge && boundaryDragStart) {
    const dx = (clientX - boundaryDragStart.mx) / (zoom * stageFitScale);
    const dy = (clientY - boundaryDragStart.my) / (zoom * stageFitScale);
    const edge = boundaryDragEdge;
    let newW = boundaryDragStart.origW;
    let newH = boundaryDragStart.origH;
    let newPosX = boundaryDragStart.origPosX;
    let newPosY = boundaryDragStart.origPosY;

    if (edge.includes('e')) newW = Math.max(1, Math.round(boundaryDragStart.origW + dx));
    if (edge.includes('w')) {
      newW = Math.max(1, Math.round(boundaryDragStart.origW - dx));
      newPosX = Math.round(boundaryDragStart.origPosX - dx);
    }
    if (edge.includes('s')) newH = Math.max(1, Math.round(boundaryDragStart.origH + dy));
    if (edge.includes('n')) {
      newH = Math.max(1, Math.round(boundaryDragStart.origH - dy));
      newPosY = Math.round(boundaryDragStart.origPosY - dy);
    }

    animation!.size[0] = newW;
    animation!.size[1] = newH;
    animation!.position[0] = newPosX;
    animation!.position[1] = newPosY;
    refreshStageViewBounds();
    resetPanToStageView();
    syncExportSizeAfterBoundaryResize(boundaryDragStart.exportScale);
    resizeCanvas();
    return;
  }

  if (!isPanning) {
    const edge = hitTestBoundaryEdge(clientX, clientY);
    publishViewerChrome({ stageCursor: edge ? EDGE_CURSORS[edge] : '' });
  }

  if (!isPanning) return;
  panX = panOriginX + (clientX - panStartX) / stageFitScale;
  panY = panOriginY + (clientY - panStartY) / stageFitScale;
  drawCurrentFrame();
}

function pointerLeaveStage(): void {
  setCoordText('');
  if (!boundaryDragEdge) publishViewerChrome({ stageCursor: '' });
}

function pointerUpStage(): boolean {
  if (boundaryDragEdge) {
    boundaryDragEdge = null;
    boundaryDragStart = null;
    publishViewerChrome({ stageCursor: '' });
    return true;
  }
  if (isPanning) {
    isPanning = false;
    return true;
  }
  return false;
}

function resetZoomView(): void {
  zoom = 1.0;
  resetPanToStageView();
  updateZoomDisplay();
  drawCurrentFrame();
}

function zoomInView(): void {
  zoom = Math.min(100, zoom * 1.15);
  updateZoomDisplay();
  drawCurrentFrame();
}

function zoomOutView(): void {
  zoom = Math.max(0.05, zoom / 1.15);
  updateZoomDisplay();
  drawCurrentFrame();
}

// ── Filter panels ──
function getSpriteThumbTexture(sp: Animation['sprite'][0]): HTMLImageElement | null {
  if (sp.frame.length !== 1) return null;
  const frame0 = sp.frame[0];
  for (const a of frame0.append) {
    if (!a.sprite && a.resource < animation!.image.length) {
      const imgDef = animation!.image[a.resource];
      return textures.get(imgDef.name) || null;
    }
  }
  return null;
}

function publishPanels(): void {
  if (!animation) {
    publishViewerPanels({ images: [], sprites: [], imageRegex, spriteRegex });
    return;
  }

  publishViewerPanels({
    imageRegex,
    spriteRegex,
    images: animation.image.map((img, i) => {
      const tex = textures.get(img.name);
      return {
        index: i,
        name: parseImageFileName(img.name),
        title: img.name,
        filterName: parseImageFileName(img.name).toLowerCase(),
        thumbSrc: tex?.src ?? null,
        sizeText: img.size ? `${img.size.width}\u00d7${img.size.height}` : null,
        checked: imageFilter[i] ?? true,
      };
    }),
    sprites: [
      ...animation.sprite.map((sp, i) => {
        const thumbTex = getSpriteThumbTexture(sp);
        return {
          key: String(i),
          spriteIndex: i,
          name: sp.name || 'sprite_' + i,
          filterName: (sp.name || 'sprite_' + i).toLowerCase(),
          thumbSrc: thumbTex?.src ?? null,
          frameText: sp.frame.length + 'f',
          checked: spriteFilter[i] ?? true,
          active: activeSpriteIndex === i,
          main: false,
        };
      }),
      ...(animation.mainSprite ? [{
        key: 'main',
        spriteIndex: -1,
        name: 'MainSprite',
        filterName: 'mainsprite',
        thumbSrc: null,
        frameText: animation.mainSprite.frame.length + 'f',
        checked: null,
        active: activeSpriteIndex === -1,
        main: true,
      }] : []),
    ],
  });
}

function populateImagePanel(): void {
  publishPanels();
}

function populateSpritePanel(): void {
  publishPanels();
}

function highlightActiveSpriteInPanel(): void {
  publishPanels();
}

const unsetViewerPanelActions = setViewerPanelActions({
  setImageChecked: (index, checked) => {
    imageFilter[index] = checked;
    publishPanels();
    drawCurrentFrame();
  },
  setSpriteChecked: (index, checked) => {
    spriteFilter[index] = checked;
    syncSpecialLayerUI();
    publishPanels();
    drawCurrentFrame();
  },
  activateSprite: (index) => {
    activateSprite(index);
  },
  setImageRegex: (value) => {
    imageRegex = value;
    publishPanels();
  },
  setSpriteRegex: (value) => {
    spriteRegex = value;
    publishPanels();
  },
  selectAllImages: () => {
    imageFilter.fill(true);
    publishPanels();
    drawCurrentFrame();
  },
  clearImages: () => {
    imageFilter.fill(false);
    publishPanels();
    drawCurrentFrame();
  },
  selectAllSprites: () => {
    spriteFilter.fill(true);
    syncSpecialLayerUI();
    publishPanels();
    drawCurrentFrame();
  },
  clearSprites: () => {
    spriteFilter.fill(false);
    syncSpecialLayerUI();
    publishPanels();
    drawCurrentFrame();
  },
});

const unsetViewerPlaybackActions = setViewerPlaybackActions({
  previousFrame,
  togglePlayback,
  nextFrame,
  beginFrameScrub,
  setFrame: setFrameValue,
  endFrameScrub,
  setRangeBegin: setRangeBeginValue,
  setRangeEnd: setRangeEndValue,
});

const unsetViewerCommandActions = setViewerCommandActions({
  loadFiles: (files) => { void loadFilesFromUi(files); },
  dropFiles: (dataTransfer) => { void loadDroppedFiles(dataTransfer); },
  clear: clearAnimation,
  toggleImages: toggleImagesPanel,
  toggleSprites: toggleSpritesPanel,
  beginPanelResize,
  resizePanel,
  endPanelResize,
  resizeViewport,
  resetZoom: resetZoomView,
  zoomIn: zoomInView,
  zoomOut: zoomOutView,
  exportPng,
  exportApng,
  exportWebp,
  exportFla: () => { void exportFla(); },
  convertJson: () => { void convertJson(); },
  convertYaml,
  convertToml,
  convertPam: () => { void convertPam(); },
  cancelExport: () => { exportCancelled = true; },
});

const unsetViewerStageActions = setViewerStageActions({
  wheel: wheelStage,
  pointerDown: pointerDownStage,
  pointerMove: pointerMoveStage,
  pointerLeave: pointerLeaveStage,
  pointerUp: pointerUpStage,
});

const unsetViewerFormActions = setViewerFormActions({
  selectSprite: (value) => activateSprite(value === 'main' ? -1 : parseInt(value, 10)),
  selectLabel: selectLabelValue,
  selectPlantLayer: selectPlantLayerValue,
  selectZombieState: selectZombieStateValue,
  setGroundSwatch: setGroundSwatchValue,
  setSpeed: setSpeedValue,
  selectSpeedPreset: selectSpeedPresetValue,
  setSizeWidth: setExportWidthValue,
  setSizeHeight: setExportHeightValue,
  selectSizeScale: selectSizeScaleValue,
  setLoop: setLoopChecked,
  setReverse: setReverseChecked,
  setAutoplay: setAutoplayChecked,
  setKeepSpeed: setKeepSpeedChecked,
  setBoundary: setBoundaryChecked,
  selectTheme: selectThemePreference,
});

// ── Special Layer Detection & Controls ──

function renderSpecialLayerControls(): void {
  if (plantCustomLayers.length > 0) {
    plantLayerValue = 'none';
  } else {
    plantLayerValue = '';
  }

  if (zombieStateLayers.length > 0) {
    zombieStateValue = 'none';
  } else {
    zombieStateValue = '';
  }

  if (groundSwatchLayers.length > 0) {
    groundSwatchChecked = groundSwatchLayers.some(idx => spriteFilter[idx]);
  } else {
    groundSwatchChecked = false;
  }
  syncSpecialLayerUI();
  publishForm();
}

function syncSpriteCheckbox(sprIndex: number, checked: boolean): void {
  spriteFilter[sprIndex] = checked;
}

function applyExclusiveLayer(layerIndices: number[], selectedIdx: number): void {
  for (const idx of layerIndices) {
    const show = idx === selectedIdx;
    spriteFilter[idx] = show;
    syncSpriteCheckbox(idx, show);
  }
  publishPanels();
  drawCurrentFrame();
}

function syncSpecialLayerUI(): void {
  if (plantCustomLayers.length > 0) {
    const visible = plantCustomLayers.filter(i => spriteFilter[i]);
    if (visible.length === 0) plantLayerValue = 'none';
    else if (visible.length === 1) plantLayerValue = String(visible[0]);
  }
  if (zombieStateLayers.length > 0) {
    const visible = zombieStateLayers.filter(i => spriteFilter[i]);
    if (visible.length === 0) zombieStateValue = 'none';
    else if (visible.length === 1) zombieStateValue = String(visible[0]);
  }
  if (groundSwatchLayers.length > 0) {
    groundSwatchChecked = groundSwatchLayers.some(i => spriteFilter[i]);
  }
  publishForm();
}

function selectPlantLayerValue(val: string): void {
  plantLayerValue = val;
  const selectedIdx = val === 'none' ? -1 : parseInt(val, 10);
  applyExclusiveLayer(plantCustomLayers, selectedIdx);
}

function selectZombieStateValue(val: string): void {
  zombieStateValue = val;
  const selectedIdx = val === 'none' ? -1 : parseInt(val, 10);
  applyExclusiveLayer(zombieStateLayers, selectedIdx);
}

function setGroundSwatchValue(show: boolean): void {
  groundSwatchChecked = show;
  for (const idx of groundSwatchLayers) {
    spriteFilter[idx] = show;
    syncSpriteCheckbox(idx, show);
  }
  publishPanels();
  drawCurrentFrame();
  syncSpecialLayerUI();
}

// ── Panel resize handles ──
function setPanelWidth(panel: HTMLElement, width: number): void {
  panel.style.setProperty('--panel-width', `${clampPanelWidth(width)}px`);
  syncTabStripPanelOffsets();
}

function readPanelWidth(panel: HTMLElement): number {
  const value = parseFloat(panel.style.getPropertyValue('--panel-width'));
  if (Number.isFinite(value) && value > 0) return clampPanelWidth(value);
  const rectWidth = panel.getBoundingClientRect().width;
  return rectWidth > 0 ? clampPanelWidth(rectWidth) : 240;
}

function readVisiblePanelWidth(panel: HTMLElement): number {
  if (panel === panelImages && !imagesPanelVisible) return 0;
  if (panel === panelSprites && !spritesPanelVisible) return 0;
  const rectWidth = panel.getBoundingClientRect().width;
  return rectWidth > 0 ? Math.round(rectWidth) : readPanelWidth(panel);
}

function syncTabStripPanelOffsets(): void {
  tabStrip.style.setProperty('--image-panel-tab-offset', `${readVisiblePanelWidth(panelImages)}px`);
  tabStrip.style.setProperty('--sprite-panel-tab-offset', `${readVisiblePanelWidth(panelSprites)}px`);
}

let panelResizeState: {
  panel: HTMLElement;
  side: 'left' | 'right';
  startX: number;
  startWidth: number;
} | null = null;

function beginPanelResize(which: 'images' | 'sprites', clientX: number): void {
  const panel = which === 'images' ? panelImages : panelSprites;
  panelResizeState = {
    panel,
    side: which === 'images' ? 'left' : 'right',
    startX: clientX,
    startWidth: panel.getBoundingClientRect().width,
  };
}

function resizePanel(clientX: number): void {
  if (!panelResizeState) return;
  const delta = panelResizeState.side === 'left'
    ? clientX - panelResizeState.startX
    : panelResizeState.startX - clientX;
  setPanelWidth(panelResizeState.panel, panelResizeState.startWidth + delta);
  requestAnimationFrame(resizeCanvas);
}

function endPanelResize(): void {
  if (!panelResizeState) return;
  panelResizeState = null;
  saveSettings();
}

function setPanelVisible(which: 'images' | 'sprites', visible: boolean): void {
  if (which === 'images') {
    imagesPanelVisible = visible;
  } else {
    spritesPanelVisible = visible;
  }
  publishViewerChrome({
    imagesPanelVisible,
    spritesPanelVisible,
  });
  syncTabStripPanelOffsets();
}

function toggleImagesPanel(): void {
  setPanelVisible('images', !imagesPanelVisible);
  saveSettings();
  requestAnimationFrame(resizeCanvas);
}

function toggleSpritesPanel(): void {
  setPanelVisible('sprites', !spritesPanelVisible);
  saveSettings();
  requestAnimationFrame(resizeCanvas);
}

// ── Rendering ──
function drawCurrentFrame(): void {
  if (!animation || !activeSprite || !pixiApp) return;

  const cw = canvas.width;
  const ch = canvas.height;

  // Clear the stage
  pixiApp.stage.removeChildren();

  // Render the frame content as a PixiJS container
  const frameContent = renderFrameToPixiContainer(
    animation, textures, spriteTimelines!,
    activeSpriteIndex, currentFrame,
    imageFilter, spriteFilter,
    zoom, panX, panY,
    cw, ch, stageRenderScale,
  );
  if (frameContent) {
    pixiApp.stage.addChild(frameContent);
  }

  // Boundary overlay
  if (boundaryChecked) {
    const boundaryOverlay = createBoundaryOverlay(
      animation, zoom, panX, panY,
      cw, ch, stageRenderScale,
    );
    pixiApp.stage.addChild(boundaryOverlay);
  }
}

function setBoundaryChecked(value: boolean): void {
  boundaryChecked = value;
  drawCurrentFrame();
  publishForm();
  saveSettings();
}

function setLoopChecked(value: boolean): void {
  loopChecked = value;
  publishForm();
  saveSettings();
}

function setReverseChecked(value: boolean): void {
  reverseChecked = value;
  publishForm();
  saveSettings();
}

function setAutoplayChecked(value: boolean): void {
  autoplayChecked = value;
  publishForm();
  saveSettings();
}

function setKeepSpeedChecked(value: boolean): void {
  keepSpeedChecked = value;
  publishForm();
  saveSettings();
}

// ── Size controls ──
const sizeAspectLocked = true;

function setExportWidthValue(value: string): void {
  if (!animation) return;
  const w = parseExportDimensionValue(value, currentExportSize.width);
  const nextSize = { width: w, height: currentExportSize.height };
  if (sizeAspectLocked && animation.size[0] > 0) {
    const ratio = animation.size[1] / animation.size[0];
    nextSize.height = Math.round(w * ratio);
  }
  setExportSizeValue(nextSize);
}

function setExportHeightValue(value: string): void {
  if (!animation) return;
  const h = parseExportDimensionValue(value, currentExportSize.height);
  const nextSize = { width: currentExportSize.width, height: h };
  if (sizeAspectLocked && animation.size[1] > 0) {
    const ratio = animation.size[0] / animation.size[1];
    nextSize.width = Math.round(h * ratio);
  }
  setExportSizeValue(nextSize);
}

function selectSizeScaleValue(value: string): void {
  setExportSizeFromScale(value);
  saveSettings();
}

// ── Speed preset menu ──
const SPEED_PRESETS = [
  { label: '0.25\u00d7', factor: 0.25 },
  { label: '0.5\u00d7',  factor: 0.5 },
  { label: '1\u00d7',    factor: 1 },
  { label: '1.5\u00d7',  factor: 1.5 },
  { label: '2\u00d7',    factor: 2 },
  { label: '3\u00d7',    factor: 3 },
  { label: '4\u00d7',    factor: 4 },
];

function getBaseFrameRate(): number {
  return (activeSprite as any)?.frameRate ?? animation?.frameRate ?? 30;
}

function getMatchingSpeedPresetValue(): string {
  const fps = parseInt(speedValue, 10);
  if (!Number.isFinite(fps)) return 'custom';

  const baseRate = getBaseFrameRate();
  const preset = SPEED_PRESETS.find(p => Math.round(baseRate * p.factor) === fps);
  return preset ? String(preset.factor) : 'custom';
}

function updateSpeedPresetTrigger(): void {
  publishForm();
}

function setSpeedValue(value: string): void {
  speedValue = value;
  updateSpeedPresetTrigger();
  saveSettings();
}

function selectSpeedPresetValue(value: string): void {
  const preset = SPEED_PRESETS.find(p => String(p.factor) === value);
  if (!preset) {
    updateSpeedPresetTrigger();
    return;
  }
  setSpeedValue(String(Math.round(getBaseFrameRate() * preset.factor)));
}

// ── Export helpers ──
let exportCancelled = false;

function isCanvasImageSource(value: unknown): value is CanvasImageSource {
  if (value instanceof HTMLCanvasElement) return true;
  if (value instanceof HTMLImageElement) return true;
  if (value instanceof HTMLVideoElement) return true;
  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) return true;
  if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) return true;
  return false;
}

function renderFrameToCanvas(frameIdx: number, w: number, h: number): HTMLCanvasElement {
  if (!pixiApp) throw new Error('PixiJS app is not initialized.');
  const scale = Math.min(w / Math.max(animation!.size[0], 1), h / Math.max(animation!.size[1], 1));
  const panExportX = animation!.position[0] * scale - w / 2;
  const panExportY = animation!.position[1] * scale - h / 2;

  const frameContent = renderFrameToPixiContainer(
    animation!, textures, spriteTimelines!,
    activeSpriteIndex, frameIdx,
    imageFilter, spriteFilter,
    scale, panExportX, panExportY,
    w, h, 1,
  );

  const extracted = pixiApp.renderer.extract.canvas({
    target: frameContent,
    frame: new Rectangle(0, 0, w, h),
    resolution: 1,
    clearColor: '#00000000',
  });

  if (extracted instanceof HTMLCanvasElement) {
    return extracted;
  }

  const fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = w;
  fallbackCanvas.height = h;
  const fallbackCtx = fallbackCanvas.getContext('2d');
  if (fallbackCtx && isCanvasImageSource(extracted)) {
    fallbackCtx.drawImage(extracted, 0, 0, w, h);
  } else {
    console.warn('Pixi extract returned non-canvas image source; export frame is blank.');
  }
  return fallbackCanvas;
}

function getExportSize(): { w: number; h: number } {
  const size = getCurrentExportSize();
  return { w: size.width, h: size.height };
}

function showExportOverlay(title: string): void {
  exportCancelled = false;
  publishViewerExport({
    visible: true,
    title,
    progress: 0,
    status: t('export.preparing'),
  });
}

function hideExportOverlay(): void {
  publishViewerExport({ visible: false });
}

function getActiveAnimationBaseName(): string {
  return stripKnownAnimationExtension(getActiveTab()?.displayName ?? 'animation');
}

function getExportName(ext: string): string {
  const base = getActiveAnimationBaseName();
  const sprName = activeSpriteIndex === -1 ? 'main' : (animation!.sprite[activeSpriteIndex].name || 'sprite_' + activeSpriteIndex);
  return base + '_' + sprName + '.' + ext;
}

// ── Export PNG (current frame) ──
function exportPng(): void {
  if (!animation || !activeSprite) return;
  const { w, h } = getExportSize();
  const offCanvas = renderFrameToCanvas(currentFrame, w, h);
  offCanvas.toBlob(blob => {
    if (blob) downloadBlob(blob, getExportName('png'));
  }, 'image/png');
  drawCurrentFrame();
}

initAnimatedWebpEncoder().catch(() => {
  webpEncoderAvailable = false;
  publishViewerCommand({
    webpDisabled: true,
    webpTitle: 'WebP WASM failed to load',
  });
});

// ── Export animation helper ──
async function exportAnimCommon(
  formatLabel: string,
  encodeFn: (frames: HTMLCanvasElement[], w: number, h: number, fps: number) => Promise<Uint8Array>,
  mime: string,
  ext: string,
): Promise<void> {
  if (!animation || !activeSprite) return;
  showExportOverlay(t('export.exporting', { format: formatLabel }));

  try {
    const { w, h } = getExportSize();
    const begin = frameRange.begin;
    const end = frameRange.end;
    const totalFrames = end - begin + 1;
    const fps = parseInt(speedValue, 10) || 30;

    const canvasFrames: HTMLCanvasElement[] = [];
    for (let i = 0; i < totalFrames; i++) {
      if (exportCancelled) { hideExportOverlay(); drawCurrentFrame(); return; }
      const fi = begin + i;
      canvasFrames.push(renderFrameToCanvas(fi, w, h));
      publishViewerExport({
        progress: ((i + 1) / totalFrames) * 50,
        status: t('export.rendering', { current: String(i + 1), total: String(totalFrames) }),
      });
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }

    if (exportCancelled) { hideExportOverlay(); drawCurrentFrame(); return; }
    publishViewerExport({
      progress: 50,
      status: t('export.encoding', { format: formatLabel }),
    });
    await new Promise(r => setTimeout(r, 0));

    const bytes = await encodeFn(canvasFrames, w, h, fps);
    publishViewerExport({ progress: 100 });

    if (!exportCancelled) {
      const blob = new Blob([bytes as BlobPart], { type: mime });
      downloadBlob(blob, getExportName(ext));
    }
  } catch (e: any) {
    alert(e.message || t('export.failed'));
  }
  hideExportOverlay();
  drawCurrentFrame();
}

function exportApng(): void {
  void exportAnimCommon('APNG', encodeApng, 'image/apng', 'apng');
}

function exportWebp(): void {
  void exportAnimCommon('WebP', encodeAnimatedWebp, 'image/webp', 'webp');
}

// ── Export FLA ──
async function exportFla(): Promise<void> {
  if (!animation) return;
  const baseName = getActiveAnimationBaseName();
  publishViewerCommand({ commandDisabled: true });
  try {
    const blob = await exportFLA(animation, textures);
    downloadBlob(blob, baseName + '.fla');
  } finally {
    enableControls(Boolean(activeSprite));
  }
}

// ── Format conversion exports ──
function getConvertName(ext: string): string {
  return getActiveAnimationBaseName() + '.pam.' + ext;
}

async function convertJson(): Promise<void> {
  if (!animation) return;
  const raw = toRawJson(animation);
  const wasm = await loadPamCodecWasm();
  const text = wasm.pamToJson(raw) + '\n';
  const blob = new Blob([text], { type: 'application/json' });
  downloadBlob(blob, getConvertName('json'));
}

function convertYaml(): void {
  if (!animation) return;
  const raw = toRawJson(animation);
  const text = jsYamlMod.dump(raw, { lineWidth: -1, noRefs: true });
  const blob = new Blob([text], { type: 'text/yaml' });
  downloadBlob(blob, getConvertName('yaml'));
}

function convertToml(): void {
  if (!animation) return;
  const raw = toRawJson(animation);
  const text = smolTomlMod.stringify(raw as any);
  const blob = new Blob([text], { type: 'application/toml' });
  downloadBlob(blob, getConvertName('toml'));
}

async function convertPam(): Promise<void> {
  if (!animation) return;
  const raw = toRawJson(animation);
  const buf = await encodePAM(raw);
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const name = getActiveAnimationBaseName() + '.pam';
  downloadBlob(blob, name);
}

// ── Init ──
async function initApp(): Promise<void> {
  // Initialize PixiJS Application
  pixiApp = new Application();
  await pixiApp.init({
    canvas,
    backgroundAlpha: 0,
    antialias: true,
    resolution: 1,
    autoDensity: false,
    preference: 'webgl',
  });

  loadSettings();
  renderEmptyAnimationState();
  syncTabStripPanelOffsets();
  resizeCanvas();
}

await initApp().catch((err: unknown) => {
  console.error('Failed to initialize PixiJS:', err);
  setStatusText('PixiJS 初始化失败');
  throw err;
});

let mounted = true;
return () => {
  if (!mounted) return;
  mounted = false;
  stop();
  pixiApp?.destroy(true);
  pixiApp = null;
  resetPixiRenderer();
  unsetViewerTabActions();
  unsetViewerPanelActions();
  unsetViewerPlaybackActions();
  unsetViewerCommandActions();
  unsetViewerStageActions();
  unsetViewerFormActions();
  unsubscribeLangChange();
  for (const dispose of [...listenerDisposers].reverse()) dispose();
  activeControllerPromise = null;
};
}
