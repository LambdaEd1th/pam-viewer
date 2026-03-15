import './style.css';
import { parseAnimation, parseImageFileName, parseSpriteFrameLabels } from './model';
import { buildAllTimelines, renderFrame } from './renderer';
import { decodePAM } from './pam-decoder';
import { encodePAM } from './pam-encoder';
import { toRawJson } from './pam-serializer';
import { exportFLA } from './xfl-exporter';
import { importFLA, importXFLFromFiles } from './xfl-importer';
import { t, getLang, setLang, onLangChange, getAvailableLangs, getLangLabel } from './i18n';
import * as jsYamlMod from 'js-yaml';
import * as smolTomlMod from 'smol-toml';
import type { Animation, TimelinesMap } from './types';

// ── Settings persistence ──
const SETTINGS_KEY = 'pam-viewer-settings';

function loadSettings(): void {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (!s) return;
    if (typeof s.loop === 'boolean') loopCheck.checked = s.loop;
    if (typeof s.autoPlay === 'boolean') autoplayCheck.checked = s.autoPlay;
    if (typeof s.boundary === 'boolean') boundaryCheck.checked = s.boundary;
    if (typeof s.reverse === 'boolean') reverseCheck.checked = s.reverse;
    if (typeof s.keepSpeed === 'boolean') keepSpeedCheck.checked = s.keepSpeed;
    if (typeof s.showImages === 'boolean') setPanelVisible('images', s.showImages);
    if (typeof s.showSprites === 'boolean') setPanelVisible('sprites', s.showSprites);
  } catch { /* ignore corrupt data */ }
}

function saveSettings(): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({
    loop: loopCheck.checked,
    autoPlay: autoplayCheck.checked,
    boundary: boundaryCheck.checked,
    reverse: reverseCheck.checked,
    keepSpeed: keepSpeedCheck.checked,
    showImages: !panelImages.classList.contains('hidden'),
    showSprites: !panelSprites.classList.contains('hidden'),
  }));
}

// ── DOM references ──
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const btnLoad = $<HTMLButtonElement>('btn-load');
const btnClear = $<HTMLButtonElement>('btn-clear');
const animName = $<HTMLSpanElement>('anim-name');
const spriteSelect = $<HTMLSelectElement>('sprite-select');
const labelSelect = $<HTMLSelectElement>('label-select');
const btnPrev = $<HTMLButtonElement>('btn-prev');
const btnPlay = $<HTMLButtonElement>('btn-play');
const btnNext = $<HTMLButtonElement>('btn-next');
const frameDisplay = $<HTMLSpanElement>('frame-display');
const frameSlider = $<HTMLInputElement>('frame-slider');
const speedInput = $<HTMLInputElement>('speed-input');
const speedPresetBtn = $<HTMLButtonElement>('speed-preset-btn');
const speedPresetMenu = $<HTMLDivElement>('speed-preset-menu');
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
const ctx = canvas.getContext('2d')!;
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
const dropHint = $<HTMLDivElement>('drop-hint');

// ── State ──
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

// Filters
let imageFilter: boolean[] = [];
let spriteFilter: boolean[] = [];

// Layer detection results
let plantCustomLayers: number[] = [];
let zombieStateLayers: number[] = [];
let groundSwatchLayers: number[] = [];

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

onLangChange(() => {
  applyI18n();
  langSelect.value = getLang();
  if (animation) populateLabelSelect();
});
applyI18n();

// ── Canvas sizing ──
function resizeCanvas(): void {
  const rect = stageContainer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  drawCurrentFrame();
}
window.addEventListener('resize', resizeCanvas);

// ── Hidden file input for fallback directory picking ──
const fileInput = document.createElement('input');
fileInput.type = 'file';
(fileInput as any).webkitdirectory = true;
fileInput.multiple = true;
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

// ── Drag-and-drop helpers ──
interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  fullPath?: string;
  name?: string;
  file(success: (f: File) => void, error: (e: any) => void): void;
  createReader(): { readEntries(success: (entries: FileSystemEntryLike[]) => void, error: (e: any) => void): void };
}

async function readEntriesRecursive(directoryEntry: FileSystemEntryLike, prefix = ''): Promise<File[]> {
  const files: File[] = [];
  const reader = directoryEntry.createReader();
  const readBatch = () => new Promise<FileSystemEntryLike[]>((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
  let batch: FileSystemEntryLike[];
  do {
    batch = await readBatch();
    for (const entry of batch) {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => entry.file(res, rej));
        const path = prefix + file.name;
        files.push(new File([file], path, { type: file.type, lastModified: file.lastModified }));
      } else if (entry.isDirectory) {
        files.push(...await readEntriesRecursive(entry, prefix + (entry.name || '') + '/'));
      }
    }
  } while (batch.length > 0);
  return files;
}

async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const allFiles: File[] = [];
  const entries: FileSystemEntryLike[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const entry = (item as any).webkitGetAsEntry?.() ?? (item as any).getAsEntry?.();
    if (entry) {
      entries.push(entry);
    } else {
      const f = item.getAsFile();
      if (f) allFiles.push(f);
    }
  }
  for (const entry of entries) {
    if (entry.isFile) {
      allFiles.push(await new Promise<File>((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      allFiles.push(...await readEntriesRecursive(entry));
    }
  }
  return allFiles;
}

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

async function readDirectoryHandle(dirHandle: any, prefix = '', files: File[] = []): Promise<File[]> {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const f = await entry.getFile();
      files.push(new File([f], prefix + f.name, { type: f.type, lastModified: f.lastModified }));
    } else if (entry.kind === 'directory') {
      await readDirectoryHandle(entry, prefix + entry.name + '/', files);
    }
  }
  return files;
}

fileInput.addEventListener('change', async () => {
  if (!fileInput.files || fileInput.files.length === 0) return;
  try {
    await loadFromFiles(Array.from(fileInput.files));
  } catch (e: any) {
    statusText.textContent = t('status.error', { message: e.message });
    console.error(e);
  }
});

// ── Core loading logic ──
async function loadFromFiles(files: File[]): Promise<void> {
  statusText.textContent = t('status.loading');
  stop();

  const flaFile = files.find(f => /\.fla$/i.test(f.name));
  const hasXfl = !flaFile && files.some(f => /(?:^|[\/])DOMDocument\.xml$/i.test(f.name));

  let flaMediaPngs: Map<string, Uint8Array> | null = null;
  let displayName = '';

  if (flaFile || hasXfl) {
    if (flaFile) {
      const buf = await flaFile.arrayBuffer();
      const result = await importFLA(buf);
      animation = parseAnimation(result.json);
      flaMediaPngs = result.mediaPngs;
      displayName = flaFile.name;
    } else {
      const fileMap = new Map<string, Uint8Array>();
      for (const f of files) {
        const buf = await f.arrayBuffer();
        fileMap.set(f.name, new Uint8Array(buf));
      }
      const result = importXFLFromFiles(fileMap);
      animation = parseAnimation(result.json);
      flaMediaPngs = result.mediaPngs;
      displayName = files[0]?.name?.split('/')[0] || 'XFL';
    }
  } else {
    let pamJsonFile = files.find(f => /\.pam\.json$/i.test(f.name));
    if (!pamJsonFile) pamJsonFile = files.find(f => /\.json$/i.test(f.name));
    let pamYamlFile = files.find(f => /\.pam\.ya?ml$/i.test(f.name));
    if (!pamYamlFile) pamYamlFile = files.find(f => /\.ya?ml$/i.test(f.name));
    let pamTomlFile = files.find(f => /\.pam\.toml$/i.test(f.name));
    if (!pamTomlFile) pamTomlFile = files.find(f => /\.toml$/i.test(f.name));
    const pamBinFile = files.find(f => /\.pam$/i.test(f.name) && !/\.json$/i.test(f.name) && !/\.ya?ml$/i.test(f.name) && !/\.toml$/i.test(f.name));

    const sourceFile = pamJsonFile || pamYamlFile || pamTomlFile || pamBinFile;
    if (!sourceFile) { statusText.textContent = t('status.noPam'); return; }
    displayName = sourceFile.name;

    if (pamJsonFile) {
      const text = await pamJsonFile.text();
      animation = parseAnimation(JSON.parse(text));
    } else if (pamYamlFile) {
      const text = await pamYamlFile.text();
      animation = parseAnimation(jsYamlMod.load(text) as any);
    } else if (pamTomlFile) {
      const text = await pamTomlFile.text();
      animation = parseAnimation(smolTomlMod.parse(text) as any);
    } else {
      const buf = await pamBinFile!.arrayBuffer();
      animation = parseAnimation(decodePAM(buf));
    }
  }

  // Build PNG name map
  const pngMap = new Map<string, File>();
  for (const f of files) {
    if (/\.png$/i.test(f.name)) pngMap.set(f.name.toUpperCase(), f);
  }

  // Load textures
  textures = new Map();
  let loaded = 0;
  for (const img of animation!.image) {
    const baseName = parseImageFileName(img.name);
    const pipeIdx = img.name.indexOf('|');
    const altName = pipeIdx !== -1 ? img.name.substring(pipeIdx + 1) : null;

    if (flaMediaPngs) {
      for (const name of [baseName, altName].filter(Boolean) as string[]) {
        const pngData = flaMediaPngs.get(name);
        if (pngData) {
          try {
            const blob = new Blob([pngData as BlobPart], { type: 'image/png' });
            textures.set(img.name, await blobToImage(blob));
            loaded++;
          } catch { /* skip */ }
          break;
        }
      }
      if (textures.has(img.name)) continue;
    }

    for (const name of [baseName, altName].filter(Boolean) as string[]) {
      const pngFile = pngMap.get((name + '.png').toUpperCase());
      if (pngFile) {
        try { textures.set(img.name, await blobToImage(pngFile)); loaded++; }
        catch { /* skip */ }
        break;
      }
    }
  }

  spriteTimelines = buildAllTimelines(animation!);

  zoom = 1.0;
  panX = 0;
  panY = 0;
  updateZoomDisplay();

  imageFilter = animation!.image.map(() => true);
  spriteFilter = animation!.sprite.map(() => true);

  animName.textContent = displayName;
  populateSpriteSelect();
  populateImagePanel();
  populateSpritePanel();
  detectSpecialLayers();

  speedInput.value = String(animation!.frameRate);
  speedInput.disabled = false;

  sizeWInput.value = String(animation!.size[0]);
  sizeHInput.value = String(animation!.size[1]);
  sizeScaleSelect.value = '1';
  updateSizeDisplay();

  if (animation!.mainSprite) {
    spriteSelect.value = 'main';
    activateSprite(-1);
  } else if (animation!.sprite.length > 0) {
    spriteSelect.value = '0';
    activateSprite(0);
  }

  btnClear.disabled = false;
  statusText.textContent = t('status.loaded', { name: displayName, images: String(animation!.image.length), loaded: String(loaded), sprites: String(animation!.sprite.length) });
  dropHint.classList.add('hidden');
  resizeCanvas();
}

// ── Clear ──
btnClear.addEventListener('click', () => {
  stop();
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
  zoom = 1.0; panX = 0; panY = 0;
  updateZoomDisplay();
  sizeWInput.value = '0';
  sizeHInput.value = '0';
  sizeScaleSelect.value = '1';
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
  frameSlider.value = '0'; frameSlider.max = '0';
  speedInput.disabled = true;
  rangeBeginInput.disabled = true;
  rangeEndInput.disabled = true;
  btnClear.disabled = true;
  frameDisplay.textContent = '0 / 0';
  statusText.textContent = t('status.hint');

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  dropHint.classList.remove('hidden');
});

function blobToImage(fileOrBlob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

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
  spriteSelect.disabled = false;
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
  btnExportWebp.disabled = !enabled || !webpSupported;
  btnExportFla.disabled = !enabled;
  btnConvertJson.disabled = !enabled;
  btnConvertYaml.disabled = !enabled;
  btnConvertToml.disabled = !enabled;
  btnConvertPam.disabled = !enabled;
  sizeWInput.disabled = !enabled;
  sizeHInput.disabled = !enabled;
  sizeScaleSelect.disabled = !enabled;
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
  const scale = parseInt(sizeScaleSelect.value) || 1;
  const w = animation.size[0] * scale;
  const h = animation.size[1] * scale;
  animSizeDisplay.textContent = `${w}\u00d7${h}`;
}

function updateCoordDisplay(e: PointerEvent | MouseEvent): void {
  if (!animation) { coordDisplay.textContent = ''; return; }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cx = canvas.width / 2 + panX * dpr;
  const cy = canvas.height / 2 + panY * dpr;
  const sx = ((e.clientX - rect.left) * dpr - cx) / zoom + animation.position[0];
  const sy = ((e.clientY - rect.top) * dpr - cy) / zoom + animation.position[1];
  coordDisplay.textContent = `${Math.round(sx)}, ${Math.round(sy)}`;
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;

  const oldZoom = zoom;
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  zoom = Math.max(0.05, Math.min(100, zoom * factor));

  const dx = mouseX - halfW;
  const dy = mouseY - halfH;
  panX = dx - (dx - panX) * zoom / oldZoom;
  panY = dy - (dy - panY) * zoom / oldZoom;

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
} | null = null;
const EDGE_HIT = 6;

function clientToAnimSpace(clientX: number, clientY: number): { ax: number; ay: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cx = canvas.width / 2 + panX * dpr;
  const cy = canvas.height / 2 + panY * dpr;
  const ox = animation!.position[0];
  const oy = animation!.position[1];
  const ax = ((clientX - rect.left) * dpr - cx) / zoom + ox;
  const ay = ((clientY - rect.top) * dpr - cy) / zoom + oy;
  return { ax, ay };
}

function hitTestBoundaryEdge(clientX: number, clientY: number): EdgeDir | null {
  if (!animation || !boundaryCheck.checked) return null;
  const w = animation.size[0];
  const h = animation.size[1];
  const { ax, ay } = clientToAnimSpace(clientX, clientY);
  const threshold = EDGE_HIT / zoom;

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

function syncSizeInputs(): void {
  sizeWInput.value = String(animation!.size[0]);
  sizeHInput.value = String(animation!.size[1]);
  updateSizeDisplay();
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
    const dpr = window.devicePixelRatio || 1;
    const dx = (e.clientX - boundaryDragStart.mx) * dpr / zoom;
    const dy = (e.clientY - boundaryDragStart.my) * dpr / zoom;
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
    syncSizeInputs();
    drawCurrentFrame();
    return;
  }

  if (!isPanning) {
    const edge = hitTestBoundaryEdge(e.clientX, e.clientY);
    canvas.style.cursor = edge ? EDGE_CURSORS[edge] : '';
  }

  if (!isPanning) return;
  panX = panOriginX + (e.clientX - panStartX);
  panY = panOriginY + (e.clientY - panStartY);
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
  panX = 0;
  panY = 0;
  updateZoomDisplay();
  drawCurrentFrame();
});

// ── Filter panels ──
function populateImagePanel(): void {
  imageList.innerHTML = '';
  imgRegexInput.value = '';
  animation!.image.forEach((img, i) => {
    const li = document.createElement('li');
    li.dataset.filterName = parseImageFileName(img.name).toLowerCase();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
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
  sprRegexInput.value = '';
  animation!.sprite.forEach((sp, i) => {
    const li = document.createElement('li');
    li.dataset.spriteIndex = String(i);
    li.dataset.filterName = (sp.name || 'sprite_' + i).toLowerCase();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
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

function detectSpecialLayers(): void {
  plantCustomLayers = [];
  zombieStateLayers = [];
  groundSwatchLayers = [];

  animation!.sprite.forEach((sp, i) => {
    if (!sp.name) return;
    if (sp.name.startsWith('custom_')) plantCustomLayers.push(i);
    if (sp.name === 'ink' || sp.name === 'butter') zombieStateLayers.push(i);
    if (sp.name === 'ground_swatch' || sp.name === 'ground_swatch_plane') groundSwatchLayers.push(i);
  });

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
    for (const idx of plantCustomLayers) {
      spriteFilter[idx] = false;
      syncSpriteCheckbox(idx, false);
    }
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
    for (const idx of zombieStateLayers) {
      spriteFilter[idx] = false;
      syncSpriteCheckbox(idx, false);
    }
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
function initResizeHandle(handle: HTMLElement, panel: HTMLElement, side: 'left' | 'right'): void {
  let startX: number, startWidth: number;
  const onPointerMove = (e: PointerEvent) => {
    const delta = side === 'left' ? (e.clientX - startX) : (startX - e.clientX);
    const newWidth = Math.max(120, Math.min(500, startWidth + delta));
    panel.style.width = newWidth + 'px';
    requestAnimationFrame(resizeCanvas);
  };
  const onPointerUp = (e: PointerEvent) => {
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    handle.removeEventListener('pointermove', onPointerMove as EventListener);
    handle.removeEventListener('pointerup', onPointerUp as EventListener);
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
  if (!animation || !activeSprite) return;

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2 + panX * dpr;
  const cy = canvas.height / 2 + panY * dpr;
  const s = zoom;
  const originX = animation.position[0];
  const originY = animation.position[1];

  const baseMatrix: [number, number, number, number, number, number] = [s, 0, 0, s, cx, cy];
  const baseColor = { r: 1, g: 1, b: 1, a: 1 };

  renderFrame(
    ctx, animation, textures, spriteTimelines!,
    activeSpriteIndex, currentFrame,
    baseMatrix, baseColor,
    imageFilter, spriteFilter,
  );

  if (boundaryCheck.checked) {
    const bw = animation.size[0];
    const bh = animation.size[1];
    ctx.setTransform(s, 0, 0, s, cx, cy);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.5)';
    ctx.lineWidth = 1 / s;
    ctx.strokeRect(-originX, -originY, bw, bh);

    const handleSize = 5 / s;
    ctx.fillStyle = 'rgba(0, 200, 255, 0.8)';
    const bx = -originX, by = -originY;
    const handles: [number, number][] = [
      [bx, by], [bx + bw / 2, by], [bx + bw, by],
      [bx, by + bh / 2], [bx + bw, by + bh / 2],
      [bx, by + bh], [bx + bw / 2, by + bh], [bx + bw, by + bh],
    ];
    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.strokeStyle = 'rgba(255, 100, 100, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
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
  animation.size[0] = parseInt(sizeWInput.value) || 1;
  animation.size[1] = parseInt(sizeHInput.value) || 1;
  updateSizeDisplay();
  drawCurrentFrame();
});

sizeHInput.addEventListener('input', () => {
  if (!animation) return;
  const h = parseInt(sizeHInput.value) || 1;
  if (sizeAspectLocked && animation.size[1] > 0) {
    const ratio = animation.size[0] / animation.size[1];
    sizeWInput.value = String(Math.round(h * ratio));
  }
  animation.size[0] = parseInt(sizeWInput.value) || 1;
  animation.size[1] = parseInt(sizeHInput.value) || 1;
  updateSizeDisplay();
  drawCurrentFrame();
});

sizeScaleSelect.addEventListener('change', updateSizeDisplay);

// ── Speed preset menu ──
const SPEED_PRESETS = [
  { label: '0.25\u00d7', factor: 0.25 },
  { label: '0.5\u00d7',  factor: 0.5 },
  { label: '1\u00d7',    factor: 1 },
  { label: '1.5\u00d7',  factor: 1.5 },
  { label: '2\u00d7',    factor: 2 },
  { label: '3\u00d7',    factor: 3 },
];

function buildSpeedPresetMenu(): void {
  speedPresetMenu.innerHTML = '';
  const baseRate = (activeSprite as any)?.frameRate ?? animation?.frameRate ?? 30;
  for (const p of SPEED_PRESETS) {
    const btn = document.createElement('button');
    const fps = Math.round(baseRate * p.factor);
    btn.textContent = `${p.label}  (${fps} FPS)`;
    if (parseInt(speedInput.value) === fps) btn.classList.add('active');
    btn.addEventListener('click', () => {
      speedInput.value = String(fps);
      speedInput.dispatchEvent(new Event('input', { bubbles: true }));
      speedPresetMenu.classList.add('hidden');
    });
    speedPresetMenu.appendChild(btn);
  }
}

speedPresetBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const wasHidden = speedPresetMenu.classList.contains('hidden');
  speedPresetMenu.classList.toggle('hidden');
  if (wasHidden) buildSpeedPresetMenu();
});

document.addEventListener('click', (e) => {
  if (!speedPresetMenu.contains(e.target as Node) && e.target !== speedPresetBtn) {
    speedPresetMenu.classList.add('hidden');
  }
});

// ── Export helpers ──
let exportCancelled = false;

function renderFrameToCanvas(frameIdx: number, w: number, h: number): HTMLCanvasElement {
  const offCanvas = document.createElement('canvas');
  offCanvas.width = w;
  offCanvas.height = h;
  const offCtx = offCanvas.getContext('2d')!;

  const scale = parseInt(sizeScaleSelect.value) || 1;
  const ox = animation!.position[0] * scale;
  const oy = animation!.position[1] * scale;
  const baseMatrix: [number, number, number, number, number, number] = [scale, 0, 0, scale, ox, oy];
  const baseColor = { r: 1, g: 1, b: 1, a: 1 };

  renderFrame(
    offCtx, animation!, textures, spriteTimelines!,
    activeSpriteIndex, frameIdx,
    baseMatrix, baseColor,
    imageFilter, spriteFilter,
  );
  return offCanvas;
}

function getExportSize(): { w: number; h: number } {
  const scale = parseInt(sizeScaleSelect.value) || 1;
  const w = animation!.size[0] * scale;
  const h = animation!.size[1] * scale;
  return { w: Math.max(w, 1), h: Math.max(h, 1) };
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
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
  const base = animName.textContent!
    .replace(/\.pam\.json$/i, '')
    .replace(/\.pam\.ya?ml$/i, '')
    .replace(/\.pam\.toml$/i, '')
    .replace(/\.json$/i, '')
    .replace(/\.ya?ml$/i, '')
    .replace(/\.toml$/i, '')
    .replace(/\.pam$/i, '')
    .replace(/\.fla$/i, '');
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
});

// ── Detect WebP support ──
let webpSupported = true;
function disableWebpExport(): void {
  webpSupported = false;
  btnExportWebp.disabled = true;
  btnExportWebp.title = 'WebP export is not supported on this browser';
}
{
  const tc = document.createElement('canvas');
  tc.width = 1; tc.height = 1;
  const du = tc.toDataURL('image/webp');
  if (!du.startsWith('data:image/webp')) {
    tc.toBlob((blob) => {
      if (!blob || blob.type !== 'image/webp') {
        disableWebpExport();
      } else {
        // toBlob claims WebP, verify RIFF/WEBP signature
        blob.arrayBuffer().then(buf => {
          const b = new Uint8Array(buf);
          const isRIFF = b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46;
          const isWEBP = b[8]===0x57 && b[9]===0x45 && b[10]===0x42 && b[11]===0x50;
          if (!isRIFF || !isWEBP) disableWebpExport();
        });
      }
    }, 'image/webp', 0.9);
  }
}

// ── Animated WebP encoder ──
async function extractWebpPayload(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  // Validate RIFF/WEBP signature
  const isRIFF = bytes[0]===0x52 && bytes[1]===0x49 && bytes[2]===0x46 && bytes[3]===0x46;
  const isWEBP = bytes[8]===0x57 && bytes[9]===0x45 && bytes[10]===0x42 && bytes[11]===0x50;
  if (!isRIFF || !isWEBP) throw new Error('Browser returned non-WebP data. WebP export is not supported on this browser.');
  let pos = 12;
  const parts: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const fourCC = String.fromCharCode(bytes[pos], bytes[pos+1], bytes[pos+2], bytes[pos+3]);
    const chunkSize = view.getUint32(pos + 4, true);
    const chunkDiskSize = 8 + chunkSize + (chunkSize & 1);
    if (fourCC === 'VP8 ' || fourCC === 'VP8L' || fourCC === 'ALPH') {
      parts.push(bytes.slice(pos, pos + chunkDiskSize));
    }
    pos += chunkDiskSize;
  }
  const total = parts.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of parts) { result.set(c, off); off += c.length; }
  return result;
}

function writeU32LE(arr: Uint8Array, off: number, val: number): void {
  arr[off] = val & 0xff;
  arr[off+1] = (val >> 8) & 0xff;
  arr[off+2] = (val >> 16) & 0xff;
  arr[off+3] = (val >> 24) & 0xff;
}
function writeU24LE(arr: Uint8Array, off: number, val: number): void {
  arr[off] = val & 0xff;
  arr[off+1] = (val >> 8) & 0xff;
  arr[off+2] = (val >> 16) & 0xff;
}
function writeU16LE(arr: Uint8Array, off: number, val: number): void {
  arr[off] = val & 0xff;
  arr[off+1] = (val >> 8) & 0xff;
}

async function encodeAnimatedWebp(canvasFrames: HTMLCanvasElement[], w: number, h: number, fps: number): Promise<Uint8Array> {
  const durationMs = Math.round(1000 / fps);
  const framePayloads: Uint8Array[] = [];
  for (const cvs of canvasFrames) {
    const blob = await new Promise<Blob | null>(r => cvs.toBlob(r, 'image/webp', 0.9));
    if (!blob || blob.type !== 'image/webp') throw new Error('Current browser does not support canvas WebP export.');
    framePayloads.push(await extractWebpPayload(blob));
  }

  const anmfChunks: Uint8Array[] = [];
  for (let i = 0; i < framePayloads.length; i++) {
    const payload = framePayloads[i];
    const anmfData = new Uint8Array(16 + payload.length);
    writeU24LE(anmfData, 0, 0);
    writeU24LE(anmfData, 3, 0);
    writeU24LE(anmfData, 6, w - 1);
    writeU24LE(anmfData, 9, h - 1);
    writeU24LE(anmfData, 12, durationMs);
    anmfData[15] = 0x02;
    anmfData.set(payload, 16);
    const chunkSize = anmfData.length;
    const padded = chunkSize % 2 === 1;
    const chunk = new Uint8Array(8 + chunkSize + (padded ? 1 : 0));
    chunk[0] = 0x41; chunk[1] = 0x4E; chunk[2] = 0x4D; chunk[3] = 0x46;
    writeU32LE(chunk, 4, chunkSize);
    chunk.set(anmfData, 8);
    if (padded) chunk[8 + chunkSize] = 0;
    anmfChunks.push(chunk);
  }

  const vp8x = new Uint8Array(18);
  vp8x[0] = 0x56; vp8x[1] = 0x50; vp8x[2] = 0x38; vp8x[3] = 0x58;
  writeU32LE(vp8x, 4, 10);
  vp8x[8] = 0x12;
  writeU24LE(vp8x, 12, w - 1);
  writeU24LE(vp8x, 15, h - 1);

  const anim = new Uint8Array(14);
  anim[0] = 0x41; anim[1] = 0x4E; anim[2] = 0x49; anim[3] = 0x4D;
  writeU32LE(anim, 4, 6);
  writeU32LE(anim, 8, 0);
  writeU16LE(anim, 12, 0);

  const riffPayloadSize = 4 + vp8x.length + anim.length + anmfChunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(12 + riffPayloadSize - 4);
  result[0] = 0x52; result[1] = 0x49; result[2] = 0x46; result[3] = 0x46;
  writeU32LE(result, 4, result.length - 8);
  result[8] = 0x57; result[9] = 0x45; result[10] = 0x42; result[11] = 0x50;
  let off = 12;
  result.set(vp8x, off); off += vp8x.length;
  result.set(anim, off); off += anim.length;
  for (const chunk of anmfChunks) { result.set(chunk, off); off += chunk.length; }
  return result;
}

// ── APNG encoder ──
async function extractPngIdat(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const chunks: Uint8Array[] = [];
  let pos = 8;
  while (pos < buf.byteLength) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(
      view.getUint8(pos+4), view.getUint8(pos+5),
      view.getUint8(pos+6), view.getUint8(pos+7));
    if (type === 'IDAT') chunks.push(new Uint8Array(buf, pos + 8, len));
    pos += 12 + len;
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.length; }
  return result;
}

const apngCrc32Table: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function apngCrc32(data: Uint8Array, start: number, length: number): number {
  let crc = 0xFFFFFFFF;
  for (let i = start; i < start + length; i++) crc = apngCrc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeApngChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const chunk = new Uint8Array(12 + len);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, len);
  chunk[4] = type.charCodeAt(0); chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2); chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  view.setUint32(8 + len, apngCrc32(chunk, 4, 4 + len));
  return chunk;
}

async function encodeApng(canvasFrames: HTMLCanvasElement[], w: number, h: number, fps: number): Promise<Uint8Array> {
  const numFrames = canvasFrames.length;
  const delayNum = 1, delayDen = fps;

  const framePngDatas: Uint8Array[] = [];
  for (const cvs of canvasFrames) {
    const blob = await new Promise<Blob>(r => cvs.toBlob(r as any, 'image/png'));
    framePngDatas.push(await extractPngIdat(blob));
  }

  const firstBlob = await new Promise<Blob>(r => canvasFrames[0].toBlob(r as any, 'image/png'));
  const firstBuf = await firstBlob.arrayBuffer();
  const firstView = new DataView(firstBuf);
  const ihdrLen = firstView.getUint32(8);
  const ihdrChunk = new Uint8Array(firstBuf, 8, 12 + ihdrLen);

  const parts: Uint8Array[] = [];
  parts.push(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
  parts.push(new Uint8Array(ihdrChunk));

  const actlData = new Uint8Array(8);
  const actlView = new DataView(actlData.buffer);
  actlView.setUint32(0, numFrames);
  actlView.setUint32(4, 0);
  parts.push(makeApngChunk('acTL', actlData));

  let seqNum = 0;
  for (let i = 0; i < numFrames; i++) {
    const fctlData = new Uint8Array(26);
    const fctlView = new DataView(fctlData.buffer);
    fctlView.setUint32(0, seqNum++); fctlView.setUint32(4, w); fctlView.setUint32(8, h);
    fctlView.setUint32(12, 0); fctlView.setUint32(16, 0);
    fctlView.setUint16(20, delayNum); fctlView.setUint16(22, delayDen);
    fctlData[24] = 0; fctlData[25] = 0;
    parts.push(makeApngChunk('fcTL', fctlData));
    if (i === 0) {
      parts.push(makeApngChunk('IDAT', framePngDatas[i]));
    } else {
      const fdatData = new Uint8Array(4 + framePngDatas[i].length);
      new DataView(fdatData.buffer).setUint32(0, seqNum++);
      fdatData.set(framePngDatas[i], 4);
      parts.push(makeApngChunk('fdAT', fdatData));
    }
  }
  parts.push(makeApngChunk('IEND', new Uint8Array(0)));

  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { result.set(p, off); off += p.length; }
  return result;
}

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
      if (exportCancelled) { hideExportOverlay(); return; }
      const fi = begin + i;
      canvasFrames.push(renderFrameToCanvas(fi, w, h));
      exportProgress.value = ((i + 1) / totalFrames) * 50;
      exportStatus.textContent = t('export.rendering', { current: String(i + 1), total: String(totalFrames) });
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }

    if (exportCancelled) { hideExportOverlay(); return; }
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
}

btnExportApng.addEventListener('click', () =>
  exportAnimCommon('APNG', encodeApng, 'image/apng', 'apng'));

btnExportWebp.addEventListener('click', () =>
  exportAnimCommon('WebP', encodeAnimatedWebp, 'image/webp', 'webp'));

// ── Export FLA ──
btnExportFla.addEventListener('click', async () => {
  if (!animation) return;
  const baseName = animName.textContent!.replace(/\.pam\.json$/i, '').replace(/\.json$/i, '').replace(/\.pam$/i, '');
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
  return animName.textContent!
    .replace(/\.pam\.json$/i, '')
    .replace(/\.pam\.ya?ml$/i, '')
    .replace(/\.pam\.toml$/i, '')
    .replace(/\.json$/i, '')
    .replace(/\.ya?ml$/i, '')
    .replace(/\.toml$/i, '')
    .replace(/\.pam$/i, '')
    .replace(/\.fla$/i, '') + '.pam.' + ext;
}

btnConvertJson.addEventListener('click', () => {
  if (!animation) return;
  const raw = toRawJson(animation);
  const text = JSON.stringify(raw, null, 2);
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

btnConvertPam.addEventListener('click', () => {
  if (!animation) return;
  const raw = toRawJson(animation);
  const buf = encodePAM(raw);
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const name = animName.textContent!
    .replace(/\.pam\.json$/i, '')
    .replace(/\.pam\.ya?ml$/i, '')
    .replace(/\.pam\.toml$/i, '')
    .replace(/\.json$/i, '')
    .replace(/\.ya?ml$/i, '')
    .replace(/\.toml$/i, '')
    .replace(/\.pam$/i, '')
    .replace(/\.fla$/i, '') + '.pam';
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
loadSettings();
resizeCanvas();
