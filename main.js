// PAM Viewer — main entry point
// Features: drag-and-drop/button loading, frame slider, zoom/pan,
// image/sprite filter panels, auto-play, settings persistence.

import { parseAnimation, parseImageFileName, parseSpriteFrameLabels } from './model.js';
import { buildAllTimelines, renderFrame } from './renderer.js';
import { decodePAM } from './pam-decoder.js';
import { exportFLA } from './xfl-exporter.js';

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
const btnExportGif = document.getElementById('btn-export-gif');
const btnExportSheet = document.getElementById('btn-export-sheet');
const btnExportFla = document.getElementById('btn-export-fla');
const exportOverlay = document.getElementById('export-overlay');
const exportProgress = document.getElementById('export-progress');
const exportStatus = document.getElementById('export-status');
const exportCancelBtn = document.getElementById('export-cancel');

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
    if (files.length === 0) { statusText.textContent = '未检测到文件'; return; }
    await loadFromFiles(files);
  } catch (err) {
    statusText.textContent = `错误: ${err.message}`;
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
    statusText.textContent = `错误: ${e.message}`;
    console.error(e);
  }
});

// ── Core loading logic ──
async function loadFromFiles(files) {
  statusText.textContent = '加载中…';
  stop();

  let pamJsonFile = files.find(f => /\.pam\.json$/i.test(f.name));
  if (!pamJsonFile) pamJsonFile = files.find(f => /\.json$/i.test(f.name));
  let pamBinFile = files.find(f => /\.pam$/i.test(f.name) && !/\.json$/i.test(f.name));

  if (!pamJsonFile && !pamBinFile) { statusText.textContent = '未找到 .pam 或 .pam.json 文件'; return; }

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

  // Auto-select mainSprite
  if (animation.mainSprite) {
    spriteSelect.value = 'main';
    activateSprite(-1);
  } else if (animation.sprite.length > 0) {
    spriteSelect.value = '0';
    activateSprite(0);
  }

  btnClear.disabled = false;
  statusText.textContent = `已加载: ${sourceFile.name} (${animation.image.length} 图像, ${loaded} 已加载, ${animation.sprite.length} sprite)`;
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

  animName.textContent = '未加载';
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
  statusText.textContent = '拖放包含 .pam.json 和 PNG 的文件夹到画布区域，或点击 📂 加载';

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  labelSelect.innerHTML = '<option value="all">全部帧</option>';
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
  btnExportGif.disabled = !enabled;
  btnExportSheet.disabled = !enabled;
  btnExportFla.disabled = !enabled;
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

canvas.addEventListener('pointerdown', (e) => {
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
  if (!isPanning) return;
  panX = panOriginX + (e.clientX - panStartX);
  panY = panOriginY + (e.clientY - panStartY);
  drawCurrentFrame();
});

canvas.addEventListener('pointerup', (e) => {
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
    btn.title = '激活此 Sprite';
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
    btn.title = '激活 MainSprite';
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

  const baseMatrix = [s, 0, 0, s, cx - originX * s, cy - originY * s];
  const baseColor = { r: 1, g: 1, b: 1, a: 1 };

  renderFrame(
    ctx, animation, textures, spriteTimelines,
    activeSpriteIndex, currentFrame,
    baseMatrix, baseColor,
    imageFilter, spriteFilter,
  );

  // Boundary box
  if (boundaryCheck.checked) {
    ctx.setTransform(s, 0, 0, s, cx - originX * s, cy - originY * s);
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.5)';
    ctx.lineWidth = 1 / s;
    ctx.strokeRect(0, 0, animation.size[0], animation.size[1]);

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

// ── Export helpers ──
let exportCancelled = false;

/** Render a single frame to an offscreen canvas at 1× scale. */
function renderFrameToCanvas(frameIdx, w, h) {
  const offCanvas = document.createElement('canvas');
  offCanvas.width = w;
  offCanvas.height = h;
  const offCtx = offCanvas.getContext('2d');

  // Position = origin offset within the size-area (like CSS padding-left/top)
  const ox = animation.position[0];
  const oy = animation.position[1];
  const baseMatrix = [1, 0, 0, 1, ox, oy];
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
  const w = animation.size[0];
  const h = animation.size[1];
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
  exportStatus.textContent = '准备中…';
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

// ── Export Sprite Sheet ──
btnExportSheet.addEventListener('click', async () => {
  if (!animation || !activeSprite) return;
  showExportOverlay('导出 Sprite Sheet…');

  const { w, h } = getExportSize();
  const begin = frameRange.begin;
  const end = frameRange.end;
  const totalFrames = end - begin + 1;
  const cols = Math.ceil(Math.sqrt(totalFrames));
  const rows = Math.ceil(totalFrames / cols);

  const sheetCanvas = document.createElement('canvas');
  sheetCanvas.width = cols * w;
  sheetCanvas.height = rows * h;
  const sheetCtx = sheetCanvas.getContext('2d');

  for (let i = 0; i < totalFrames; i++) {
    if (exportCancelled) { hideExportOverlay(); return; }
    const fi = begin + i;
    const offCanvas = renderFrameToCanvas(fi, w, h);
    const col = i % cols;
    const row = Math.floor(i / cols);
    sheetCtx.drawImage(offCanvas, col * w, row * h);

    exportProgress.value = ((i + 1) / totalFrames) * 100;
    exportStatus.textContent = `帧 ${i + 1} / ${totalFrames}`;
    // Yield to keep UI responsive
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 0));
  }

  sheetCanvas.toBlob(blob => {
    if (blob && !exportCancelled) downloadBlob(blob, getExportName('sheet.png'));
    hideExportOverlay();
  }, 'image/png');
});

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

// ── Export GIF ──
// Minimal GIF89a encoder (LZW, supports transparency)
function encodeGif(frames, w, h, delayMs) {
  const out = [];
  const write = (v) => out.push(v);
  const writeLE16 = (v) => { out.push(v & 0xff); out.push((v >> 8) & 0xff); };
  const writeStr = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };

  const processedFrames = frames;

  // Build global 256-color palette from all frame pixels.
  // Quantize to 15-bit (5 bits per channel) for frequency counting.
  const freq = new Map(); // 15-bit key → { r, g, b, count }
  for (const frameData of processedFrames) {
    for (let i = 0; i < frameData.length; i += 4) {
      if (frameData[i + 3] === 0) continue; // transparent
      const r5 = frameData[i] >> 3;
      const g5 = frameData[i + 1] >> 3;
      const b5 = frameData[i + 2] >> 3;
      const key = (r5 << 10) | (g5 << 5) | b5;
      const entry = freq.get(key);
      if (entry) { entry.count++; }
      else { freq.set(key, { r: frameData[i], g: frameData[i + 1], b: frameData[i + 2], count: 1 }); }
    }
  }

  // Take top 255 colors by frequency (index 255 reserved for transparency)
  const colors = Array.from(freq.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 255);

  const transparent = 255;
  const palBits = 8;

  // Build palette RGB array and quantized-key → palette-index lookup
  const paletteRGB = new Uint8Array(256 * 3);
  const keyToIndex = new Map();
  for (let i = 0; i < colors.length; i++) {
    keyToIndex.set(colors[i][0], i);
    paletteRGB[i * 3] = colors[i][1].r;
    paletteRGB[i * 3 + 1] = colors[i][1].g;
    paletteRGB[i * 3 + 2] = colors[i][1].b;
  }

  // Map each frame's pixels to palette indices
  const pixelCount = w * h;
  const indexedFrames = [];
  for (const frameData of processedFrames) {
    const indices = new Uint8Array(pixelCount);
    for (let j = 0; j < pixelCount; j++) {
      const off = j * 4;
      if (frameData[off + 3] === 0) {
        indices[j] = transparent;
        continue;
      }
      const r5 = frameData[off] >> 3;
      const g5 = frameData[off + 1] >> 3;
      const b5 = frameData[off + 2] >> 3;
      const key = (r5 << 10) | (g5 << 5) | b5;
      const idx = keyToIndex.get(key);
      if (idx !== undefined) {
        indices[j] = idx;
      } else {
        // Nearest color in palette (rare: only if >255 unique quantized colors)
        const r = frameData[off], g = frameData[off + 1], b = frameData[off + 2];
        let best = 0, bestDist = Infinity;
        for (let k = 0; k < colors.length; k++) {
          const c = colors[k][1];
          const dr = r - c.r, dg = g - c.g, db = b - c.b;
          const d = dr * dr + dg * dg + db * db;
          if (d < bestDist) { bestDist = d; best = k; }
        }
        indices[j] = best;
      }
    }
    indexedFrames.push(indices);
  }

  // ── GIF89a Header ──
  writeStr('GIF89a');
  writeLE16(w);
  writeLE16(h);
  write(0xf0 | (palBits - 1)); // GCT flag, color res, GCT size
  write(0); // background color index
  write(0); // pixel aspect ratio

  // Global Color Table (256 × 3 bytes)
  for (let i = 0; i < paletteRGB.length; i++) write(paletteRGB[i]);

  // Netscape Application Extension (infinite loop)
  write(0x21); write(0xff); write(11);
  writeStr('NETSCAPE2.0');
  write(3); write(1); writeLE16(0); write(0);

  const delayCentiseconds = Math.max(2, Math.round(delayMs / 10));

  for (const indices of indexedFrames) {
    // Graphic Control Extension
    write(0x21); write(0xf9); write(4);
    write(0x09); // dispose: restore to bg + transparent flag
    writeLE16(delayCentiseconds);
    write(transparent);
    write(0);

    // Image Descriptor
    write(0x2c);
    writeLE16(0); writeLE16(0);
    writeLE16(w); writeLE16(h);
    write(0); // no local color table

    // LZW Image Data
    const minCodeSize = palBits;
    write(minCodeSize);
    lzwEncode(indices, minCodeSize, out);
    write(0); // block terminator
  }

  write(0x3b); // GIF trailer
  return new Uint8Array(out);
}

/** LZW compression for GIF */
function lzwEncode(indices, minCodeSize, out) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  const maxTableSize = 4096;

  // Build output as sub-blocks
  let blockBuf = [];
  let bitBuf = 0;
  let bitCount = 0;

  function emitCode(code) {
    bitBuf |= (code << bitCount);
    bitCount += codeSize;
    while (bitCount >= 8) {
      blockBuf.push(bitBuf & 0xff);
      bitBuf >>= 8;
      bitCount -= 8;
      if (blockBuf.length === 255) {
        out.push(255);
        for (let i = 0; i < 255; i++) out.push(blockBuf[i]);
        blockBuf.length = 0;
      }
    }
  }

  function flushBits() {
    if (bitCount > 0) {
      blockBuf.push(bitBuf & 0xff);
      bitBuf = 0;
      bitCount = 0;
    }
    if (blockBuf.length > 0) {
      out.push(blockBuf.length);
      for (let i = 0; i < blockBuf.length; i++) out.push(blockBuf[i]);
      blockBuf.length = 0;
    }
  }

  // Use Map for string table: key = prefix_code + '_' + suffix
  let table = new Map();
  function resetTable() {
    table.clear();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  }

  emitCode(clearCode);
  resetTable();

  if (indices.length === 0) {
    emitCode(eoiCode);
    flushBits();
    return;
  }

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const suffix = indices[i];
    const key = prefix * 256 + suffix;
    if (table.has(key)) {
      prefix = table.get(key);
    } else {
      emitCode(prefix);
      if (nextCode < maxTableSize) {
        table.set(key, nextCode++);
        if (nextCode > (1 << codeSize) && codeSize < 12) {
          codeSize++;
        }
      } else {
        emitCode(clearCode);
        resetTable();
      }
      prefix = suffix;
    }
  }
  emitCode(prefix);
  emitCode(eoiCode);
  flushBits();
}

btnExportGif.addEventListener('click', async () => {
  if (!animation || !activeSprite) return;
  showExportOverlay('导出 GIF…');

  const { w, h } = getExportSize();
  const begin = frameRange.begin;
  const end = frameRange.end;
  const totalFrames = end - begin + 1;
  const fps = parseInt(speedInput.value, 10) || 30;
  const delayMs = 1000 / fps;

  const frameDataList = [];
  for (let i = 0; i < totalFrames; i++) {
    if (exportCancelled) { hideExportOverlay(); return; }
    const fi = begin + i;
    const offCanvas = renderFrameToCanvas(fi, w, h);
    const offCtx = offCanvas.getContext('2d');
    const imgData = offCtx.getImageData(0, 0, w, h);
    frameDataList.push(imgData.data);

    exportProgress.value = ((i + 1) / totalFrames) * 50; // first 50% = rendering
    exportStatus.textContent = `渲染帧 ${i + 1} / ${totalFrames}`;
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
  }

  if (exportCancelled) { hideExportOverlay(); return; }
  exportStatus.textContent = '编码 GIF…';
  exportProgress.value = 50;
  await new Promise(r => setTimeout(r, 0));

  const gifBytes = encodeGif(frameDataList, w, h, delayMs);
  exportProgress.value = 100;

  if (!exportCancelled) {
    const blob = new Blob([gifBytes], { type: 'image/gif' });
    downloadBlob(blob, getExportName('gif'));
  }
  hideExportOverlay();
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
