import { Application } from 'pixi.js';
import { parseSpriteFrameLabels } from '../domain/model';
import { t, onLangChange } from '../localization/i18n';
import { renderFrameToPixiContainer, createBoundaryOverlay, resetPixiRenderer } from '../rendering/pixi-renderer';
import { collectFilesFromDataTransfer } from './files';
import { buildLoadedAnimation } from './load-animation';
import { initAnimatedWebpEncoder } from '../export/animated-webp';
import type { Animation, TimelinesMap } from '../domain/types';
import { waitForViewerDomRefs } from './viewer-dom';
import { createExportActions } from './controller/export-actions';
import { buildViewerFormSnapshot } from './controller/form-snapshot';
import {
  computeStageViewBoundsFor,
  getExportScaleValueFor,
  getPamStageBounds,
  getPanForStageBounds,
  normalizeExportSize,
  parseExportDimensionValue,
} from './controller/geometry';
import { createPanelLayoutController } from './controller/panel-layout';
import {
  SETTINGS_KEY,
  getStoredSizeScale,
  getStoredSpeedValue,
  getStoredThemePreference,
  isPositiveNumber,
  isPositiveNumericString,
  isThemePreference,
  readSettings,
} from './controller/settings';
import {
  SPEED_PRESETS,
  getBaseFrameRate as getBaseFrameRateFor,
  getMatchingSpeedPresetValue as getMatchingSpeedPresetValueFor,
} from './controller/speed-presets';
import {
  createAnimationTab as createAnimationTabState,
  getSpriteForAnimation,
} from './controller/tabs';
import { buildViewerPanelsSnapshot } from './controller/panel-snapshot';
import { createPlaybackController } from './controller/playback-controller';
import { createSpecialLayerControls } from './controller/special-layer-controls';
import { createStageInteractionController } from './controller/stage-interaction';
import type { AnimationTab, ExportSize, StageBounds, ThemePreference } from './controller/types';
import {
  publishViewerChrome,
  publishViewerCommand,
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
  if (isPositiveNumber(s.imagePanelWidth)) panelLayout.setWidth('images', s.imagePanelWidth);
  if (isPositiveNumber(s.spritePanelWidth)) panelLayout.setWidth('sprites', s.spritePanelWidth);
  if (typeof s.showImages === 'boolean') panelLayout.setVisible('images', s.showImages);
  if (typeof s.showSprites === 'boolean') panelLayout.setVisible('sprites', s.showSprites);
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
      imagePanelWidth: panelLayout.readWidth('images'),
      spritePanelWidth: panelLayout.readWidth('sprites'),
      showImages: panelLayout.isVisible('images'),
      showSprites: panelLayout.isVisible('sprites'),
    }));
  } catch (error) {
    console.warn('Failed to save viewer settings:', error);
  }
}

const panelLayout = createPanelLayoutController({
  requestCanvasResize: () => {
    requestAnimationFrame(resizeCanvas);
  },
  saveSettings,
});

const {
  stageContainer,
  canvas,
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
let webpEncoderAvailable = true;

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

function refreshStageViewBounds(): void {
  stageViewBounds = animation
    ? computeStageViewBoundsFor(animation, textures, spriteTimelines)
    : null;
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

let currentExportSize: ExportSize = { width: 1, height: 1 };
let sizeScaleValue = getStoredSizeScale();

function getCurrentExportSize(): ExportSize {
  return currentExportSize;
}

function updateSizeControls(): void {
  publishForm();
}

function setExportSizeValue(size: ExportSize, syncScale = true): void {
  currentExportSize = normalizeExportSize(size);
  if (syncScale) sizeScaleValue = getExportScaleValueFor(animation, currentExportSize);
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
  sizeScaleValue = getExportScaleValueFor(animation, size);
  updateSizeControls();
}

// Filters
let imageFilter: boolean[] = [];
let spriteFilter: boolean[] = [];
let imageRegex = '';
let spriteRegex = '';
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
  publishViewerForm(buildViewerFormSnapshot({
    animation,
    activeSprite,
    frameLabels,
    plantCustomLayers,
    zombieStateLayers,
    groundSwatchLayers,
    spriteValue,
    labelValue,
    plantLayerValue,
    zombieStateValue,
    groundSwatchChecked,
    speedValue,
    speedPresetValue: getMatchingSpeedPresetValue(),
    currentExportSize,
    sizeScaleValue,
    loopChecked,
    reverseChecked,
    autoplayChecked,
    keepSpeedChecked,
    boundaryChecked,
    themePreference,
  }));
}

function renderEmptyAnimationState(): void {
  playback.stop();
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
  playback.updateSliderRange();
  playback.updateRangeInputs();
  publishViewerCommand({ clearDisabled: true });
  playback.updateFrameDisplay();
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
    playback.updateSliderRange();
    playback.updateRangeInputs();
    playback.updateFrameDisplay();
  } else {
    labelValue = '';
    enableControls(false);
    playback.updateSliderRange();
    playback.updateRangeInputs();
    playback.updateFrameDisplay();
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
  specialLayers.renderControls();
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
  if (startPlayback && activeSprite && autoplayChecked) playback.play();
}

function activateAnimationTab(tabId: number, startPlayback = false): void {
  if (activeTabId === tabId) {
    renderTabs();
    return;
  }
  saveActiveTabState();
  playback.stop();
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

  playback.stop();
  activeTabId = null;
  if (nextActiveId !== null) {
    activateAnimationTab(nextActiveId);
  } else {
    renderEmptyAnimationState();
  }
}

function moveAnimationTab(tabId: number, targetTabId: number, placement: 'before' | 'after'): void {
  if (tabId === targetTabId || tabStates.length < 2) return;

  const sourceIndex = tabStates.findIndex(tab => tab.id === tabId);
  if (sourceIndex === -1) return;

  const [tab] = tabStates.splice(sourceIndex, 1);
  const targetIndex = tabStates.findIndex(candidate => candidate.id === targetTabId);
  if (targetIndex === -1) {
    tabStates.splice(sourceIndex, 0, tab);
    return;
  }

  const insertIndex = placement === 'after' ? targetIndex + 1 : targetIndex;
  tabStates.splice(insertIndex, 0, tab);
  renderTabs();
}

const unsetViewerTabActions = setViewerTabActions({
  activateTab: activateAnimationTab,
  closeTab: closeAnimationTab,
  moveTab: moveAnimationTab,
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
  playback.stop();

  const loadedAnimation = await buildLoadedAnimation(files);
  if (!loadedAnimation) {
    setStatusText(t('status.noPam'));
    return;
  }

  const tab = createAnimationTabState(loadedAnimation, {
    id: nextTabId++,
    reverseChecked,
    initialSpeedValue: keepSpeedChecked ? (getStoredSpeedValue() ?? speedValue) : undefined,
  });
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
  playback.stop();
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
  playback.updateSliderRange();
  playback.updateRangeInputs();
  playback.updateFrameDisplay();
  publishForm();
  highlightActiveSpriteInPanel();
  drawCurrentFrame();

  if (autoplayChecked) playback.play();
}

// ── Label selection ──
function selectLabelValue(value: string): void {
  playback.stop();
  labelValue = value;
  if (value === 'all') {
    frameRange = { begin: 0, end: activeSprite!.frame.length - 1 };
  } else {
    frameRange = JSON.parse(value);
  }
  currentFrame = reverseChecked ? frameRange.end : frameRange.begin;
  playback.updateSliderRange();
  playback.updateRangeInputs();
  playback.updateFrameDisplay();
  drawCurrentFrame();
  publishForm();
}

const playback = createPlaybackController({
  getActiveSprite: () => activeSprite,
  getFrameRange: () => frameRange,
  setFrameRange: value => { frameRange = value; },
  getCurrentFrame: () => currentFrame,
  setCurrentFrame: value => { currentFrame = value; },
  getSpeedValue: () => speedValue,
  isLoopChecked: () => loopChecked,
  isReverseChecked: () => reverseChecked,
  setPlayingState,
  setFrameText,
  drawCurrentFrame,
});

// ── Playback controls ──
function enableControls(enabled: boolean): void {
  publishViewerPlayback({ controlsDisabled: !enabled });
  publishViewerCommand({
    commandDisabled: !enabled,
    webpDisabled: !enabled || !webpEncoderAvailable,
  });
}

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

const stageInteraction = createStageInteractionController({
  canvas,
  getAnimation: () => animation,
  isBoundaryEnabled: () => boundaryChecked,
  getZoom: () => zoom,
  setZoom: value => { zoom = value; },
  getPan: () => ({ x: panX, y: panY }),
  setPan: pan => {
    panX = pan.x;
    panY = pan.y;
  },
  getStageFitScale: () => stageFitScale,
  getStageRenderScale: () => stageRenderScale,
  getSizeScaleValue: () => sizeScaleValue,
  getCurrentExportSize,
  setExportSizeScaleValue,
  setExportSizeFromScale,
  updateZoomDisplay,
  updateSizeDisplay,
  setCoordText,
  setStageCursor: cursor => publishViewerChrome({ stageCursor: cursor }),
  refreshStageViewBounds,
  resetPanToStageView,
  resizeCanvas,
  drawCurrentFrame,
});

function publishPanels(): void {
  publishViewerPanels(buildViewerPanelsSnapshot({
    animation,
    textures,
    activeSpriteIndex,
    imageFilter,
    spriteFilter,
    imageRegex,
    spriteRegex,
  }));
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

const specialLayers = createSpecialLayerControls({
  getPlantLayers: () => plantCustomLayers,
  getZombieStateLayers: () => zombieStateLayers,
  getGroundSwatchLayers: () => groundSwatchLayers,
  getSpriteFilter: () => spriteFilter,
  setSpriteVisible: (index, visible) => {
    spriteFilter[index] = visible;
  },
  setPlantLayerValue: value => { plantLayerValue = value; },
  setZombieStateValue: value => { zombieStateValue = value; },
  setGroundSwatchChecked: checked => { groundSwatchChecked = checked; },
  publishForm,
  publishPanels,
  drawCurrentFrame,
});

const unsetViewerPanelActions = setViewerPanelActions({
  setImageChecked: (index, checked) => {
    imageFilter[index] = checked;
    publishPanels();
    drawCurrentFrame();
  },
  setSpriteChecked: (index, checked) => {
    spriteFilter[index] = checked;
    specialLayers.syncUI();
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
    specialLayers.syncUI();
    publishPanels();
    drawCurrentFrame();
  },
  clearSprites: () => {
    spriteFilter.fill(false);
    specialLayers.syncUI();
    publishPanels();
    drawCurrentFrame();
  },
});

const unsetViewerPlaybackActions = setViewerPlaybackActions({
  previousFrame: playback.previousFrame,
  togglePlayback: playback.toggle,
  nextFrame: playback.nextFrame,
  beginFrameScrub: playback.beginFrameScrub,
  setFrame: playback.setFrame,
  endFrameScrub: playback.endFrameScrub,
  setRangeBegin: playback.setRangeBegin,
  setRangeEnd: playback.setRangeEnd,
});

const exportActions = createExportActions({
  getPixiApp: () => pixiApp,
  getAnimation: () => animation,
  getTextures: () => textures,
  getSpriteTimelines: () => spriteTimelines,
  getActiveSprite: () => activeSprite,
  getActiveSpriteIndex: () => activeSpriteIndex,
  getCurrentFrame: () => currentFrame,
  getFrameRange: () => frameRange,
  getImageFilter: () => imageFilter,
  getSpriteFilter: () => spriteFilter,
  getSpeedValue: () => speedValue,
  getExportSize: getCurrentExportSize,
  getDisplayName: () => getActiveTab()?.displayName ?? 'animation',
  drawCurrentFrame,
  setControlsEnabled: enableControls,
});

initAnimatedWebpEncoder().catch(() => {
  webpEncoderAvailable = false;
  publishViewerCommand({
    webpDisabled: true,
    webpTitle: 'WebP WASM failed to load',
  });
});

const unsetViewerCommandActions = setViewerCommandActions({
  loadFiles: (files) => { void loadFilesFromUi(files); },
  dropFiles: (dataTransfer) => { void loadDroppedFiles(dataTransfer); },
  clear: clearAnimation,
  toggleImages: panelLayout.toggleImages,
  toggleSprites: panelLayout.toggleSprites,
  beginPanelResize: panelLayout.beginResize,
  resizePanel: panelLayout.resize,
  endPanelResize: panelLayout.endResize,
  resizeViewport,
  resetZoom: stageInteraction.resetZoom,
  zoomIn: stageInteraction.zoomIn,
  zoomOut: stageInteraction.zoomOut,
  exportPng: exportActions.exportPng,
  exportApng: exportActions.exportApng,
  exportWebp: exportActions.exportWebp,
  exportFla: () => { void exportActions.exportFla(); },
  convertJson: () => { void exportActions.convertJson(); },
  convertYaml: exportActions.convertYaml,
  convertToml: exportActions.convertToml,
  convertPam: () => { void exportActions.convertPam(); },
  cancelExport: exportActions.cancelExport,
});

const unsetViewerStageActions = setViewerStageActions({
  wheel: stageInteraction.wheel,
  pointerDown: stageInteraction.pointerDown,
  pointerMove: stageInteraction.pointerMove,
  pointerLeave: stageInteraction.pointerLeave,
  pointerUp: stageInteraction.pointerUp,
});

const unsetViewerFormActions = setViewerFormActions({
  selectSprite: (value) => activateSprite(value === 'main' ? -1 : parseInt(value, 10)),
  selectLabel: selectLabelValue,
  selectPlantLayer: specialLayers.selectPlantLayer,
  selectZombieState: specialLayers.selectZombieState,
  setGroundSwatch: specialLayers.setGroundSwatch,
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
function getBaseFrameRate(): number {
  return getBaseFrameRateFor(animation, activeSprite);
}

function getMatchingSpeedPresetValue(): string {
  return getMatchingSpeedPresetValueFor(speedValue, getBaseFrameRate());
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
  panelLayout.publish();
  renderEmptyAnimationState();
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
  playback.stop();
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
