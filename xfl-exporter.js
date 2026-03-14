// XFL/FLA exporter — converts normalized PAM animation to Adobe Flash XFL format
// Ported from pvz2-toolkit Rust encoder (core/pam/src/xfl/encoder.rs)

import { transformToMatrix } from './model.js';

const XFL_NS = 'http://ns.adobe.com/xfl/2008/';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

function fmt(f) { return f.toFixed(6); }

// ── Minimal XML builder ──
class XmlBuilder {
  constructor() { this.parts = []; this.indent = 0; }
  _pad() { return '\t'.repeat(this.indent); }
  open(tag, attrs = {}) {
    let s = `${this._pad()}<${tag}`;
    for (const [k, v] of Object.entries(attrs)) s += ` ${k}="${escXml(v)}"`;
    s += '>';
    this.parts.push(s);
    this.indent++;
  }
  close(tag) { this.indent--; this.parts.push(`${this._pad()}</${tag}>`); }
  selfClose(tag, attrs = {}) {
    let s = `${this._pad()}<${tag}`;
    for (const [k, v] of Object.entries(attrs)) s += ` ${k}="${escXml(v)}"`;
    s += '/>';
    this.parts.push(s);
  }
  raw(text) { this.parts.push(text); }
  toString() { return this.parts.join('\n'); }
}
function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Transform helpers ──
function toMatrix6(t) { return transformToMatrix(t); }
function matrixAttrs(m) {
  return { a: fmt(m[0]), b: fmt(m[1]), c: fmt(m[2]), d: fmt(m[3]), tx: fmt(m[4]), ty: fmt(m[5]) };
}

// ── Frame node list builder (ported from Rust decode_frame_node_list) ──
function buildFrameNodeList(sprite) {
  const nodeList = new Map(); // layerIdx -> DomFrameData[]
  const model = new Map();    // layerIdx -> ElementData
  const totalFrames = sprite.frame.length;

  // Layer 0: empty container spanning all frames
  nodeList.set(0, [{ startFrame: 0, duration: totalFrames, element: null }]);

  for (let i = 0; i < totalFrames; i++) {
    const frame = sprite.frame[i];

    // Removes
    for (const rm of frame.remove) {
      const m = model.get(rm.index);
      if (m) m.state = 'removed';
    }

    // Appends
    for (const ap of frame.append) {
      model.set(ap.index, {
        state: null,
        resource: ap.resource,
        isSprite: ap.sprite,
        transform: [1, 0, 0, 1, 0, 0],
        color: [1, 1, 1, 1],
        frameStart: i,
        frameDuration: i,
      });
      const layerIdx = ap.index + 1;
      if (!nodeList.has(layerIdx)) nodeList.set(layerIdx, []);
      if (i > 0) {
        nodeList.get(layerIdx).push({ startFrame: 0, duration: i, element: null });
      }
    }

    // Changes
    for (const ch of frame.change) {
      const layer = model.get(ch.index);
      if (!layer) continue;
      layer.state = 'changed';
      layer.transform = toMatrix6(ch.transform);
      if (ch.color && (ch.color.r !== 0 || ch.color.g !== 0)) {
        layer.color = [ch.color.r, ch.color.g, ch.color.b, ch.color.a];
      }
    }

    // Flush
    const keysToRemove = [];
    for (const [layerIndex, layer] of model) {
      const nl = nodeList.get(layerIndex + 1) || [];
      if (!nodeList.has(layerIndex + 1)) nodeList.set(layerIndex + 1, nl);

      if (layer.state !== null && nl.length > 0) {
        nl[nl.length - 1].duration = layer.frameDuration;
      }

      if (layer.state === 'changed') {
        nl.push({
          startFrame: i,
          duration: 0,
          element: {
            resource: layer.resource,
            isSprite: layer.isSprite,
            transform: [...layer.transform],
            color: [...layer.color],
          },
        });
        layer.state = null;
        layer.frameDuration = 0;
      }

      if (layer.state === 'removed') {
        keysToRemove.push(layerIndex);
      }

      layer.frameDuration++;
    }
    for (const k of keysToRemove) model.delete(k);
  }

  // Close remaining
  for (const [layerIndex, layer] of model) {
    const nl = nodeList.get(layerIndex + 1);
    if (nl && nl.length > 0) {
      nl[nl.length - 1].duration = layer.frameDuration;
    }
  }

  return nodeList;
}

// ── Generate source_N.xml ──
function genSource(index, image, resolution) {
  const x = new XmlBuilder();
  const name = `source/source_${index + 1}`;
  const mediaName = `media/${image.name.split('|')[0]}`;
  const scale = fmt(1200 / resolution);

  x.open('DOMSymbolItem', { 'xmlns:xsi': XSI_NS, xmlns: XFL_NS, name, symbolType: 'graphic' });
  x.open('timeline');
  x.open('DOMTimeline', { name: `source_${index + 1}` });
  x.open('layers');
  x.open('DOMLayer', { name: 'Layer 1' });
  x.open('frames');
  x.open('DOMFrame', { index: '0', keyMode: '9728' });
  x.open('elements');
  x.open('DOMBitmapInstance', { libraryItemName: mediaName });
  x.open('matrix');
  x.selfClose('Matrix', { a: scale, d: scale });
  x.close('matrix');
  x.close('DOMBitmapInstance');
  x.close('elements');
  x.close('DOMFrame');
  x.close('frames');
  x.close('DOMLayer');
  x.close('layers');
  x.close('DOMTimeline');
  x.close('timeline');
  x.close('DOMSymbolItem');
  return x.toString();
}

// ── Generate image_N.xml ──
function genImage(index, image) {
  const x = new XmlBuilder();
  const name = `image/image_${index + 1}`;
  const sourceName = `source/source_${index + 1}`;
  const m = toMatrix6(image.transform);

  x.open('DOMSymbolItem', { 'xmlns:xsi': XSI_NS, xmlns: XFL_NS, name, symbolType: 'graphic' });
  x.open('timeline');
  x.open('DOMTimeline', { name: `image_${index + 1}` });
  x.open('layers');
  x.open('DOMLayer', { name: 'Layer 1' });
  x.open('frames');
  x.open('DOMFrame', { index: '0', keyMode: '9728' });
  x.open('elements');
  x.open('DOMSymbolInstance', { libraryItemName: sourceName });
  x.open('matrix');
  x.selfClose('Matrix', matrixAttrs(m));
  x.close('matrix');
  x.close('DOMSymbolInstance');
  x.close('elements');
  x.close('DOMFrame');
  x.close('frames');
  x.close('DOMLayer');
  x.close('layers');
  x.close('DOMTimeline');
  x.close('timeline');
  x.close('DOMSymbolItem');
  return x.toString();
}

// ── Generate sprite_N.xml or main.xml ──
function genSprite(index, sprite) {
  const isMain = index === -1;
  const name = isMain ? 'main' : `sprite/sprite_${index + 1}`;
  const tlName = isMain ? 'main' : `sprite_${index + 1}`;

  const layers = buildFrameNodeList(sprite);
  const sortedKeys = [...layers.keys()].sort((a, b) => b - a);

  const x = new XmlBuilder();
  x.open('DOMSymbolItem', { 'xmlns:xsi': XSI_NS, xmlns: XFL_NS, name, symbolType: 'graphic' });
  x.open('timeline');
  x.open('DOMTimeline', { name: tlName });
  x.open('layers');

  for (const layerIdx of sortedKeys) {
    x.open('DOMLayer', { name: String(layerIdx) });
    x.open('frames');
    for (const frame of layers.get(layerIdx)) {
      x.open('DOMFrame', { index: String(frame.startFrame), duration: String(frame.duration), keyMode: '9728' });
      x.open('elements');
      if (frame.element) {
        const el = frame.element;
        const libName = el.isSprite
          ? `sprite/sprite_${el.resource + 1}`
          : `image/image_${el.resource + 1}`;

        const attrs = { libraryItemName: libName, symbolType: 'graphic', loop: 'loop' };
        if (el.isSprite) attrs.firstFrame = '0';

        x.open('DOMSymbolInstance', attrs);
        x.open('matrix');
        x.selfClose('Matrix', matrixAttrs(el.transform));
        x.close('matrix');

        const c = el.color;
        if (Math.abs(c[0] - 1) > 0.001 || Math.abs(c[1] - 1) > 0.001 ||
            Math.abs(c[2] - 1) > 0.001 || Math.abs(c[3] - 1) > 0.001) {
          x.open('color');
          x.selfClose('Color', {
            redMultiplier: fmt(c[0]), greenMultiplier: fmt(c[1]),
            blueMultiplier: fmt(c[2]), alphaMultiplier: fmt(c[3]),
          });
          x.close('color');
        }

        x.close('DOMSymbolInstance');
      }
      x.close('elements');
      x.close('DOMFrame');
    }
    x.close('frames');
    x.close('DOMLayer');
  }

  x.close('layers');
  x.close('DOMTimeline');
  x.close('timeline');
  x.close('DOMSymbolItem');
  return x.toString();
}

// ── Generate DOMDocument.xml ──
function genDOMDocument(anim) {
  const mainSprite = anim.mainSprite;
  const totalFrames = mainSprite.frame.length;
  const x = new XmlBuilder();

  x.open('DOMDocument', {
    'xmlns:xsi': XSI_NS, xmlns: XFL_NS,
    width: String(anim.size[0]), height: String(anim.size[1]),
    frameRate: String(anim.frameRate),
    currentTimeline: '1', xflVersion: '2.971',
    creatorInfo: 'Adobe Animate CC', platform: 'Windows',
    versionInfo: 'Saved by Animate Windows 19.0 build 326',
    objectsSnapTo: 'false',
  });

  // Folders
  x.open('folders');
  for (const f of ['image', 'media', 'source', 'sprite']) {
    x.selfClose('DOMFolderItem', { name: f, isExpanded: 'true' });
  }
  x.close('folders');

  // Media
  x.open('media');
  for (const img of anim.image) {
    const n = img.name.split('|')[0];
    x.selfClose('DOMBitmapItem', {
      name: `media/${n}`, href: `media/${n}.png`, bitmapDataHRef: `media/${n}.png`,
    });
  }
  x.close('media');

  // Symbols
  x.open('symbols');
  for (let i = 0; i < anim.image.length; i++) {
    x.selfClose('Include', { href: `source/source_${i + 1}.xml` });
    x.selfClose('Include', { href: `image/image_${i + 1}.xml` });
  }
  for (let i = 0; i < anim.sprite.length; i++) {
    x.selfClose('Include', { href: `sprite/sprite_${i + 1}.xml` });
  }
  x.selfClose('Include', { href: 'LIBRARY/main.xml' });
  x.close('symbols');

  // Timelines (3 layers: flow, command, sprite)
  x.open('timelines');
  x.open('DOMTimeline', { name: 'animation' });
  x.open('layers');

  // --- flow layer ---
  x.open('DOMLayer', { name: 'flow' });
  x.open('frames');
  let prevFlow = -1;
  for (let i = 0; i < totalFrames; i++) {
    const f = mainSprite.frame[i];
    if (f.label != null || f.stop) {
      if (prevFlow + 1 < i) {
        x.selfClose('DOMFrame', { index: String(prevFlow + 1), duration: String(i - (prevFlow + 1)) });
      }
      const attrs = { index: String(i) };
      if (f.label != null) { attrs.name = f.label; attrs.labelType = 'name'; }
      x.open('DOMFrame', attrs);
      x.open('elements'); x.close('elements');
      if (f.stop) {
        x.open('Actionscript');
        x.open('script');
        x.raw('<![CDATA[stop();]]>');
        x.close('script');
        x.close('Actionscript');
      }
      x.close('DOMFrame');
      prevFlow = i;
    }
  }
  if (prevFlow + 1 < totalFrames) {
    x.selfClose('DOMFrame', { index: String(prevFlow + 1), duration: String(totalFrames - (prevFlow + 1)) });
  }
  x.close('frames');
  x.close('DOMLayer');

  // --- command layer ---
  x.open('DOMLayer', { name: 'command' });
  x.open('frames');
  let prevCmd = -1;
  for (let i = 0; i < totalFrames; i++) {
    const f = mainSprite.frame[i];
    if (f.command.length > 0) {
      if (prevCmd + 1 < i) {
        x.selfClose('DOMFrame', { index: String(prevCmd + 1), duration: String(i - (prevCmd + 1)) });
      }
      x.open('DOMFrame', { index: String(i) });
      x.open('Actionscript');
      x.open('script');
      let cdata = '<![CDATA[';
      for (const cmd of f.command) {
        cdata += `fscommand("${cmd.command}", "${cmd.argument}");\n`;
      }
      cdata += ']]>';
      x.raw(cdata);
      x.close('script');
      x.close('Actionscript');
      x.close('DOMFrame');
      prevCmd = i;
    }
  }
  if (prevCmd + 1 < totalFrames) {
    x.selfClose('DOMFrame', { index: String(prevCmd + 1), duration: String(totalFrames - (prevCmd + 1)) });
  }
  x.close('frames');
  x.close('DOMLayer');

  // --- sprite layer ---
  x.open('DOMLayer', { name: 'sprite' });
  x.open('frames');
  x.open('DOMFrame', { index: '0', duration: String(totalFrames) });
  x.open('elements');
  x.selfClose('DOMSymbolInstance', { libraryItemName: 'main', symbolType: 'graphic', loop: 'loop' });
  x.close('elements');
  x.close('DOMFrame');
  x.close('frames');
  x.close('DOMLayer');

  x.close('layers');
  x.close('DOMTimeline');
  x.close('timelines');

  x.close('DOMDocument');
  return x.toString();
}

// ── ZIP writer (Store method, no compression) ──
function buildZip(files) {
  // files: [{name: string, data: Uint8Array}]
  const encoder = new TextEncoder();
  const entries = files.map(f => ({
    name: encoder.encode(f.name),
    data: typeof f.data === 'string' ? encoder.encode(f.data) : f.data,
  }));

  // Calculate sizes
  let offset = 0;
  const headers = [];
  for (const e of entries) {
    headers.push({ offset, nameLen: e.name.length, dataLen: e.data.length });
    offset += 30 + e.name.length + e.data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const e of entries) centralSize += 46 + e.name.length;
  const totalSize = centralStart + centralSize + 22;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let pos = 0;

  // Local file headers + data
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const crc = crc32(e.data);
    view.setUint32(pos, 0x04034b50, true); pos += 4;  // signature
    view.setUint16(pos, 20, true); pos += 2;           // version needed
    view.setUint16(pos, 0, true); pos += 2;            // flags
    view.setUint16(pos, 0, true); pos += 2;            // compression (store)
    view.setUint16(pos, 0, true); pos += 2;            // mod time
    view.setUint16(pos, 0x0021, true); pos += 2;       // mod date
    view.setUint32(pos, crc, true); pos += 4;           // crc32
    view.setUint32(pos, e.data.length, true); pos += 4; // compressed size
    view.setUint32(pos, e.data.length, true); pos += 4; // uncompressed size
    view.setUint16(pos, e.name.length, true); pos += 2; // name length
    view.setUint16(pos, 0, true); pos += 2;             // extra length
    bytes.set(e.name, pos); pos += e.name.length;
    bytes.set(e.data, pos); pos += e.data.length;
  }

  // Central directory
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const h = headers[i];
    const crc = crc32(e.data);
    view.setUint32(pos, 0x02014b50, true); pos += 4;     // signature
    view.setUint16(pos, 20, true); pos += 2;              // version made by
    view.setUint16(pos, 20, true); pos += 2;              // version needed
    view.setUint16(pos, 0, true); pos += 2;               // flags
    view.setUint16(pos, 0, true); pos += 2;               // compression
    view.setUint16(pos, 0, true); pos += 2;               // mod time
    view.setUint16(pos, 0x0021, true); pos += 2;          // mod date
    view.setUint32(pos, crc, true); pos += 4;              // crc32
    view.setUint32(pos, e.data.length, true); pos += 4;   // compressed size
    view.setUint32(pos, e.data.length, true); pos += 4;   // uncompressed size
    view.setUint16(pos, e.name.length, true); pos += 2;   // name length
    view.setUint16(pos, 0, true); pos += 2;               // extra field length
    view.setUint16(pos, 0, true); pos += 2;               // comment length
    view.setUint16(pos, 0, true); pos += 2;               // disk number
    view.setUint16(pos, 0, true); pos += 2;               // internal attrs
    view.setUint32(pos, 0, true); pos += 4;               // external attrs
    view.setUint32(pos, h.offset, true); pos += 4;        // local header offset
    bytes.set(e.name, pos); pos += e.name.length;
  }

  // End of central directory
  view.setUint32(pos, 0x06054b50, true); pos += 4;
  view.setUint16(pos, 0, true); pos += 2;                 // disk number
  view.setUint16(pos, 0, true); pos += 2;                 // disk with CD
  view.setUint16(pos, entries.length, true); pos += 2;    // entries on disk
  view.setUint16(pos, entries.length, true); pos += 2;    // total entries
  view.setUint32(pos, centralSize, true); pos += 4;       // CD size
  view.setUint32(pos, centralStart, true); pos += 4;      // CD offset
  view.setUint16(pos, 0, true); pos += 2;                 // comment length

  return new Uint8Array(buf);
}

// CRC32 lookup table
const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crc32Table[i] = c;
}
function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Public API ──

/**
 * Export animation as an XFL directory (returns file map).
 * @param {object} animation - normalized animation from parseAnimation()
 * @param {number} [resolution=1200] - image resolution
 * @returns {Map<string, string>} filename -> content
 */
export function generateXFL(animation, resolution = 1200) {
  const files = new Map();

  files.set('main.xfl', 'PROXY-CS5');
  files.set('DOMDocument.xml', genDOMDocument(animation));

  for (let i = 0; i < animation.image.length; i++) {
    files.set(`LIBRARY/source/source_${i + 1}.xml`, genSource(i, animation.image[i], resolution));
    files.set(`LIBRARY/image/image_${i + 1}.xml`, genImage(i, animation.image[i]));
  }

  for (let i = 0; i < animation.sprite.length; i++) {
    files.set(`LIBRARY/sprite/sprite_${i + 1}.xml`, genSprite(i, animation.sprite[i]));
  }

  if (animation.mainSprite) {
    files.set('LIBRARY/main.xml', genSprite(-1, animation.mainSprite));
  }

  return files;
}

/**
 * Convert an HTMLImageElement to PNG Uint8Array via offscreen canvas.
 * @param {HTMLImageElement} img
 * @returns {Promise<Uint8Array>}
 */
function imageToPng(img) {
  return new Promise((resolve) => {
    const cvs = document.createElement('canvas');
    cvs.width = img.naturalWidth || img.width;
    cvs.height = img.naturalHeight || img.height;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0);
    cvs.toBlob((blob) => {
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
    }, 'image/png');
  });
}

/**
 * Export animation as an .fla file (ZIP containing XFL).
 * @param {object} animation - normalized animation from parseAnimation()
 * @param {Map<string, HTMLImageElement>} [textures] - loaded textures map (key = img.name)
 * @param {number} [resolution=1200]
 * @returns {Promise<Blob>}
 */
export async function exportFLA(animation, textures = null, resolution = 1200) {
  const xflFiles = generateXFL(animation, resolution);
  const zipEntries = [];
  for (const [name, data] of xflFiles) {
    zipEntries.push({ name, data });
  }

  // Include media PNGs if textures are available
  let hasMedia = false;
  if (textures && textures.size > 0) {
    for (const img of animation.image) {
      const tex = textures.get(img.name);
      if (!tex) continue;
      const mediaName = img.name.split('|')[0];
      const pngData = await imageToPng(tex);
      zipEntries.push({ name: `LIBRARY/media/${mediaName}.png`, data: pngData });
      hasMedia = true;
    }
  }
  if (!hasMedia) {
    zipEntries.push({ name: 'LIBRARY/media/', data: new Uint8Array(0) });
  }

  const zipData = buildZip(zipEntries);
  return new Blob([zipData], { type: 'application/octet-stream' });
}

/**
 * Export animation as XFL directory (download as ZIP with .xfl extension).
 * @param {object} animation
 * @param {Map<string, HTMLImageElement>} [textures]
 * @param {number} [resolution=1200]
 * @returns {Promise<Blob>}
 */
export function exportXFL(animation, textures = null, resolution = 1200) {
  return exportFLA(animation, textures, resolution);
}
