// PAM Viewer — main entry point
// Features: drag-and-drop/button loading, frame slider, zoom/pan,
// image/sprite filter panels, auto-play, settings persistence.

import { parseAnimation, parseImageFileName, parseSpriteFrameLabels } from './model.js';
import { buildAllTimelines, renderFrame } from './renderer.js';
import { decodePAM } from './pam-decoder.js';
import { exportFLA } from './xfl-exporter.js';
import { t, getLang, setLang, onLangChange, getAvailableLangs, getLangLabel } from './i18n.js';

// ── Settings persistence ──
const SETTINGS_KEY = 'pam-viewer-settings';

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
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

function saveSettings() {
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
const btnLoad = document.getElementById('btn-load');
const btnClear = document.getElementById('btn-clear');
const animName = document.getElementById('anim-name');
const spriteSelect = document.getElementById('sprite-select');
const labelSelect = document.getElementById('label-select');
const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');
const frameDisplay = document.getElementById('frame-display');
const frameSlider = document.getElementById('frame-slider');
const speedInput = document.getElementById('speed-input');
const speedPresetBtn = document.getElementById('speed-preset-btn');
const speedPresetMenu = document.getElementById('speed-preset-menu');
const loopCheck = document.getElementById('loop-check');
const reverseCheck = document.getElementById('reverse-check');
const autoplayCheck = document.getElementById('autoplay-check');
const keepSpeedCheck = document.getElementById('keep-speed-check');
const boundaryCheck = document.getElementById('boundary-check');
const rangeBeginInput = document.getElementById('range-begin');
const rangeEndInput = document.getElementById('range-end');
const btnToggleImages = document.getElementById('btn-toggle-images');
const btnToggleSprites = document.getElementById('btn-toggle-sprites');
const btnZoomReset = document.getElementById('btn-zoom-reset');
const stageContainer = document.getElementById('stage-container');
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status-text');
const coordDisplay = document.getElementById('coord-display');
const zoomDisplay = document.getElementById('zoom-display');
const panelImages = document.getElementById('panel-images');
const panelSprites = document.getElementById('panel-sprites');
const imageList = document.getElementById('image-list');
const spriteList = document.getElementById('sprite-list');
const imgRegexInput = document.getElementById('img-regex');
const sprRegexInput = document.getElementById('spr-regex');
const resizeHandleLeft = document.getElementById('resize-handle-left');
const resizeHandleRight = document.getElementById('resize-handle-right');
const plantLayerSelect = document.getElementById('plant-layer-select');
const zombieStateSelect = document.getElementById('zombie-state-select');
const groundSwatchCheck = document.getElementById('ground-swatch-check');
const btnExportPng = document.getElementById('btn-export-png');
const btnExportApng = document.getElementById('btn-export-apng');
const btnExportWebp = document.getElementById('btn-export-webp');
const btnExportFla = document.getElementById('btn-export-fla');
const sizeWInput = document.getElementById('size-w');
const sizeHInput = document.getElementById('size-h');
const sizeScaleSelect = document.getElementById('size-scale');
const animSizeDisplay = document.getElementById('anim-size-display');
const exportOverlay = document.getElementById('export-overlay');
const exportProgress = document.getElementById('export-progress');
const exportStatus = document.getElementById('export-status');
const exportCancelBtn = document.getElementById('export-cancel');
const langSelect = document.getElementById('lang-select');
const dropHint = document.getElementById('drop-hint');

// ── State ──
let animation = null;
let textures = new Map();
let spriteTimelines = null;
let activeSprite = null;
let activeSpriteIndex = -1;
let frameLabels = [];
let frameRange = { begin: 0, end: 0 };
let currentFrame = 0;
let playing = false;
let lastTimestamp = 0;
let accumulator = 0;
let rafId = null;

// Zoom / Pan (in CSS pixels)
let zoom = 1.0;
let panX = 0;
let panY = 0;

// Filters
let imageFilter = [];
let spriteFilter = [];

// Layer detection results (indices into animation.sprite)
let plantCustomLayers = [];   // sprites whose name starts with "custom_"
let zombieStateLayers = [];   // sprites named "ink" or "butter"
let groundSwatchLayers = [];  // sprites named "ground_swatch" or "ground_swatch_plane"

// ── i18n setup ──
function applyI18n() {
  // data-i18n: textContent
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // data-i18n-title: title attribute
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  // data-i18n-placeholder: placeholder attribute
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  // data-i18n-text: first text node (label text before child elements)
  document.querySelectorAll('[data-i18n-text]').forEach(el => {
    const first = el.firstChild;
    const text = t(el.dataset.i18nText);
    if (first && first.nodeType === Node.TEXT_NODE) {
      first.textContent = text + '\n        ';
    }
  });
  // Update anim-name if no animation loaded
  if (!animation) animName.textContent = t('anim.unloaded');
}

// Build language selector
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
  if (animation) {
    populateLabelSelect();
  }
});
applyI18n();

// ── Canvas sizing ──
function resizeCanvas() {
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
fileInput.webkitdirectory = true;
fileInput.multiple = true;
fileInput.style.display = 'none';
document.body.appendChild(fileInput);

// ── Drag-and-drop helpers ──
async function readEntriesRecursive(directoryEntry) {
  const files = [];
  const reader = directoryEntry.createReader();
  const readBatch = () => new Promise((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
  let batch;
  do {
    batch = await readBatch();
    for (const entry of batch) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        files.push(file);
      } else if (entry.isDirectory) {
        files.push(...await readEntriesRecursive(entry));
      }
    }
  } while (batch.length > 0);
  return files;
}

async function collectFilesFromDataTransfer(dataTransfer) {
  const allFiles = [];
  const entries = [];
  for (const item of dataTransfer.items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.() ?? item.getAsEntry?.();
    if (entry) {
      entries.push(entry);
    } else {
      const f = item.getAsFile();
      if (f) allFiles.push(f);
    }
  }
  for (const entry of entries) {
    if (entry.isFile) {
      allFiles.push(await new Promise((res, rej) => entry.file(res, rej)));
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
    const files = await collectFilesFromDataTransfer(e.dataTransfer);
    if (files.length === 0) { statusText.textContent = t('status.noFiles'); return; }
    await loadFromFiles(files);
  } catch (err) {
    statusText.textContent = t('status.error', { message: err.message });
    console.error(err);
  }
});

// ── Button click loading ──
btnLoad.addEventListener('click', async () => {
  if (typeof window.showDirectoryPicker === 'function') {
    try {
      const dirHandle = await window.showDirectoryPicker();
      const files = await readDirectoryHandle(dirHandle);
      await loadFromFiles(files);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  fileInput.value = '';
  fileInput.click();
});

async function readDirectoryHandle(dirHandle, files = []) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      files.push(await entry.getFile());
    } else if (entry.kind === 'directory') {
      await readDirectoryHandle(entry, files);
    }
  }
  return files;
}

fileInput.addEventListener('change', async () => {
  if (!fileInput.files || fileInput.files.length === 0) return;
  try {
    await loadFromFiles(Array.from(fileInput.files));
  } catch (e) {
    statusText.textContent = t('status.error', { message: e.message });
    console.error(e);
  }
});

// ── Core loading logic ──
async function loadFromFiles(files) {
  statusText.textContent = t('status.loading');
  stop();

  let pamJsonFile = files.find(f => /\.pam\.json$/i.test(f.name));
  if (!pamJsonFile) pamJsonFile = files.find(f => /\.json$/i.test(f.name));
  let pamBinFile = files.find(f => /\.pam$/i.test(f.name) && !/\.json$/i.test(f.name));

  if (!pamJsonFile && !pamBinFile) { statusText.textContent = t('status.noPam'); return; }

  const sourceFile = pamJsonFile || pamBinFile;
  if (pamJsonFile) {
    const text = await pamJsonFile.text();
    animation = parseAnimation(JSON.parse(text));
  } else {
    const buf = await pamBinFile.arrayBuffer();
    animation = parseAnimation(decodePAM(buf));
  }

  // Build PNG name map
  const pngMap = new Map();
  for (const f of files) {
    if (/\.png$/i.test(f.name)) pngMap.set(f.name.toUpperCase(), f);
  }

  // Load textures
  textures = new Map();
  let loaded = 0;
  for (const img of animation.image) {
    const baseName = parseImageFileName(img.name);
    const pipeIdx = img.name.indexOf('|');
    const altName = pipeIdx !== -1 ? img.name.substring(pipeIdx + 1) : null;
    for (const name of [baseName, altName].filter(Boolean)) {
      const pngFile = pngMap.get((name + '.png').toUpperCase());
      if (pngFile) {
        try { textures.set(img.name, await blobToImage(pngFile)); loaded++; }
        catch { /* skip */ }
        break;
      }
    }
  }

  // Build timelines
  spriteTimelines = buildAllTimelines(animation);

  // Reset zoom/pan
  zoom = 1.0;
  panX = 0;
  panY = 0;
  updateZoomDisplay();

  // Init filters
  imageFilter = animation.image.map(() => true);
  spriteFilter = animation.sprite.map(() => true);

  // Populate UI
  animName.textContent = sourceFile.name;
  populateSpriteSelect();
  populateImagePanel();
  populateSpritePanel();

  // Detect special layers (after panels populated so checkbox sync works)
  detectSpecialLayers();

  speedInput.value = animation.frameRate;
  speedInput.disabled = false;

  // Init size controls
  sizeWInput.value = animation.size[0];
  sizeHInput.value = animation.size[1];
  sizeScaleSelect.value = '1';
  updateSizeDisplay();

  // Auto-select mainSprite
  if (animation.mainSprite) {
    spriteSelect.value = 'main';
    activateSprite(-1);
  } else if (animation.sprite.length > 0) {
    spriteSelect.value = '0';
    activateSprite(0);
  }

  btnClear.disabled = false;
  statusText.textContent = t('status.loaded', { name: sourceFile.name, images: animation.image.length, loaded, sprites: animation.sprite.length });
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
  sizeWInput.value = 0;
  sizeHInput.value = 0;
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
  frameSlider.value = 0; frameSlider.max = 0;
  speedInput.disabled = true;
  rangeBeginInput.disabled = true;
  rangeEndInput.disabled = true;
  btnClear.disabled = true;
  frameDisplay.textContent = '0 / 0';
  statusText.textContent = t('status.hint');

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  dropHint.classList.remove('hidden');
});

function blobToImage(fileOrBlob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// ── Sprite selection ──
function populateSpriteSelect() {
  spriteSelect.innerHTML = '';
  if (animation.mainSprite) {
    const opt = document.createElement('option');
    opt.value = 'main';
    opt.textContent = `MainSprite (${animation.mainSprite.frame.length} frames)`;
    spriteSelect.appendChild(opt);
  }
  animation.sprite.forEach((sp, i) => {
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

function activateSprite(index) {
  stop();
  activeSpriteIndex = index;
  activeSprite = index === -1 ? animation.mainSprite : animation.sprite[index];
  if (!activeSprite || activeSprite.frame.length === 0) return;

  frameLabels = parseSpriteFrameLabels(activeSprite);
  frameRange = { begin: 0, end: activeSprite.frame.length - 1 };
  currentFrame = reverseCheck.checked ? frameRange.end : frameRange.begin;

  populateLabelSelect();
  enableControls(true);
  if (!keepSpeedCheck.checked) {
    speedInput.value = activeSprite.frameRate ?? animation.frameRate;
  }
  updateSliderRange();
  updateRangeInputs();
  updateFrameDisplay();
  highlightActiveSpriteInPanel();
  drawCurrentFrame();

  // Auto-play
  if (autoplayCheck.checked) play();
}

// ── Label selection ──
function populateLabelSelect() {
  labelSelect.innerHTML = `<option value="all">${t('label.allFrames')}</option>`;
  for (const label of frameLabels) {
    const opt = document.createElement('option');
    opt.value = JSON.stringify({ begin: label.begin, end: label.end });
    opt.textContent = `${label.name} [${label.begin}–${label.end}]`;
    labelSelect.appendChild(opt);
  }
  labelSelect.disabled = false;
}

labelSelect.addEventListener('change', () => {
  stop();
  if (labelSelect.value === 'all') {
    frameRange = { begin: 0, end: activeSprite.frame.length - 1 };
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

function updateSliderRange() {
  frameSlider.min = frameRange.begin;
  frameSlider.max = frameRange.end;
  frameSlider.value = currentFrame;
  frameSlider.disabled = !activeSprite;
}

// ── Frame range inputs ──
function updateRangeInputs() {
  const maxFrame = activeSprite ? activeSprite.frame.length - 1 : 0;
  rangeBeginInput.max = maxFrame;
  rangeEndInput.max = maxFrame;
  rangeBeginInput.value = frameRange.begin;
  rangeEndInput.value = frameRange.end;
  rangeBeginInput.disabled = !activeSprite;
  rangeEndInput.disabled = !activeSprite;
}

rangeBeginInput.addEventListener('change', () => {
  const v = Math.max(0, Math.min(parseInt(rangeBeginInput.value, 10) || 0, frameRange.end));
  frameRange.begin = v;
  rangeBeginInput.value = v;
  if (currentFrame < v) currentFrame = v;
  updateSliderRange();
  updateFrameDisplay();
  drawCurrentFrame();
});

rangeEndInput.addEventListener('change', () => {
  const maxFrame = activeSprite ? activeSprite.frame.length - 1 : 0;
  const v = Math.max(frameRange.begin, Math.min(parseInt(rangeEndInput.value, 10) || 0, maxFrame));
  frameRange.end = v;
  rangeEndInput.value = v;
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
function enableControls(enabled) {
  btnPrev.disabled = !enabled;
  btnPlay.disabled = !enabled;
  btnNext.disabled = !enabled;
  btnExportPng.disabled = !enabled;
  btnExportApng.disabled = !enabled;
  btnExportWebp.disabled = !enabled;
  btnExportFla.disabled = !enabled;
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

function play() {
  if (!activeSprite) return;
  playing = true;
  btnPlay.textContent = '⏸';
  lastTimestamp = performance.now();
  accumulator = 0;
  tick(lastTimestamp);
}

function stop() {
  playing = false;
  btnPlay.textContent = '▶';
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
}

function tick(timestamp) {
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

function updateFrameDisplay() {
  const total = activeSprite ? activeSprite.frame.length : 0;
  frameDisplay.textContent = `${currentFrame} / ${total - 1}`;
  frameSlider.value = currentFrame;
}

// ── Zoom / Pan ──
function updateZoomDisplay() {
  zoomDisplay.textContent = Math.round(zoom * 100) + '%';
}

function updateSizeDisplay() {
  if (!animation) {
    animSizeDisplay.textContent = '';
    return;
  }
  const scale = parseInt(sizeScaleSelect.value) || 1;
  const w = animation.size[0] * scale;
  const h = animation.size[1] * scale;
  animSizeDisplay.textContent = `${w}×${h}`;
}

function updateCoordDisplay(e) {
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

  // Keep point under cursor fixed
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
let boundaryDragEdge = null; // null | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
let boundaryDragStart = null; // { mx, my, origW, origH }
const EDGE_HIT = 6; // pixels threshold for edge detection

/** Convert client coords to animation-space coords */
function clientToAnimSpace(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const cx = canvas.width / 2 + panX * dpr;
  const cy = canvas.height / 2 + panY * dpr;
  const ox = animation.position[0];
  const oy = animation.position[1];
  const ax = ((clientX - rect.left) * dpr - cx) / zoom + ox;
  const ay = ((clientY - rect.top) * dpr - cy) / zoom + oy;
  return { ax, ay };
}

/** Detect which boundary edge/corner is near the pointer (screen-space threshold) */
function hitTestBoundaryEdge(clientX, clientY) {
  if (!animation || !boundaryCheck.checked) return null;
  const w = animation.size[0];
  const h = animation.size[1];
  const { ax, ay } = clientToAnimSpace(clientX, clientY);
  const threshold = EDGE_HIT / zoom; // scale threshold to animation space

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

const EDGE_CURSORS = {
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  nw: 'nwse-resize', se: 'nwse-resize',
};

function syncSizeInputs() {
  sizeWInput.value = animation.size[0];
  sizeHInput.value = animation.size[1];
  updateSizeDisplay();
}

canvas.addEventListener('pointerdown', (e) => {
  // Check for boundary edge drag first
  const edge = hitTestBoundaryEdge(e.clientX, e.clientY);
  if (edge && e.button === 0) {
    boundaryDragEdge = edge;
    boundaryDragStart = {
      mx: e.clientX, my: e.clientY,
      origW: animation.size[0], origH: animation.size[1],
      origPosX: animation.position[0], origPosY: animation.position[1],
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

  // Boundary drag in progress
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

    animation.size[0] = newW;
    animation.size[1] = newH;
    animation.position[0] = newPosX;
    animation.position[1] = newPosY;
    syncSizeInputs();
    drawCurrentFrame();
    return;
  }

  // Update cursor for boundary edges
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
function populateImagePanel() {
  imageList.innerHTML = '';
  imgRegexInput.value = '';
  animation.image.forEach((img, i) => {
    const li = document.createElement('li');
    li.dataset.filterName = parseImageFileName(img.name).toLowerCase();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      imageFilter[i] = cb.checked;
      drawCurrentFrame();
    });
    // Thumbnail
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

/** For a single-frame sprite, find its first image texture (if any). */
function getSpriteThumbTexture(sp) {
  if (sp.frame.length !== 1) return null;
  const frame0 = sp.frame[0];
  for (const a of frame0.append) {
    if (!a.sprite && a.resource < animation.image.length) {
      const imgDef = animation.image[a.resource];
      return textures.get(imgDef.name) || null;
    }
  }
  return null;
}

function populateSpritePanel() {
  spriteList.innerHTML = '';
  sprRegexInput.value = '';
  animation.sprite.forEach((sp, i) => {
    const li = document.createElement('li');
    li.dataset.spriteIndex = i;
    li.dataset.filterName = (sp.name || 'sprite_' + i).toLowerCase();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      spriteFilter[i] = cb.checked;
      syncSpecialLayerUI();
      drawCurrentFrame();
    });
    // Thumbnail for single-frame sprites
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
    btn.textContent = '▶';
    btn.title = t('sprite.activate.title');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      spriteSelect.value = String(i);
      activateSprite(i);
    });
    li.appendChild(label);
    li.appendChild(info);
    li.appendChild(btn);
    spriteList.appendChild(li);
  });
  // Main sprite entry
  if (animation.mainSprite) {
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
    info.textContent = animation.mainSprite.frame.length + 'f';
    const btn = document.createElement('button');
    btn.className = 'btn-activate';
    btn.textContent = '▶';
    btn.title = t('sprite.activateMain.title');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
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

function highlightActiveSpriteInPanel() {
  const key = activeSpriteIndex === -1 ? 'main' : String(activeSpriteIndex);
  for (const li of spriteList.children) {
    li.classList.toggle('active-sprite', li.dataset.spriteIndex === key);
  }
}

// Image filter: select all / none
document.getElementById('btn-img-all').addEventListener('click', () => {
  imageFilter.fill(true);
  for (const li of imageList.children) li.querySelector('input').checked = true;
  drawCurrentFrame();
});
document.getElementById('btn-img-none').addEventListener('click', () => {
  imageFilter.fill(false);
  for (const li of imageList.children) li.querySelector('input').checked = false;
  drawCurrentFrame();
});

// Sprite filter: select all / none
document.getElementById('btn-spr-all').addEventListener('click', () => {
  spriteFilter.fill(true);
  for (const li of spriteList.children) {
    const cb = li.querySelector('input');
    if (cb) cb.checked = true;
  }
  syncSpecialLayerUI();
  drawCurrentFrame();
});
document.getElementById('btn-spr-none').addEventListener('click', () => {
  spriteFilter.fill(false);
  for (const li of spriteList.children) {
    const cb = li.querySelector('input');
    if (cb) cb.checked = false;
  }
  syncSpecialLayerUI();
  drawCurrentFrame();
});

// ── Special Layer Detection & Controls ──

function detectSpecialLayers() {
  plantCustomLayers = [];
  zombieStateLayers = [];
  groundSwatchLayers = [];

  animation.sprite.forEach((sp, i) => {
    if (!sp.name) return;
    if (sp.name.startsWith('custom_')) plantCustomLayers.push(i);
    if (sp.name === 'ink' || sp.name === 'butter') zombieStateLayers.push(i);
    if (sp.name === 'ground_swatch' || sp.name === 'ground_swatch_plane') groundSwatchLayers.push(i);
  });

  // Plant Custom Layer dropdown
  plantLayerSelect.innerHTML = '';
  if (plantCustomLayers.length > 0) {
    for (const idx of plantCustomLayers) {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = animation.sprite[idx].name.substring(7); // strip "custom_"
      plantLayerSelect.appendChild(opt);
    }
    const noneOpt = document.createElement('option');
    noneOpt.value = 'none';
    noneOpt.textContent = 'none';
    plantLayerSelect.appendChild(noneOpt);
    plantLayerSelect.value = 'none';
    plantLayerSelect.disabled = false;
    // Initially hide all custom_ sprites
    for (const idx of plantCustomLayers) {
      spriteFilter[idx] = false;
      syncSpriteCheckbox(idx, false);
    }
  } else {
    plantLayerSelect.disabled = true;
  }

  // Zombie State Layer dropdown
  zombieStateSelect.innerHTML = '';
  if (zombieStateLayers.length > 0) {
    for (const idx of zombieStateLayers) {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = animation.sprite[idx].name;
      zombieStateSelect.appendChild(opt);
    }
    const noneOpt = document.createElement('option');
    noneOpt.value = 'none';
    noneOpt.textContent = 'none';
    zombieStateSelect.appendChild(noneOpt);
    zombieStateSelect.value = 'none';
    zombieStateSelect.disabled = false;
    // Initially hide all state sprites
    for (const idx of zombieStateLayers) {
      spriteFilter[idx] = false;
      syncSpriteCheckbox(idx, false);
    }
  } else {
    zombieStateSelect.disabled = true;
  }

  // Ground Swatch toggle
  if (groundSwatchLayers.length > 0) {
    groundSwatchCheck.disabled = false;
    const anyVisible = groundSwatchLayers.some(idx => spriteFilter[idx]);
    groundSwatchCheck.checked = anyVisible;
  } else {
    groundSwatchCheck.checked = false;
    groundSwatchCheck.disabled = true;
  }
}

/** Sync the checkbox in the Sprite panel for a given sprite index */
function syncSpriteCheckbox(sprIndex, checked) {
  for (const li of spriteList.children) {
    if (li.dataset.spriteIndex === String(sprIndex)) {
      const cb = li.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = checked;
      break;
    }
  }
}

/** Apply mutually-exclusive layer selection */
function applyExclusiveLayer(layerIndices, selectedIdx) {
  for (const idx of layerIndices) {
    const show = idx === selectedIdx;
    spriteFilter[idx] = show;
    syncSpriteCheckbox(idx, show);
  }
  drawCurrentFrame();
}

/** Sync the special layer dropdowns/checkbox to reflect current spriteFilter state */
function syncSpecialLayerUI() {
  // Plant custom layer
  if (plantCustomLayers.length > 0) {
    const visible = plantCustomLayers.filter(i => spriteFilter[i]);
    if (visible.length === 0) plantLayerSelect.value = 'none';
    else if (visible.length === 1) plantLayerSelect.value = String(visible[0]);
    // else multiple → leave as-is (indeterminate)
  }
  // Zombie state layer
  if (zombieStateLayers.length > 0) {
    const visible = zombieStateLayers.filter(i => spriteFilter[i]);
    if (visible.length === 0) zombieStateSelect.value = 'none';
    else if (visible.length === 1) zombieStateSelect.value = String(visible[0]);
  }
  // Ground swatch
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
function applyRegexFilter(input, listEl) {
  const pattern = input.value.trim();
  if (!pattern) {
    input.classList.remove('regex-error');
    for (const li of listEl.children) li.classList.remove('regex-hidden');
    return;
  }
  try {
    const re = new RegExp(pattern, 'i');
    input.classList.remove('regex-error');
    for (const li of listEl.children) {
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
function initResizeHandle(handle, panel, side) {
  let startX, startWidth;
  const onPointerMove = (e) => {
    const delta = side === 'left' ? (e.clientX - startX) : (startX - e.clientX);
    const newWidth = Math.max(120, Math.min(500, startWidth + delta));
    panel.style.width = newWidth + 'px';
    requestAnimationFrame(resizeCanvas);
  };
  const onPointerUp = (e) => {
    handle.classList.remove('dragging');
    handle.releasePointerCapture(e.pointerId);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerUp);
  };
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = panel.getBoundingClientRect().width;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
  });
}

initResizeHandle(resizeHandleLeft, panelImages, 'left');
initResizeHandle(resizeHandleRight, panelSprites, 'right');

// Panel visibility toggles
function setPanelVisible(which, visible) {
  const panel = which === 'images' ? panelImages : panelSprites;
  const btn = which === 'images' ? btnToggleImages : btnToggleSprites;
  panel.classList.toggle('hidden', !visible);
  btn.classList.toggle('active', visible);
}

btnToggleImages.addEventListener('click', () => {
  const show = panelImages.classList.contains('hidden');
  setPanelVisible('images', show);
  saveSettings();
  // Resize canvas after panel toggle
  requestAnimationFrame(resizeCanvas);
});

btnToggleSprites.addEventListener('click', () => {
  const show = panelSprites.classList.contains('hidden');
  setPanelVisible('sprites', show);
  saveSettings();
  requestAnimationFrame(resizeCanvas);
});

// ── Rendering ──
function drawCurrentFrame() {
  if (!animation || !activeSprite) return;

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Camera: center + pan + zoom
  const cx = canvas.width / 2 + panX * dpr;
  const cy = canvas.height / 2 + panY * dpr;
  const s = zoom;
  const originX = animation.position[0];
  const originY = animation.position[1];

  const baseMatrix = [s, 0, 0, s, cx, cy];
  const baseColor = { r: 1, g: 1, b: 1, a: 1 };

  renderFrame(
    ctx, animation, textures, spriteTimelines,
    activeSpriteIndex, currentFrame,
    baseMatrix, baseColor,
    imageFilter, spriteFilter,
  );

  // Boundary box
  if (boundaryCheck.checked) {
    const bw = animation.size[0];
    const bh = animation.size[1];
    ctx.setTransform(s, 0, 0, s, cx, cy);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.5)';
    ctx.lineWidth = 1 / s;
    ctx.strokeRect(-originX, -originY, bw, bh);

    // Draw drag handles at corners and edge midpoints
    const handleSize = 5 / s;
    ctx.fillStyle = 'rgba(0, 200, 255, 0.8)';
    const bx = -originX, by = -originY;
    const handles = [
      [bx, by], [bx + bw / 2, by], [bx + bw, by],
      [bx, by + bh / 2], [bx + bw, by + bh / 2],
      [bx, by + bh], [bx + bw / 2, by + bh], [bx + bw, by + bh],
    ];
    for (const [hx, hy] of handles) {
      ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
    }

    // Cross-hair at animation origin
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

// Save on setting changes
loopCheck.addEventListener('change', saveSettings);
reverseCheck.addEventListener('change', saveSettings);
autoplayCheck.addEventListener('change', saveSettings);
keepSpeedCheck.addEventListener('change', saveSettings);

// ── Size controls ──
let sizeAspectLocked = true;

sizeWInput.addEventListener('input', () => {
  if (!animation) return;
  const w = parseInt(sizeWInput.value) || 1;
  if (sizeAspectLocked && animation.size[0] > 0) {
    const ratio = animation.size[1] / animation.size[0];
    sizeHInput.value = Math.round(w * ratio);
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
    sizeWInput.value = Math.round(h * ratio);
  }
  animation.size[0] = parseInt(sizeWInput.value) || 1;
  animation.size[1] = parseInt(sizeHInput.value) || 1;
  updateSizeDisplay();
  drawCurrentFrame();
});

sizeScaleSelect.addEventListener('change', updateSizeDisplay);

// ── Speed preset menu ──
const SPEED_PRESETS = [
  { label: '0.25×', factor: 0.25 },
  { label: '0.5×',  factor: 0.5 },
  { label: '1×',    factor: 1 },
  { label: '1.5×',  factor: 1.5 },
  { label: '2×',    factor: 2 },
  { label: '3×',    factor: 3 },
];

function buildSpeedPresetMenu() {
  speedPresetMenu.innerHTML = '';
  const baseRate = activeSprite?.frameRate ?? animation?.frameRate ?? 30;
  for (const p of SPEED_PRESETS) {
    const btn = document.createElement('button');
    const fps = Math.round(baseRate * p.factor);
    btn.textContent = `${p.label}  (${fps} FPS)`;
    if (parseInt(speedInput.value) === fps) btn.classList.add('active');
    btn.addEventListener('click', () => {
      speedInput.value = fps;
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
  if (!speedPresetMenu.contains(e.target) && e.target !== speedPresetBtn) {
    speedPresetMenu.classList.add('hidden');
  }
});

// ── Export helpers ──
let exportCancelled = false;

/** Render a single frame to an offscreen canvas, applying export scale. */
function renderFrameToCanvas(frameIdx, w, h) {
  const offCanvas = document.createElement('canvas');
  offCanvas.width = w;
  offCanvas.height = h;
  const offCtx = offCanvas.getContext('2d');

  const scale = parseInt(sizeScaleSelect.value) || 1;
  const ox = animation.position[0] * scale;
  const oy = animation.position[1] * scale;
  const baseMatrix = [scale, 0, 0, scale, ox, oy];
  const baseColor = { r: 1, g: 1, b: 1, a: 1 };

  renderFrame(
    offCtx, animation, textures, spriteTimelines,
    activeSpriteIndex, frameIdx,
    baseMatrix, baseColor,
    imageFilter, spriteFilter,
  );
  return offCanvas;
}

function getExportSize() {
  const scale = parseInt(sizeScaleSelect.value) || 1;
  const w = animation.size[0] * scale;
  const h = animation.size[1] * scale;
  return { w: Math.max(w, 1), h: Math.max(h, 1) };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function showExportOverlay(title) {
  exportCancelled = false;
  exportOverlay.querySelector('.export-title').textContent = title;
  exportProgress.value = 0;
  exportStatus.textContent = t('export.preparing');
  exportOverlay.classList.remove('hidden');
}

function hideExportOverlay() {
  exportOverlay.classList.add('hidden');
}

exportCancelBtn.addEventListener('click', () => {
  exportCancelled = true;
});

function getExportName(ext) {
  const base = animName.textContent.replace(/\.pam\.json$/i, '').replace(/\.json$/i, '').replace(/\.pam$/i, '');
  const sprName = activeSpriteIndex === -1 ? 'main' : (animation.sprite[activeSpriteIndex].name || 'sprite_' + activeSpriteIndex);
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

// ── Detect WebP encoding support & hide button on Safari ──
{
  const tc = document.createElement('canvas');
  tc.width = 1; tc.height = 1;
  const du = tc.toDataURL('image/webp');
  if (!du.startsWith('data:image/webp')) {
    btnExportWebp.style.display = 'none';
  }
}

// ── Animated WebP encoder ──

async function extractWebpPayload(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  let pos = 12;
  const parts = [];
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

function writeU32LE(arr, off, val) {
  arr[off] = val & 0xff;
  arr[off+1] = (val >> 8) & 0xff;
  arr[off+2] = (val >> 16) & 0xff;
  arr[off+3] = (val >> 24) & 0xff;
}
function writeU24LE(arr, off, val) {
  arr[off] = val & 0xff;
  arr[off+1] = (val >> 8) & 0xff;
  arr[off+2] = (val >> 16) & 0xff;
}
function writeU16LE(arr, off, val) {
  arr[off] = val & 0xff;
  arr[off+1] = (val >> 8) & 0xff;
}

async function encodeAnimatedWebp(canvasFrames, w, h, fps) {
  const durationMs = Math.round(1000 / fps);
  const framePayloads = [];
  for (const cvs of canvasFrames) {
    const blob = await new Promise(r => cvs.toBlob(r, 'image/webp', 0.9));
    framePayloads.push(await extractWebpPayload(blob));
  }

  const anmfChunks = [];
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

// ── APNG encoder (fallback for Safari) ──

async function extractPngIdat(blob) {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const chunks = [];
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

function apngCrc32(data, start, length) {
  const table = apngCrc32.table || (apngCrc32.table = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c;
    }
    return t;
  })());
  let crc = 0xFFFFFFFF;
  for (let i = start; i < start + length; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeApngChunk(type, data) {
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

async function encodeApng(canvasFrames, w, h, fps) {
  const numFrames = canvasFrames.length;
  const delayNum = 1, delayDen = fps;

  const framePngDatas = [];
  for (const cvs of canvasFrames) {
    const blob = await new Promise(r => cvs.toBlob(r, 'image/png'));
    framePngDatas.push(await extractPngIdat(blob));
  }

  const firstBlob = await new Promise(r => canvasFrames[0].toBlob(r, 'image/png'));
  const firstBuf = await firstBlob.arrayBuffer();
  const firstView = new DataView(firstBuf);
  const ihdrLen = firstView.getUint32(8);
  const ihdrChunk = new Uint8Array(firstBuf, 8, 12 + ihdrLen);

  const parts = [];
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

async function exportAnimCommon(formatLabel, encodeFn, mime, ext) {
  if (!animation || !activeSprite) return;
  showExportOverlay(t('export.exporting', { format: formatLabel }));

  try {
    const { w, h } = getExportSize();
    const begin = frameRange.begin;
    const end = frameRange.end;
    const totalFrames = end - begin + 1;
    const fps = parseInt(speedInput.value, 10) || 30;

    const canvasFrames = [];
    for (let i = 0; i < totalFrames; i++) {
      if (exportCancelled) { hideExportOverlay(); return; }
      const fi = begin + i;
      canvasFrames.push(renderFrameToCanvas(fi, w, h));
      exportProgress.value = ((i + 1) / totalFrames) * 50;
      exportStatus.textContent = t('export.rendering', { current: i + 1, total: totalFrames });
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }

    if (exportCancelled) { hideExportOverlay(); return; }
    exportStatus.textContent = t('export.encoding', { format: formatLabel });
    exportProgress.value = 50;
    await new Promise(r => setTimeout(r, 0));

    const bytes = await encodeFn(canvasFrames, w, h, fps);
    exportProgress.value = 100;

    if (!exportCancelled) {
      const blob = new Blob([bytes], { type: mime });
      downloadBlob(blob, getExportName(ext));
    }
  } catch (e) {
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
  const baseName = animName.textContent.replace(/\.pam\.json$/i, '').replace(/\.json$/i, '').replace(/\.pam$/i, '');
  btnExportFla.disabled = true;
  try {
    const blob = await exportFLA(animation, textures);
    downloadBlob(blob, baseName + '.fla');
  } finally {
    btnExportFla.disabled = false;
  }
});



// ── Keyboard shortcuts ──
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
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
