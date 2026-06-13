import { Application, Rectangle } from 'pixi.js';
import * as jsYamlMod from 'js-yaml';
import * as smolTomlMod from 'smol-toml';
import { parseImageFileName, parseSpriteFrameLabels } from '../domain/model';
import { computeAnimationBounds } from '../domain/timeline';
import { encodePAM } from '../formats/pam/encoder';
import { toRawJson } from '../formats/pam/serializer';
import { loadPamCodecWasm } from '../formats/pam/wasm';
import { exportFLA } from '../formats/fla/exporter';
import { t, getLang, setLang, onLangChange, getAvailableLangs, getLangLabel } from '../localization/i18n';
import { renderFrameToPixiContainer, createBoundaryOverlay, resetPixiRenderer } from '../rendering/pixi-renderer';
import { collectFilesFromDataTransfer, readDirectoryHandle } from './files';
import { buildLoadedAnimation, type LoadedAnimation } from './load-animation';
import { getSpecialLayerIndices } from './special-layers';
import { downloadBlob, stripKnownAnimationExtension } from '../export/download';
import { encodeApng } from '../export/apng';
import { encodeAnimatedWebp, initAnimatedWebpEncoder } from '../export/animated-webp';
import type { Animation, TimelinesMap } from '../domain/types';

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

function parseExportDimension(input: HTMLInputElement, fallback: number): number {
  const parsed = parseInt(input.value, 10);
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

systemDarkMedia.addEventListener('change', () => {
  if (themePreference === 'system') applyThemePreference(themePreference);
});

function loadSettings(): void {
  const s = readSettings();
  if (!s) return;
  if (typeof s.loop === 'boolean') loopCheck.checked = s.loop;
  if (typeof s.autoPlay === 'boolean') autoplayCheck.checked = s.autoPlay;
  if (typeof s.boundary === 'boolean') boundaryCheck.checked = s.boundary;
  if (typeof s.reverse === 'boolean') reverseCheck.checked = s.reverse;
  if (typeof s.keepSpeed === 'boolean') keepSpeedCheck.checked = s.keepSpeed;
  if (isPositiveNumericString(s.speedValue)) speedInput.value = s.speedValue;
  if (typeof s.sizeScale === 'string' && ['custom', '1', '2', '3', '4'].includes(s.sizeScale)) {
    sizeScaleSelect.value = s.sizeScale;
  }
  if (isPositiveNumber(s.imagePanelWidth)) setPanelWidth(panelImages, s.imagePanelWidth);
  if (isPositiveNumber(s.spritePanelWidth)) setPanelWidth(panelSprites, s.spritePanelWidth);
  if (typeof s.showImages === 'boolean') setPanelVisible('images', s.showImages);
  if (typeof s.showSprites === 'boolean') setPanelVisible('sprites', s.showSprites);
  if (isThemePreference(s.theme)) {
    themePreference = s.theme;
    applyThemePreference(themePreference);
    themeSelect.value = themePreference;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      theme: themePreference,
      loop: loopCheck.checked,
      autoPlay: autoplayCheck.checked,
      boundary: boundaryCheck.checked,
      reverse: reverseCheck.checked,
      keepSpeed: keepSpeedCheck.checked,
      speedValue: speedInput.value,
      sizeScale: sizeScaleSelect.value,
      imagePanelWidth: readPanelWidth(panelImages),
      spritePanelWidth: readPanelWidth(panelSprites),
      showImages: !panelImages.classList.contains('hidden'),
      showSprites: !panelSprites.classList.contains('hidden'),
    }));
  } catch (error) {
    console.warn('Failed to save viewer settings:', error);
  }
}

// ── DOM references ──
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const btnLoad = $<HTMLButtonElement>('btn-load');
const btnClear = $<HTMLButtonElement>('btn-clear');
const animName = $<HTMLSpanElement>('anim-name');
const tabStrip = $<HTMLDivElement>('tab-strip');
const animationTabsEl = $<HTMLDivElement>('animation-tabs');
const spriteSelect = $<HTMLSelectElement>('sprite-select');
const labelSelect = $<HTMLSelectElement>('label-select');
const btnPrev = $<HTMLButtonElement>('btn-prev');
const btnPlay = $<HTMLButtonElement>('btn-play');
const btnNext = $<HTMLButtonElement>('btn-next');
const frameDisplay = $<HTMLSpanElement>('frame-display');
const frameSlider = $<HTMLInputElement>('frame-slider');
const speedInput = $<HTMLInputElement>('speed-input');
const speedPresetSelect = $<HTMLSelectElement>('speed-preset-select');
const loopCheck = $<HTMLInputElement>('loop-check');
const reverseCheck = $<HTMLInputElement>('reverse-check');
const autoplayCheck = $<HTMLInputElement>('autoplay-check');
const keepSpeedCheck = $<HTMLInputElement>('keep-speed-check');
const boundaryCheck = $<HTMLInputElement>('boundary-check');
const rangeBeginInput = $<HTMLInputElement>('range-begin');
const rangeEndInput = $<HTMLInputElement>('range-end');
const btnToggleImages = $<HTMLButtonElement>('btn-toggle-images');
const btnToggleSprites = $<HTMLButtonElement>('btn-toggle-sprites');
const btnZoomReset = $<HTMLButtonElement>('btn-zoom-reset');
const stageContainer = $<HTMLDivElement>('stage-container');
const canvas = $<HTMLCanvasElement>('stage');
const statusText = $<HTMLSpanElement>('status-text');
const coordDisplay = $<HTMLSpanElement>('coord-display');
const zoomDisplay = $<HTMLSpanElement>('zoom-display');
const panelImages = $<HTMLDivElement>('panel-images');
const panelSprites = $<HTMLDivElement>('panel-sprites');
const imageList = $<HTMLUListElement>('image-list');
const spriteList = $<HTMLUListElement>('sprite-list');
const imgRegexInput = $<HTMLInputElement>('img-regex');
const sprRegexInput = $<HTMLInputElement>('spr-regex');
const resizeHandleLeft = $<HTMLDivElement>('resize-handle-left');
const resizeHandleRight = $<HTMLDivElement>('resize-handle-right');
const plantLayerSelect = $<HTMLSelectElement>('plant-layer-select');
const zombieStateSelect = $<HTMLSelectElement>('zombie-state-select');
const groundSwatchCheck = $<HTMLInputElement>('ground-swatch-check');
const btnExportPng = $<HTMLButtonElement>('btn-export-png');
const btnExportApng = $<HTMLButtonElement>('btn-export-apng');
const btnExportWebp = $<HTMLButtonElement>('btn-export-webp');
const btnExportFla = $<HTMLButtonElement>('btn-export-fla');
const btnConvertJson = $<HTMLButtonElement>('btn-convert-json');
const btnConvertYaml = $<HTMLButtonElement>('btn-convert-yaml');
const btnConvertToml = $<HTMLButtonElement>('btn-convert-toml');
const btnConvertPam = $<HTMLButtonElement>('btn-convert-pam');
const sizeWInput = $<HTMLInputElement>('size-w');
const sizeHInput = $<HTMLInputElement>('size-h');
const sizeScaleSelect = $<HTMLSelectElement>('size-scale');
const animSizeDisplay = $<HTMLSpanElement>('anim-size-display');
const exportOverlay = $<HTMLDivElement>('export-overlay');
const exportProgress = $<HTMLProgressElement>('export-progress');
const exportStatus = $<HTMLSpanElement>('export-status');
const exportCancelBtn = $<HTMLButtonElement>('export-cancel');
const langSelect = $<HTMLSelectElement>('lang-select');
const themeSelect = $<HTMLSelectElement>('theme-select');
const dropHint = $<HTMLDivElement>('drop-hint');

const styledSelects = [
  spriteSelect,
  labelSelect,
  plantLayerSelect,
  zombieStateSelect,
  speedPresetSelect,
  sizeScaleSelect,
  langSelect,
  themeSelect,
];

const selectMenu = document.createElement('div');
selectMenu.id = 'select-menu';
selectMenu.className = 'select-menu hidden';
document.body.appendChild(selectMenu);

let openSelect: HTMLSelectElement | null = null;

function updateSelectControlValue(select: HTMLSelectElement): void {
  const control = select.closest<HTMLElement>('.select-control');
  const valueEl = control?.querySelector<HTMLElement>('.select-control-value');
  if (!control || !valueEl) return;

  const text = select.selectedOptions[0]?.textContent?.trim() ?? '';
  valueEl.textContent = text || '\u00a0';
  valueEl.title = text;
  control.classList.toggle('is-empty', text.length === 0);
  control.classList.toggle('is-disabled', select.disabled);
  control.tabIndex = select.disabled ? -1 : 0;
  control.setAttribute('role', 'button');
  control.setAttribute('aria-haspopup', 'listbox');
  control.setAttribute(
    'aria-expanded',
    String(openSelect === select && !selectMenu.classList.contains('hidden')),
  );
}

function hideSelectMenu(): void {
  if (openSelect) {
    openSelect.closest<HTMLElement>('.select-control')?.classList.remove('is-open');
    updateSelectControlValue(openSelect);
  }
  openSelect = null;
  selectMenu.classList.add('hidden');
}

function buildSelectMenu(select: HTMLSelectElement): void {
  selectMenu.innerHTML = '';
  for (const option of Array.from(select.options)) {
    if (option.hidden) continue;
    const button = document.createElement('button');
    button.type = 'button';
    const text = option.textContent?.trim() || '\u00a0';
    button.textContent = text;
    button.title = text.trim();
    button.classList.toggle('active', option.selected);
    button.disabled = option.disabled;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (option.disabled) return;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      updateSelectControlValue(select);
      hideSelectMenu();
      select.closest<HTMLElement>('.select-control')?.focus();
    });
    selectMenu.appendChild(button);
  }
}

function positionSelectMenu(): void {
  if (!openSelect) return;
  const control = openSelect.closest<HTMLElement>('.select-control');
  if (!control) return;

  const viewportPadding = 8;
  const menuGap = 6;
  const controlRect = control.getBoundingClientRect();
  const menuMinWidth = Math.max(138, Math.round(controlRect.width));
  selectMenu.style.setProperty('--select-menu-min-width', `${menuMinWidth}px`);
  selectMenu.style.setProperty(
    '--select-menu-max-height',
    `${Math.max(96, window.innerHeight - viewportPadding * 2)}px`,
  );
  selectMenu.style.removeProperty('--select-menu-width');

  const optionWidth = Math.max(
    menuMinWidth,
    ...Array.from(selectMenu.querySelectorAll('button')).map(button => button.scrollWidth + 10),
  );
  const menuWidth = Math.min(
    Math.ceil(optionWidth),
    window.innerWidth - viewportPadding * 2,
  );
  selectMenu.style.setProperty('--select-menu-width', `${menuWidth}px`);

  const menuRect = selectMenu.getBoundingClientRect();
  const menuHeight = menuRect.height || 0;
  const maxLeft = window.innerWidth - viewportPadding - menuWidth;
  const left = Math.max(viewportPadding, Math.min(controlRect.left, maxLeft));

  const belowTop = controlRect.bottom + menuGap;
  const aboveTop = controlRect.top - menuGap - menuHeight;
  const hasMoreSpaceAbove =
    controlRect.top - viewportPadding > window.innerHeight - controlRect.bottom - viewportPadding;
  const top =
    belowTop + menuHeight <= window.innerHeight - viewportPadding || !hasMoreSpaceAbove
      ? Math.min(belowTop, window.innerHeight - viewportPadding - menuHeight)
      : aboveTop;

  selectMenu.style.setProperty('--select-menu-left', `${Math.round(left)}px`);
  selectMenu.style.setProperty(
    '--select-menu-top',
    `${Math.round(Math.max(viewportPadding, top))}px`,
  );
}

function showSelectMenu(select: HTMLSelectElement): void {
  if (select.disabled || select.options.length === 0) return;
  hideSelectMenu();
  openSelect = select;
  buildSelectMenu(select);
  selectMenu.classList.remove('hidden');
  select.closest<HTMLElement>('.select-control')?.classList.add('is-open');
  updateSelectControlValue(select);
  positionSelectMenu();
}

function toggleSelectMenu(select: HTMLSelectElement): void {
  if (openSelect === select && !selectMenu.classList.contains('hidden')) {
    hideSelectMenu();
  } else {
    showSelectMenu(select);
  }
}

function setupSelectControls(): void {
  for (const select of styledSelects) {
    const control = select.closest<HTMLElement>('.select-control');
    if (!control) continue;

    let valueEl = control.querySelector<HTMLElement>('.select-control-value');
    if (!valueEl) {
      valueEl = document.createElement('span');
      valueEl.className = 'select-control-value';
      control.insertBefore(valueEl, select);
    }

    select.tabIndex = -1;
    select.addEventListener('change', () => updateSelectControlValue(select));
    control.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleSelectMenu(select);
    });
    control.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        showSelectMenu(select);
      } else if (event.key === 'Escape') {
        hideSelectMenu();
      }
    });
    new MutationObserver(() => updateSelectControlValue(select)).observe(select, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
    updateSelectControlValue(select);
  }
}

function updateSelectControlValues(): void {
  styledSelects.forEach(updateSelectControlValue);
}

setupSelectControls();

document.addEventListener('click', (event) => {
  const target = event.target as Node;
  if (!selectMenu.contains(target) && !openSelect?.closest('.select-control')?.contains(target)) {
    hideSelectMenu();
  }
});
window.addEventListener('resize', positionSelectMenu);
window.addEventListener('scroll', positionSelectMenu, true);

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
let lastTimestamp = 0;
let accumulator = 0;
let rafId: number | null = null;

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

function getCurrentExportSize(): ExportSize {
  const fallback = animation ? getPresetExportSize(animation) : { width: 1, height: 1 };
  return {
    width: parseExportDimension(sizeWInput, fallback.width),
    height: parseExportDimension(sizeHInput, fallback.height),
  };
}

function setExportSizeInputs(size: ExportSize): void {
  sizeWInput.value = String(Math.max(1, Math.round(size.width)));
  sizeHInput.value = String(Math.max(1, Math.round(size.height)));
}

function setExportSizeScaleValue(size: ExportSize): void {
  sizeScaleSelect.value = getExportScaleValueFor(size);
  updateSelectControlValue(sizeScaleSelect);
}

function setExportSizeFromScale(scaleValue: string): void {
  if (!animation || scaleValue === 'custom') return;
  const scale = parseInt(scaleValue, 10);
  if (!Number.isFinite(scale) || scale <= 0) return;
  setExportSizeInputs({
    width: Math.round(animation.size[0] * scale),
    height: Math.round(animation.size[1] * scale),
  });
  updateSizeDisplay();
}

// Filters
let imageFilter: boolean[] = [];
let spriteFilter: boolean[] = [];

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
    currentFrame: reverseCheck.checked ? frameRange.end : frameRange.begin,
    zoom: 1.0,
    panX: presetPan.x,
    panY: presetPan.y,
    imageFilter: loadedAnimation.animation.image.map(() => true),
    spriteFilter,
    plantCustomLayers,
    zombieStateLayers,
    groundSwatchLayers,
    speedValue: keepSpeedCheck.checked ? (getStoredSpeedValue() ?? speedInput.value) : nativeSpeed,
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
  tab.speedValue = speedInput.value;
  tab.sizeScale = sizeScaleSelect.value;
  tab.exportSize = getCurrentExportSize();
  tab.imageRegex = imgRegexInput.value;
  tab.spriteRegex = sprRegexInput.value;
  tab.labelValue = labelSelect.value || 'all';
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
  plantCustomLayers = tab.plantCustomLayers;
  zombieStateLayers = tab.zombieStateLayers;
  groundSwatchLayers = tab.groundSwatchLayers;
  refreshStageViewBounds();
}

function renderTabs(): void {
  animationTabsEl.innerHTML = '';
  for (const tab of tabStates) {
    const tabItem = document.createElement('div');
    tabItem.className = 'animation-tab';
    tabItem.classList.toggle('active', tab.id === activeTabId);

    const tabButton = document.createElement('button');
    tabButton.type = 'button';
    tabButton.className = 'animation-tab-main';
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-selected', tab.id === activeTabId ? 'true' : 'false');
    tabButton.title = t('tab.switch.title', { name: tab.displayName });
    tabButton.addEventListener('click', () => activateAnimationTab(tab.id));

    const name = document.createElement('span');
    name.className = 'animation-tab-name';
    name.textContent = tab.displayName;
    tabButton.appendChild(name);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'animation-tab-close';
    close.textContent = '\u00d7';
    close.title = t('tab.close.title');
    close.setAttribute('aria-label', t('tab.close.title'));
    close.addEventListener('click', ev => {
      ev.stopPropagation();
      closeAnimationTab(tab.id);
    });

    tabItem.appendChild(tabButton);
    tabItem.appendChild(close);
    animationTabsEl.appendChild(tabItem);
  }
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
  plantCustomLayers = [];
  zombieStateLayers = [];
  groundSwatchLayers = [];
  zoom = 1.0;
  panX = 0;
  panY = 0;
  stageViewBounds = null;
  updateZoomDisplay();
  sizeWInput.value = '0';
  sizeHInput.value = '0';
  sizeScaleSelect.value = getStoredSizeScale();
  updateSizeDisplay();

  animName.textContent = t('anim.unloaded');
  spriteSelect.innerHTML = '';
  spriteSelect.disabled = true;
  labelSelect.innerHTML = '';
  labelSelect.disabled = true;
  imageList.innerHTML = '';
  spriteList.innerHTML = '';
  imgRegexInput.value = '';
  sprRegexInput.value = '';
  plantLayerSelect.innerHTML = '';
  plantLayerSelect.disabled = true;
  zombieStateSelect.innerHTML = '';
  zombieStateSelect.disabled = true;
  groundSwatchCheck.checked = false;
  groundSwatchCheck.disabled = true;
  enableControls(false);
  frameSlider.disabled = true;
  frameSlider.value = '0';
  frameSlider.max = '0';
  speedInput.disabled = true;
  speedPresetSelect.disabled = true;
  rangeBeginInput.disabled = true;
  rangeEndInput.disabled = true;
  btnClear.disabled = true;
  frameDisplay.textContent = '0 / 0';
  statusText.textContent = t('status.hint');
  updateSelectControlValues();

  if (pixiApp) {
    pixiApp.stage.removeChildren();
    resetPixiRenderer();
    resizeCanvas();
  }
  dropHint.classList.remove('hidden');
  renderTabs();
}

function findLabelValueForRange(): string {
  if (!activeSprite) return 'all';
  if (frameRange.begin === 0 && frameRange.end === activeSprite.frame.length - 1) return 'all';
  const rangeValue = JSON.stringify(frameRange);
  return Array.from(labelSelect.options).some(opt => opt.value === rangeValue) ? rangeValue : 'all';
}

function renderActiveTabState(startPlayback = false): void {
  const tab = getActiveTab();
  if (!tab || !animation) {
    renderEmptyAnimationState();
    return;
  }

  animName.textContent = tab.displayName;
  updateZoomDisplay();
  populateSpriteSelect();
  spriteSelect.value = activeSpriteIndex === -1 ? 'main' : String(activeSpriteIndex);

  if (activeSprite && activeSprite.frame.length > 0) {
    frameLabels = parseSpriteFrameLabels(activeSprite);
    populateLabelSelect();
    const labelValue = Array.from(labelSelect.options).some(opt => opt.value === tab.labelValue)
      ? tab.labelValue
      : findLabelValueForRange();
    labelSelect.value = labelValue;
    enableControls(true);
    speedInput.disabled = false;
    speedPresetSelect.disabled = false;
    updateSliderRange();
    updateRangeInputs();
    updateFrameDisplay();
  } else {
    labelSelect.innerHTML = '';
    labelSelect.disabled = true;
    enableControls(false);
    frameSlider.disabled = true;
    rangeBeginInput.disabled = true;
    rangeEndInput.disabled = true;
    speedInput.disabled = true;
    speedPresetSelect.disabled = true;
    frameDisplay.textContent = '0 / 0';
  }

  speedInput.value = tab.speedValue;
  updateSpeedPresetTrigger();
  setExportSizeInputs(tab.exportSize);
  sizeScaleSelect.value = tab.sizeScale;
  setExportSizeScaleValue(tab.exportSize);
  updateSizeDisplay();
  updateSelectControlValues();

  populateImagePanel();
  populateSpritePanel();
  imgRegexInput.value = tab.imageRegex;
  sprRegexInput.value = tab.spriteRegex;
  applyRegexFilter(imgRegexInput, imageList);
  applyRegexFilter(sprRegexInput, spriteList);
  renderSpecialLayerControls();
  highlightActiveSpriteInPanel();

  btnClear.disabled = false;
  statusText.textContent = t('status.loaded', {
    name: tab.displayName,
    images: String(animation.image.length),
    loaded: String(tab.loaded),
    sprites: String(animation.sprite.length),
  });
  dropHint.classList.add('hidden');
  renderTabs();
  resizeCanvas();
  if (startPlayback && activeSprite && autoplayCheck.checked) play();
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

// ── i18n setup ──
function applyI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n!);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle!);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach(el => {
    (el as HTMLInputElement).placeholder = t(el.dataset.i18nPlaceholder!);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-text]').forEach(el => {
    const first = el.firstChild;
    const text = t(el.dataset.i18nText!);
    if (first && first.nodeType === Node.TEXT_NODE) {
      first.textContent = text + '\n        ';
    }
  });
  if (!animation) animName.textContent = t('anim.unloaded');
}

for (const lang of getAvailableLangs()) {
  const opt = document.createElement('option');
  opt.value = lang;
  opt.textContent = getLangLabel(lang);
  langSelect.appendChild(opt);
}
langSelect.value = getLang();
langSelect.addEventListener('change', () => setLang(langSelect.value));
themeSelect.value = themePreference;
updateSelectControlValues();
themeSelect.addEventListener('change', () => {
  if (!isThemePreference(themeSelect.value)) return;
  themePreference = themeSelect.value;
  applyThemePreference(themePreference);
  saveSettings();
});

onLangChange(() => {
  applyI18n();
  langSelect.value = getLang();
  themeSelect.value = themePreference;
  updateSelectControlValues();
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
window.addEventListener('resize', resizeCanvas);
window.addEventListener('resize', syncTabStripPanelOffsets);

// ── Hidden file input for fallback directory picking ──
const fileInput = document.createElement('input');
fileInput.type = 'file';
(fileInput as any).webkitdirectory = true;
fileInput.multiple = true;
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

// ── Drop zone ──
stageContainer.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  stageContainer.classList.add('drag-over');
});
stageContainer.addEventListener('dragleave', (e) => {
  e.preventDefault();
  stageContainer.classList.remove('drag-over');
});
stageContainer.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  stageContainer.classList.remove('drag-over');
  try {
    const files = await collectFilesFromDataTransfer(e.dataTransfer!);
    if (files.length === 0) { statusText.textContent = t('status.noFiles'); return; }
    await loadFromFiles(files);
  } catch (err: any) {
    statusText.textContent = t('status.error', { message: err.message });
    console.error(err);
  }
});

// ── Button click loading ──
btnLoad.addEventListener('click', async () => {
  if (typeof (window as any).showDirectoryPicker === 'function') {
    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      const files = await readDirectoryHandle(dirHandle);
      await loadFromFiles(files);
      return;
    } catch (e: any) {
      if (e.name === 'AbortError') return;
    }
  }
  fileInput.value = '';
  fileInput.click();
});

fileInput.addEventListener('change', async () => {
  if (!fileInput.files || fileInput.files.length === 0) return;
  try {
    await loadFromFiles(Array.from(fileInput.files));
  } catch (e: any) {
    statusText.textContent = t('status.error', { message: e.message });
    console.error(e);
  }
});

async function loadFromFiles(files: File[]): Promise<void> {
  statusText.textContent = t('status.loading');
  saveActiveTabState();
  stop();

  const loadedAnimation = await buildLoadedAnimation(files);
  if (!loadedAnimation) {
    statusText.textContent = t('status.noPam');
    return;
  }

  const tab = createAnimationTab(loadedAnimation);
  tabStates.push(tab);
  activateAnimationTab(tab.id, true);
}

// ── Clear ──
btnClear.addEventListener('click', () => {
  if (activeTabId === null) {
    renderEmptyAnimationState();
    return;
  }
  closeAnimationTab(activeTabId);
});

// ── Sprite selection ──
function populateSpriteSelect(): void {
  spriteSelect.innerHTML = '';
  if (animation!.mainSprite) {
    const opt = document.createElement('option');
    opt.value = 'main';
    opt.textContent = `MainSprite (${animation!.mainSprite.frame.length} frames)`;
    spriteSelect.appendChild(opt);
  }
  animation!.sprite.forEach((sp, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${sp.name || 'sprite_' + i} (${sp.frame.length}f)`;
    spriteSelect.appendChild(opt);
  });
  spriteSelect.disabled = spriteSelect.options.length === 0;
}

spriteSelect.addEventListener('change', () => {
  const val = spriteSelect.value;
  activateSprite(val === 'main' ? -1 : parseInt(val, 10));
});

function activateSprite(index: number): void {
  stop();
  activeSpriteIndex = index;
  activeSprite = index === -1 ? animation!.mainSprite : animation!.sprite[index];
  if (!activeSprite || activeSprite.frame.length === 0) return;

  frameLabels = parseSpriteFrameLabels(activeSprite);
  frameRange = { begin: 0, end: activeSprite.frame.length - 1 };
  currentFrame = reverseCheck.checked ? frameRange.end : frameRange.begin;

  populateLabelSelect();
  enableControls(true);
  if (!keepSpeedCheck.checked) {
    speedInput.value = String((activeSprite as any).frameRate ?? animation!.frameRate);
  }
  updateSpeedPresetTrigger();
  updateSliderRange();
  updateRangeInputs();
  updateFrameDisplay();
  highlightActiveSpriteInPanel();
  drawCurrentFrame();

  if (autoplayCheck.checked) play();
}

// ── Label selection ──
function populateLabelSelect(): void {
  labelSelect.innerHTML = `<option value="all">${t('label.allFrames')}</option>`;
  for (const label of frameLabels) {
    const opt = document.createElement('option');
    opt.value = JSON.stringify({ begin: label.begin, end: label.end });
    opt.textContent = `${label.name} [${label.begin}\u2013${label.end}]`;
    labelSelect.appendChild(opt);
  }
  labelSelect.disabled = false;
}

labelSelect.addEventListener('change', () => {
  stop();
  if (labelSelect.value === 'all') {
    frameRange = { begin: 0, end: activeSprite!.frame.length - 1 };
  } else {
    frameRange = JSON.parse(labelSelect.value);
  }
  currentFrame = reverseCheck.checked ? frameRange.end : frameRange.begin;
  updateSliderRange();
  updateRangeInputs();
  updateFrameDisplay();
  drawCurrentFrame();
});

// ── Frame slider ──
let wasPlayingBeforeSlider = false;

function updateSliderRange(): void {
  frameSlider.min = String(frameRange.begin);
  frameSlider.max = String(frameRange.end);
  frameSlider.value = String(currentFrame);
  frameSlider.disabled = !activeSprite;
}

function updateRangeInputs(): void {
  const maxFrame = activeSprite ? activeSprite.frame.length - 1 : 0;
  rangeBeginInput.max = String(maxFrame);
  rangeEndInput.max = String(maxFrame);
  rangeBeginInput.value = String(frameRange.begin);
  rangeEndInput.value = String(frameRange.end);
  rangeBeginInput.disabled = !activeSprite;
  rangeEndInput.disabled = !activeSprite;
}

rangeBeginInput.addEventListener('change', () => {
  const v = Math.max(0, Math.min(parseInt(rangeBeginInput.value, 10) || 0, frameRange.end));
  frameRange.begin = v;
  rangeBeginInput.value = String(v);
  if (currentFrame < v) currentFrame = v;
  updateSliderRange();
  updateFrameDisplay();
  drawCurrentFrame();
});

rangeEndInput.addEventListener('change', () => {
  const maxFrame = activeSprite ? activeSprite.frame.length - 1 : 0;
  const v = Math.max(frameRange.begin, Math.min(parseInt(rangeEndInput.value, 10) || 0, maxFrame));
  frameRange.end = v;
  rangeEndInput.value = String(v);
  if (currentFrame > v) currentFrame = v;
  updateSliderRange();
  updateFrameDisplay();
  drawCurrentFrame();
});

frameSlider.addEventListener('pointerdown', () => {
  wasPlayingBeforeSlider = playing;
  if (playing) stop();
});

frameSlider.addEventListener('input', () => {
  currentFrame = parseInt(frameSlider.value, 10);
  updateFrameDisplay();
  drawCurrentFrame();
});

frameSlider.addEventListener('pointerup', () => {
  if (wasPlayingBeforeSlider) play();
});

// ── Playback controls ──
function enableControls(enabled: boolean): void {
  btnPrev.disabled = !enabled;
  btnPlay.disabled = !enabled;
  btnNext.disabled = !enabled;
  btnExportPng.disabled = !enabled;
  btnExportApng.disabled = !enabled;
  btnExportWebp.disabled = !enabled;
  btnExportFla.disabled = !enabled;
  btnConvertJson.disabled = !enabled;
  btnConvertYaml.disabled = !enabled;
  btnConvertToml.disabled = !enabled;
  btnConvertPam.disabled = !enabled;
  sizeScaleSelect.disabled = !enabled;
  syncSizeEditability();
}

function syncSizeEditability(): void {
  const hasEditableAnimation = Boolean(animation);
  sizeWInput.disabled = !hasEditableAnimation;
  sizeHInput.disabled = !hasEditableAnimation;
  sizeWInput.readOnly = false;
  sizeHInput.readOnly = false;
}

btnPlay.addEventListener('click', () => {
  if (playing) stop(); else play();
});

btnPrev.addEventListener('click', () => {
  stop();
  currentFrame = currentFrame <= frameRange.begin ? frameRange.end : currentFrame - 1;
  updateFrameDisplay();
  drawCurrentFrame();
});

btnNext.addEventListener('click', () => {
  stop();
  currentFrame = currentFrame >= frameRange.end ? frameRange.begin : currentFrame + 1;
  updateFrameDisplay();
  drawCurrentFrame();
});

function play(): void {
  if (!activeSprite) return;
  playing = true;
  btnPlay.textContent = '\u23F8';
  lastTimestamp = performance.now();
  accumulator = 0;
  tick(lastTimestamp);
}

function stop(): void {
  playing = false;
  btnPlay.textContent = '\u25B6';
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function tick(timestamp: number): void {
  if (!playing) return;
  const fps = parseFloat(speedInput.value) || 30;
  const frameDuration = 1000 / fps;
  const delta = timestamp - lastTimestamp;
  lastTimestamp = timestamp;
  accumulator += delta;

  const reverse = reverseCheck.checked;
  let advanced = false;
  while (accumulator >= frameDuration) {
    accumulator -= frameDuration;
    currentFrame += reverse ? -1 : 1;
    if (!reverse && currentFrame > frameRange.end) {
      if (loopCheck.checked) {
        currentFrame = frameRange.begin;
      } else {
        currentFrame = frameRange.end;
        stop(); updateFrameDisplay(); drawCurrentFrame(); return;
      }
    } else if (reverse && currentFrame < frameRange.begin) {
      if (loopCheck.checked) {
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
    frameDisplay.textContent = '0 / 0';
    frameSlider.value = '0';
    return;
  }
  frameDisplay.textContent = `${currentFrame} / ${total - 1}`;
  frameSlider.value = String(currentFrame);
}

// ── Zoom / Pan ──
function updateZoomDisplay(): void {
  zoomDisplay.textContent = Math.round(zoom * 100) + '%';
}

function updateSizeDisplay(): void {
  if (!animation) {
    animSizeDisplay.textContent = '';
    return;
  }
  const { width: w, height: h } = getCurrentExportSize();
  animSizeDisplay.textContent = `${w}\u00d7${h}`;
}

function updateCoordDisplay(e: PointerEvent | MouseEvent): void {
  if (!animation) { coordDisplay.textContent = ''; return; }
  const point = getCanvasBitmapPoint(e.clientX, e.clientY);
  const cx = canvas.width / 2 + panX * stageRenderScale;
  const cy = canvas.height / 2 + panY * stageRenderScale;
  const sx = (point.x - cx) / (zoom * stageRenderScale) + animation.position[0];
  const sy = (point.y - cy) / (zoom * stageRenderScale) + animation.position[1];
  coordDisplay.textContent = `${Math.round(sx)}, ${Math.round(sy)}`;
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!animation) return;
  const point = getCanvasBitmapPoint(e.clientX, e.clientY);
  const cx = canvas.width / 2 + panX * stageRenderScale;
  const cy = canvas.height / 2 + panY * stageRenderScale;
  const ax = (point.x - cx) / (zoom * stageRenderScale) + animation.position[0];
  const ay = (point.y - cy) / (zoom * stageRenderScale) + animation.position[1];

  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  zoom = Math.max(0.05, Math.min(100, zoom * factor));

  panX = (point.x - canvas.width / 2) / stageRenderScale -
    (ax - animation.position[0]) * zoom;
  panY = (point.y - canvas.height / 2) / stageRenderScale -
    (ay - animation.position[1]) * zoom;

  updateZoomDisplay();
  drawCurrentFrame();
}, { passive: false });

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
  if (!animation || !boundaryCheck.checked) return null;
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

canvas.addEventListener('pointerdown', (e) => {
  const edge = hitTestBoundaryEdge(e.clientX, e.clientY);
  if (edge && e.button === 0) {
    boundaryDragEdge = edge;
    boundaryDragStart = {
      mx: e.clientX, my: e.clientY,
      origW: animation!.size[0], origH: animation!.size[1],
      origPosX: animation!.position[0], origPosY: animation!.position[1],
      origPanX: panX, origPanY: panY,
      exportScale: sizeScaleSelect.value,
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }

  if (e.button === 0 || e.button === 1) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
});

canvas.addEventListener('pointermove', (e) => {
  updateCoordDisplay(e);

  if (boundaryDragEdge && boundaryDragStart) {
    const dx = (e.clientX - boundaryDragStart.mx) / (zoom * stageFitScale);
    const dy = (e.clientY - boundaryDragStart.my) / (zoom * stageFitScale);
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
    const edge = hitTestBoundaryEdge(e.clientX, e.clientY);
    canvas.style.cursor = edge ? EDGE_CURSORS[edge] : '';
  }

  if (!isPanning) return;
  panX = panOriginX + (e.clientX - panStartX) / stageFitScale;
  panY = panOriginY + (e.clientY - panStartY) / stageFitScale;
  drawCurrentFrame();
});

canvas.addEventListener('pointerleave', () => {
  coordDisplay.textContent = '';
  if (!boundaryDragEdge) canvas.style.cursor = '';
});

canvas.addEventListener('pointerup', (e) => {
  if (boundaryDragEdge) {
    boundaryDragEdge = null;
    boundaryDragStart = null;
    canvas.releasePointerCapture(e.pointerId);
    canvas.style.cursor = '';
    return;
  }
  if (isPanning) {
    isPanning = false;
    canvas.releasePointerCapture(e.pointerId);
  }
});

btnZoomReset.addEventListener('click', () => {
  zoom = 1.0;
  resetPanToStageView();
  updateZoomDisplay();
  drawCurrentFrame();
});

// ── Filter panels ──
function populateImagePanel(): void {
  imageList.innerHTML = '';
  animation!.image.forEach((img, i) => {
    const li = document.createElement('li');
    li.dataset.filterName = parseImageFileName(img.name).toLowerCase();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = imageFilter[i] ?? true;
    cb.addEventListener('change', () => {
      imageFilter[i] = cb.checked;
      drawCurrentFrame();
    });
    const tex = textures.get(img.name);
    if (tex) {
      const thumb = document.createElement('img');
      thumb.className = 'item-thumb';
      thumb.src = tex.src;
      thumb.alt = '';
      li.appendChild(thumb);
    }
    li.appendChild(cb);
    const label = document.createElement('span');
    label.className = 'item-label';
    label.textContent = parseImageFileName(img.name);
    label.title = img.name;
    li.appendChild(label);
    if (img.size) {
      const sz = document.createElement('span');
      sz.className = 'item-size';
      sz.textContent = img.size.width + '\u00d7' + img.size.height;
      li.appendChild(sz);
    }
    imageList.appendChild(li);
  });
}

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

function populateSpritePanel(): void {
  spriteList.innerHTML = '';
  animation!.sprite.forEach((sp, i) => {
    const li = document.createElement('li');
    li.dataset.spriteIndex = String(i);
    li.dataset.filterName = (sp.name || 'sprite_' + i).toLowerCase();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = spriteFilter[i] ?? true;
    cb.addEventListener('change', () => {
      spriteFilter[i] = cb.checked;
      syncSpecialLayerUI();
      drawCurrentFrame();
    });
    const thumbTex = getSpriteThumbTexture(sp);
    if (thumbTex) {
      const thumb = document.createElement('img');
      thumb.className = 'item-thumb';
      thumb.src = thumbTex.src;
      thumb.alt = '';
      li.appendChild(thumb);
    }
    li.appendChild(cb);
    const label = document.createElement('span');
    label.className = 'item-label';
    label.textContent = sp.name || 'sprite_' + i;
    const info = document.createElement('span');
    info.className = 'item-size';
    info.textContent = sp.frame.length + 'f';
    const btn = document.createElement('button');
    btn.className = 'btn-activate';
    btn.textContent = '\u25B6';
    btn.title = t('sprite.activate.title');
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      spriteSelect.value = String(i);
      activateSprite(i);
    });
    li.appendChild(label);
    li.appendChild(info);
    li.appendChild(btn);
    spriteList.appendChild(li);
  });
  if (animation!.mainSprite) {
    const li = document.createElement('li');
    li.dataset.spriteIndex = 'main';
    li.dataset.filterName = 'mainsprite';
    const spacer = document.createElement('span');
    spacer.style.width = '18px';
    spacer.style.display = 'inline-block';
    const label = document.createElement('span');
    label.className = 'item-label';
    label.textContent = 'MainSprite';
    const info = document.createElement('span');
    info.className = 'item-size';
    info.textContent = animation!.mainSprite.frame.length + 'f';
    const btn = document.createElement('button');
    btn.className = 'btn-activate';
    btn.textContent = '\u25B6';
    btn.title = t('sprite.activateMain.title');
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      spriteSelect.value = 'main';
      activateSprite(-1);
    });
    li.appendChild(spacer);
    li.appendChild(label);
    li.appendChild(info);
    li.appendChild(btn);
    spriteList.appendChild(li);
  }
}

function highlightActiveSpriteInPanel(): void {
  const key = activeSpriteIndex === -1 ? 'main' : String(activeSpriteIndex);
  for (const li of Array.from(spriteList.children) as HTMLElement[]) {
    li.classList.toggle('active-sprite', li.dataset.spriteIndex === key);
  }
}

// Image filter: select all / none
document.getElementById('btn-img-all')!.addEventListener('click', () => {
  imageFilter.fill(true);
  for (const li of Array.from(imageList.children)) li.querySelector('input')!.checked = true;
  drawCurrentFrame();
});
document.getElementById('btn-img-none')!.addEventListener('click', () => {
  imageFilter.fill(false);
  for (const li of Array.from(imageList.children)) li.querySelector('input')!.checked = false;
  drawCurrentFrame();
});

// Sprite filter: select all / none
document.getElementById('btn-spr-all')!.addEventListener('click', () => {
  spriteFilter.fill(true);
  for (const li of Array.from(spriteList.children)) {
    const cb = li.querySelector('input');
    if (cb) (cb as HTMLInputElement).checked = true;
  }
  syncSpecialLayerUI();
  drawCurrentFrame();
});
document.getElementById('btn-spr-none')!.addEventListener('click', () => {
  spriteFilter.fill(false);
  for (const li of Array.from(spriteList.children)) {
    const cb = li.querySelector('input');
    if (cb) (cb as HTMLInputElement).checked = false;
  }
  syncSpecialLayerUI();
  drawCurrentFrame();
});

// ── Special Layer Detection & Controls ──

function renderSpecialLayerControls(): void {
  plantLayerSelect.innerHTML = '';
  if (plantCustomLayers.length > 0) {
    for (const idx of plantCustomLayers) {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = animation!.sprite[idx].name!.substring(7);
      plantLayerSelect.appendChild(opt);
    }
    const noneOpt = document.createElement('option');
    noneOpt.value = 'none';
    noneOpt.textContent = 'none';
    plantLayerSelect.appendChild(noneOpt);
    plantLayerSelect.value = 'none';
    plantLayerSelect.disabled = false;
  } else {
    plantLayerSelect.disabled = true;
  }

  zombieStateSelect.innerHTML = '';
  if (zombieStateLayers.length > 0) {
    for (const idx of zombieStateLayers) {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = animation!.sprite[idx].name!;
      zombieStateSelect.appendChild(opt);
    }
    const noneOpt = document.createElement('option');
    noneOpt.value = 'none';
    noneOpt.textContent = 'none';
    zombieStateSelect.appendChild(noneOpt);
    zombieStateSelect.value = 'none';
    zombieStateSelect.disabled = false;
  } else {
    zombieStateSelect.disabled = true;
  }

  if (groundSwatchLayers.length > 0) {
    groundSwatchCheck.disabled = false;
    const anyVisible = groundSwatchLayers.some(idx => spriteFilter[idx]);
    groundSwatchCheck.checked = anyVisible;
  } else {
    groundSwatchCheck.checked = false;
    groundSwatchCheck.disabled = true;
  }
  syncSpecialLayerUI();
}

function syncSpriteCheckbox(sprIndex: number, checked: boolean): void {
  for (const li of Array.from(spriteList.children) as HTMLElement[]) {
    if (li.dataset.spriteIndex === String(sprIndex)) {
      const cb = li.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (cb) cb.checked = checked;
      break;
    }
  }
}

function applyExclusiveLayer(layerIndices: number[], selectedIdx: number): void {
  for (const idx of layerIndices) {
    const show = idx === selectedIdx;
    spriteFilter[idx] = show;
    syncSpriteCheckbox(idx, show);
  }
  drawCurrentFrame();
}

function syncSpecialLayerUI(): void {
  if (plantCustomLayers.length > 0) {
    const visible = plantCustomLayers.filter(i => spriteFilter[i]);
    if (visible.length === 0) plantLayerSelect.value = 'none';
    else if (visible.length === 1) plantLayerSelect.value = String(visible[0]);
  }
  if (zombieStateLayers.length > 0) {
    const visible = zombieStateLayers.filter(i => spriteFilter[i]);
    if (visible.length === 0) zombieStateSelect.value = 'none';
    else if (visible.length === 1) zombieStateSelect.value = String(visible[0]);
  }
  if (groundSwatchLayers.length > 0) {
    groundSwatchCheck.checked = groundSwatchLayers.some(i => spriteFilter[i]);
  }
}

plantLayerSelect.addEventListener('change', () => {
  const val = plantLayerSelect.value;
  const selectedIdx = val === 'none' ? -1 : parseInt(val, 10);
  applyExclusiveLayer(plantCustomLayers, selectedIdx);
});

zombieStateSelect.addEventListener('change', () => {
  const val = zombieStateSelect.value;
  const selectedIdx = val === 'none' ? -1 : parseInt(val, 10);
  applyExclusiveLayer(zombieStateLayers, selectedIdx);
});

groundSwatchCheck.addEventListener('change', () => {
  const show = groundSwatchCheck.checked;
  for (const idx of groundSwatchLayers) {
    spriteFilter[idx] = show;
    syncSpriteCheckbox(idx, show);
  }
  drawCurrentFrame();
});

// ── Regex filtering ──
function applyRegexFilter(input: HTMLInputElement, listEl: HTMLElement): void {
  const pattern = input.value.trim();
  if (!pattern) {
    input.classList.remove('regex-error');
    for (const li of Array.from(listEl.children) as HTMLElement[]) li.classList.remove('regex-hidden');
    return;
  }
  try {
    const re = new RegExp(pattern, 'i');
    input.classList.remove('regex-error');
    for (const li of Array.from(listEl.children) as HTMLElement[]) {
      const name = li.dataset.filterName || '';
      li.classList.toggle('regex-hidden', !re.test(name));
    }
  } catch {
    input.classList.add('regex-error');
  }
}

imgRegexInput.addEventListener('input', () => applyRegexFilter(imgRegexInput, imageList));
sprRegexInput.addEventListener('input', () => applyRegexFilter(sprRegexInput, spriteList));

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
  if (panel.classList.contains('hidden')) return 0;
  const rectWidth = panel.getBoundingClientRect().width;
  return rectWidth > 0 ? Math.round(rectWidth) : readPanelWidth(panel);
}

function syncTabStripPanelOffsets(): void {
  tabStrip.style.setProperty('--image-panel-tab-offset', `${readVisiblePanelWidth(panelImages)}px`);
  tabStrip.style.setProperty('--sprite-panel-tab-offset', `${readVisiblePanelWidth(panelSprites)}px`);
}

function initResizeHandle(handle: HTMLElement, panel: HTMLElement, side: 'left' | 'right'): void {
  let startX: number, startWidth: number;
  const onPointerMove = (e: PointerEvent) => {
    const delta = side === 'left' ? (e.clientX - startX) : (startX - e.clientX);
    const newWidth = Math.max(120, Math.min(500, startWidth + delta));
    setPanelWidth(panel, newWidth);
    requestAnimationFrame(resizeCanvas);
  };
  const onPointerUp = (e: PointerEvent) => {
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    handle.removeEventListener('pointermove', onPointerMove as EventListener);
    handle.removeEventListener('pointerup', onPointerUp as EventListener);
    saveSettings();
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = (e as PointerEvent).clientX;
    startWidth = panel.getBoundingClientRect().width;
    handle.classList.add('dragging');
    handle.setPointerCapture((e as PointerEvent).pointerId);
    handle.addEventListener('pointermove', onPointerMove as EventListener);
    handle.addEventListener('pointerup', onPointerUp as EventListener);
  });
}

initResizeHandle(resizeHandleLeft, panelImages, 'left');
initResizeHandle(resizeHandleRight, panelSprites, 'right');

function setPanelVisible(which: 'images' | 'sprites', visible: boolean): void {
  const panel = which === 'images' ? panelImages : panelSprites;
  const btn = which === 'images' ? btnToggleImages : btnToggleSprites;
  panel.classList.toggle('hidden', !visible);
  btn.classList.toggle('active', visible);
  syncTabStripPanelOffsets();
}

btnToggleImages.addEventListener('click', () => {
  const show = panelImages.classList.contains('hidden');
  setPanelVisible('images', show);
  saveSettings();
  requestAnimationFrame(resizeCanvas);
});

btnToggleSprites.addEventListener('click', () => {
  const show = panelSprites.classList.contains('hidden');
  setPanelVisible('sprites', show);
  saveSettings();
  requestAnimationFrame(resizeCanvas);
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
  if (boundaryCheck.checked) {
    const boundaryOverlay = createBoundaryOverlay(
      animation, zoom, panX, panY,
      cw, ch, stageRenderScale,
    );
    pixiApp.stage.addChild(boundaryOverlay);
  }
}

// Redraw on boundary toggle
boundaryCheck.addEventListener('change', () => {
  drawCurrentFrame();
  saveSettings();
});

loopCheck.addEventListener('change', saveSettings);
reverseCheck.addEventListener('change', saveSettings);
autoplayCheck.addEventListener('change', saveSettings);
keepSpeedCheck.addEventListener('change', saveSettings);

// ── Size controls ──
const sizeAspectLocked = true;

sizeWInput.addEventListener('input', () => {
  if (!animation) return;
  const w = parseInt(sizeWInput.value) || 1;
  if (sizeAspectLocked && animation.size[0] > 0) {
    const ratio = animation.size[1] / animation.size[0];
    sizeHInput.value = String(Math.round(w * ratio));
  }
  setExportSizeScaleValue(getCurrentExportSize());
  updateSizeDisplay();
});

sizeHInput.addEventListener('input', () => {
  if (!animation) return;
  const h = parseInt(sizeHInput.value) || 1;
  if (sizeAspectLocked && animation.size[1] > 0) {
    const ratio = animation.size[0] / animation.size[1];
    sizeWInput.value = String(Math.round(h * ratio));
  }
  setExportSizeScaleValue(getCurrentExportSize());
  updateSizeDisplay();
});

sizeScaleSelect.addEventListener('change', () => {
  setExportSizeFromScale(sizeScaleSelect.value);
  updateSizeDisplay();
  saveSettings();
});
speedInput.addEventListener('input', () => {
  updateSpeedPresetTrigger();
  saveSettings();
});

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
  const fps = parseInt(speedInput.value, 10);
  if (!Number.isFinite(fps)) return 'custom';

  const baseRate = getBaseFrameRate();
  const preset = SPEED_PRESETS.find(p => Math.round(baseRate * p.factor) === fps);
  return preset ? String(preset.factor) : 'custom';
}

function updateSpeedPresetTrigger(): void {
  speedPresetSelect.value = getMatchingSpeedPresetValue();
  updateSelectControlValue(speedPresetSelect);
}

speedPresetSelect.addEventListener('change', () => {
  const preset = SPEED_PRESETS.find(p => String(p.factor) === speedPresetSelect.value);
  if (!preset) {
    updateSpeedPresetTrigger();
    return;
  }
  speedInput.value = String(Math.round(getBaseFrameRate() * preset.factor));
  speedInput.dispatchEvent(new Event('input', { bubbles: true }));
});

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
  exportOverlay.querySelector('.export-title')!.textContent = title;
  exportProgress.value = 0;
  exportStatus.textContent = t('export.preparing');
  exportOverlay.classList.remove('hidden');
}

function hideExportOverlay(): void {
  exportOverlay.classList.add('hidden');
}

exportCancelBtn.addEventListener('click', () => {
  exportCancelled = true;
});

function getExportName(ext: string): string {
  const base = stripKnownAnimationExtension(animName.textContent!);
  const sprName = activeSpriteIndex === -1 ? 'main' : (animation!.sprite[activeSpriteIndex].name || 'sprite_' + activeSpriteIndex);
  return base + '_' + sprName + '.' + ext;
}

// ── Export PNG (current frame) ──
btnExportPng.addEventListener('click', () => {
  if (!animation || !activeSprite) return;
  const { w, h } = getExportSize();
  const offCanvas = renderFrameToCanvas(currentFrame, w, h);
  offCanvas.toBlob(blob => {
    if (blob) downloadBlob(blob, getExportName('png'));
  }, 'image/png');
  drawCurrentFrame();
});

initAnimatedWebpEncoder().catch(() => {
  btnExportWebp.disabled = true;
  btnExportWebp.title = 'WebP WASM failed to load';
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
    const fps = parseInt(speedInput.value, 10) || 30;

    const canvasFrames: HTMLCanvasElement[] = [];
    for (let i = 0; i < totalFrames; i++) {
      if (exportCancelled) { hideExportOverlay(); drawCurrentFrame(); return; }
      const fi = begin + i;
      canvasFrames.push(renderFrameToCanvas(fi, w, h));
      exportProgress.value = ((i + 1) / totalFrames) * 50;
      exportStatus.textContent = t('export.rendering', { current: String(i + 1), total: String(totalFrames) });
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }

    if (exportCancelled) { hideExportOverlay(); drawCurrentFrame(); return; }
    exportStatus.textContent = t('export.encoding', { format: formatLabel });
    exportProgress.value = 50;
    await new Promise(r => setTimeout(r, 0));

    const bytes = await encodeFn(canvasFrames, w, h, fps);
    exportProgress.value = 100;

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

btnExportApng.addEventListener('click', () =>
  exportAnimCommon('APNG', encodeApng, 'image/apng', 'apng'));

btnExportWebp.addEventListener('click', () =>
  exportAnimCommon('WebP', encodeAnimatedWebp, 'image/webp', 'webp'));

// ── Export FLA ──
btnExportFla.addEventListener('click', async () => {
  if (!animation) return;
  const baseName = stripKnownAnimationExtension(animName.textContent!);
  btnExportFla.disabled = true;
  try {
    const blob = await exportFLA(animation, textures);
    downloadBlob(blob, baseName + '.fla');
  } finally {
    btnExportFla.disabled = false;
  }
});

// ── Format conversion exports ──
function getConvertName(ext: string): string {
  return stripKnownAnimationExtension(animName.textContent!) + '.pam.' + ext;
}

btnConvertJson.addEventListener('click', async () => {
  if (!animation) return;
  const raw = toRawJson(animation);
  const wasm = await loadPamCodecWasm();
  const text = wasm.pamToJson(raw) + '\n';
  const blob = new Blob([text], { type: 'application/json' });
  downloadBlob(blob, getConvertName('json'));
});

btnConvertYaml.addEventListener('click', () => {
  if (!animation) return;
  const raw = toRawJson(animation);
  const text = jsYamlMod.dump(raw, { lineWidth: -1, noRefs: true });
  const blob = new Blob([text], { type: 'text/yaml' });
  downloadBlob(blob, getConvertName('yaml'));
});

btnConvertToml.addEventListener('click', () => {
  if (!animation) return;
  const raw = toRawJson(animation);
  const text = smolTomlMod.stringify(raw as any);
  const blob = new Blob([text], { type: 'application/toml' });
  downloadBlob(blob, getConvertName('toml'));
});

btnConvertPam.addEventListener('click', async () => {
  if (!animation) return;
  const raw = toRawJson(animation);
  const buf = await encodePAM(raw);
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const name = stripKnownAnimationExtension(animName.textContent!) + '.pam';
  downloadBlob(blob, name);
});

// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (activeSprite) { playing ? stop() : play(); }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      btnPrev.click();
      break;
    case 'ArrowRight':
      e.preventDefault();
      btnNext.click();
      break;
    case '0':
      e.preventDefault();
      btnZoomReset.click();
      break;
    case '=':
    case '+':
      e.preventDefault();
      zoom = Math.min(100, zoom * 1.15);
      updateZoomDisplay();
      drawCurrentFrame();
      break;
    case '-':
      e.preventDefault();
      zoom = Math.max(0.05, zoom / 1.15);
      updateZoomDisplay();
      drawCurrentFrame();
      break;
  }
});

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
  syncTabStripPanelOffsets();
  resizeCanvas();
}

initApp().catch(err => {
  console.error('Failed to initialize PixiJS:', err);
  statusText.textContent = 'PixiJS 初始化失败';
});
