import { transformToMatrix } from '../model';
import type { Animation, Matrix6 } from '../types';

const XFL_NS = 'http://ns.adobe.com/xfl/2008/';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

function fmt(f: number): string { return f.toFixed(6); }

class XmlBuilder {
  private parts: string[] = [];
  private _indent = 0;
  private _pad(): string { return '\t'.repeat(this._indent); }

  open(tag: string, attrs: Record<string, string | number> = {}): void {
    let s = `${this._pad()}<${tag}`;
    for (const [k, v] of Object.entries(attrs)) s += ` ${k}="${escXml(String(v))}"`;
    s += '>';
    this.parts.push(s);
    this._indent++;
  }

  close(tag: string): void { this._indent--; this.parts.push(`${this._pad()}</${tag}>`); }

  selfClose(tag: string, attrs: Record<string, string | number> = {}): void {
    let s = `${this._pad()}<${tag}`;
    for (const [k, v] of Object.entries(attrs)) s += ` ${k}="${escXml(String(v))}"`;
    s += '/>';
    this.parts.push(s);
  }

  raw(text: string): void { this.parts.push(text); }
  toString(): string { return this.parts.join('\n'); }
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toMatrix6(t: Animation['image'][0]['transform']): Matrix6 { return transformToMatrix(t); }

function matrixAttrs(m: Matrix6): Record<string, string> {
  return { a: fmt(m[0]), b: fmt(m[1]), c: fmt(m[2]), d: fmt(m[3]), tx: fmt(m[4]), ty: fmt(m[5]) };
}

interface DomFrameData {
  startFrame: number;
  duration: number;
  element: {
    resource: number;
    isSprite: boolean;
    transform: Matrix6;
    color: [number, number, number, number];
  } | null;
}

interface ElementData {
  state: string | null;
  resource: number;
  isSprite: boolean;
  transform: Matrix6;
  color: [number, number, number, number];
  frameStart: number;
  frameDuration: number;
}

function buildFrameNodeList(sprite: Animation['sprite'][0]): Map<number, DomFrameData[]> {
  const nodeList = new Map<number, DomFrameData[]>();
  const model = new Map<number, ElementData>();
  const totalFrames = sprite.frame.length;

  nodeList.set(0, [{ startFrame: 0, duration: totalFrames, element: null }]);

  for (let i = 0; i < totalFrames; i++) {
    const frame = sprite.frame[i];

    for (const rm of frame.remove) {
      const m = model.get(rm.index);
      if (m) m.state = 'removed';
    }

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
        nodeList.get(layerIdx)!.push({ startFrame: 0, duration: i, element: null });
      }
    }

    for (const ch of frame.change) {
      const layer = model.get(ch.index);
      if (!layer) continue;
      layer.state = 'changed';
      layer.transform = toMatrix6(ch.transform);
      if (ch.color && (ch.color.r !== 0 || ch.color.g !== 0)) {
        layer.color = [ch.color.r, ch.color.g, ch.color.b, ch.color.a];
      }
    }

    const keysToRemove: number[] = [];
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
            transform: [...layer.transform] as Matrix6,
            color: [...layer.color] as [number, number, number, number],
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

  for (const [layerIndex, layer] of model) {
    const nl = nodeList.get(layerIndex + 1);
    if (nl && nl.length > 0) {
      nl[nl.length - 1].duration = layer.frameDuration;
    }
  }

  return nodeList;
}

function genSource(index: number, image: Animation['image'][0], resolution: number): string {
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

function genImage(index: number, image: Animation['image'][0]): string {
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

function genSprite(index: number, sprite: Animation['sprite'][0]): string {
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
    for (const frame of layers.get(layerIdx)!) {
      x.open('DOMFrame', { index: String(frame.startFrame), duration: String(frame.duration), keyMode: '9728' });
      x.open('elements');
      if (frame.element) {
        const el = frame.element;
        const libName = el.isSprite
          ? `sprite/sprite_${el.resource + 1}`
          : `image/image_${el.resource + 1}`;

        const attrs: Record<string, string> = { libraryItemName: libName, symbolType: 'graphic', loop: 'loop' };
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

function genDOMDocument(anim: Animation): string {
  const mainSprite = anim.mainSprite!;
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

  x.open('folders');
  for (const f of ['image', 'media', 'source', 'sprite']) {
    x.selfClose('DOMFolderItem', { name: f, isExpanded: 'true' });
  }
  x.close('folders');

  x.open('media');
  for (const img of anim.image) {
    const n = img.name.split('|')[0];
    x.selfClose('DOMBitmapItem', {
      name: `media/${n}`, href: `media/${n}.png`, bitmapDataHRef: `media/${n}.png`,
    });
  }
  x.close('media');

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

  x.open('timelines');
  x.open('DOMTimeline', { name: 'animation' });
  x.open('layers');

  // flow layer
  x.open('DOMLayer', { name: 'flow' });
  x.open('frames');
  let prevFlow = -1;
  for (let i = 0; i < totalFrames; i++) {
    const f = mainSprite.frame[i];
    if (f.label != null || f.stop) {
      if (prevFlow + 1 < i) {
        x.selfClose('DOMFrame', { index: String(prevFlow + 1), duration: String(i - (prevFlow + 1)) });
      }
      const attrs: Record<string, string> = { index: String(i) };
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

  // command layer
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

  // sprite layer
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

function genPamSidecar(anim: Animation): string {
  return JSON.stringify({
    schema: 'pam-sidecar-v1',
    version: anim.version,
    frameRate: anim.frameRate,
    position: anim.position,
    size: anim.size,
    imageNames: anim.image.map((img) => img.name),
  }, null, 2);
}

// ── ZIP writer (Store method, no compression) ──

const crc32Table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crc32Table[i] = c;
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) crc = crc32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

interface ZipEntry { name: string; data: string | Uint8Array; }

function buildZip(files: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries = files.map(f => ({
    name: encoder.encode(f.name),
    data: typeof f.data === 'string' ? encoder.encode(f.data) : f.data,
  }));

  let offset = 0;
  const headers: { offset: number; nameLen: number; dataLen: number }[] = [];
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

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const crcVal = crc32(e.data);
    view.setUint32(pos, 0x04034b50, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0x0021, true); pos += 2;
    view.setUint32(pos, crcVal, true); pos += 4;
    view.setUint32(pos, e.data.length, true); pos += 4;
    view.setUint32(pos, e.data.length, true); pos += 4;
    view.setUint16(pos, e.name.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    bytes.set(e.name, pos); pos += e.name.length;
    bytes.set(e.data, pos); pos += e.data.length;
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const h = headers[i];
    const crcVal = crc32(e.data);
    view.setUint32(pos, 0x02014b50, true); pos += 4;
    view.setUint16(pos, 20, true); pos += 2;
    view.setUint16(pos, 20, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0x0021, true); pos += 2;
    view.setUint32(pos, crcVal, true); pos += 4;
    view.setUint32(pos, e.data.length, true); pos += 4;
    view.setUint32(pos, e.data.length, true); pos += 4;
    view.setUint16(pos, e.name.length, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint16(pos, 0, true); pos += 2;
    view.setUint32(pos, 0, true); pos += 4;
    view.setUint32(pos, h.offset, true); pos += 4;
    bytes.set(e.name, pos); pos += e.name.length;
  }

  view.setUint32(pos, 0x06054b50, true); pos += 4;
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, 0, true); pos += 2;
  view.setUint16(pos, entries.length, true); pos += 2;
  view.setUint16(pos, entries.length, true); pos += 2;
  view.setUint32(pos, centralSize, true); pos += 4;
  view.setUint32(pos, centralStart, true); pos += 4;
  view.setUint16(pos, 0, true);

  return new Uint8Array(buf);
}

// ── Public API ──

export function generateXFL(animation: Animation, resolution = 1200): Map<string, string> {
  const files = new Map<string, string>();

  files.set('main.xfl', 'PROXY-CS5');
  files.set('DOMDocument.xml', genDOMDocument(animation));
  files.set('PAM.sidecar.json', genPamSidecar(animation));

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

function imageToPng(img: HTMLImageElement): Promise<Uint8Array> {
  return new Promise((resolve) => {
    const cvs = document.createElement('canvas');
    cvs.width = img.naturalWidth || img.width;
    cvs.height = img.naturalHeight || img.height;
    const ctx = cvs.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    cvs.toBlob((blob) => {
      blob!.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
    }, 'image/png');
  });
}

export async function exportFLA(
  animation: Animation,
  textures: Map<string, HTMLImageElement> | null = null,
  resolution = 1200,
): Promise<Blob> {
  const xflFiles = generateXFL(animation, resolution);
  const zipEntries: ZipEntry[] = [];
  for (const [name, data] of xflFiles) {
    zipEntries.push({ name, data });
  }

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
  return new Blob([zipData as BlobPart], { type: 'application/octet-stream' });
}

export function exportXFL(
  animation: Animation,
  textures: Map<string, HTMLImageElement> | null = null,
  resolution = 1200,
): Promise<Blob> {
  return exportFLA(animation, textures, resolution);
}
