import { transformToMatrix, multiplyMatrix, multiplyColor } from '../model';
import type { Animation, Color, Matrix6, TimelinesMap } from '../types';

// ── Individual layer rendering ──

interface RenderedLayer {
  name: string;
  imageData: ImageData;
  opacity: number;
  compositeOp: string;
}

function collectLayers(
  animation: Animation,
  textures: Map<string, HTMLImageElement>,
  spriteTimelines: TimelinesMap,
  spriteIndex: number,
  frameIndex: number,
  parentMatrix: Matrix6,
  parentColor: Color,
  w: number, h: number,
  out: RenderedLayer[],
): void {
  const timelineKey = spriteIndex === -1 ? 'main' : spriteIndex;
  const timeline = spriteTimelines[timelineKey];
  if (!timeline) return;

  const sprite = spriteIndex === -1
    ? animation.mainSprite
    : animation.sprite[spriteIndex];
  if (!sprite) return;

  const actualFrame = frameIndex % sprite.frame.length;
  const snapshot = timeline[actualFrame];
  if (!snapshot) return;

  for (const layer of snapshot) {
    const worldMatrix = multiplyMatrix(parentMatrix, layer.transform);
    const worldColor = multiplyColor(parentColor, layer.color);

    if (layer.isSprite) {
      const childSprite = layer.resource === animation.sprite.length
        ? animation.mainSprite
        : animation.sprite[layer.resource];
      if (!childSprite) continue;
      const childFrame = ((actualFrame - layer.firstFrame) + layer.preloadFrame) % childSprite.frame.length;
      collectLayers(
        animation, textures, spriteTimelines,
        layer.resource === animation.sprite.length ? -1 : layer.resource,
        childFrame < 0 ? childFrame + childSprite.frame.length : childFrame,
        worldMatrix, worldColor, w, h, out,
      );
    } else {
      const imageDef = animation.image[layer.resource];
      if (!imageDef) continue;
      const texture = textures.get(imageDef.name);
      if (!texture) continue;

      const imgMatrix = transformToMatrix(imageDef.transform);
      const finalMatrix = multiplyMatrix(worldMatrix, imgMatrix);

      const cvs = document.createElement('canvas');
      cvs.width = w; cvs.height = h;
      const ctx = cvs.getContext('2d')!;
      ctx.setTransform(
        finalMatrix[0], finalMatrix[1],
        finalMatrix[2], finalMatrix[3],
        finalMatrix[4], finalMatrix[5],
      );
      const iw = imageDef.size ? imageDef.size.width : texture.naturalWidth;
      const ih = imageDef.size ? imageDef.size.height : texture.naturalHeight;
      ctx.drawImage(texture, 0, 0, iw, ih);

      const imageData = ctx.getImageData(0, 0, w, h);
      if (worldColor.r !== 1 || worldColor.g !== 1 || worldColor.b !== 1 || worldColor.a !== 1) {
        const d = imageData.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i]     = Math.round(d[i]     * worldColor.r);
          d[i + 1] = Math.round(d[i + 1] * worldColor.g);
          d[i + 2] = Math.round(d[i + 2] * worldColor.b);
          d[i + 3] = Math.round(d[i + 3] * worldColor.a);
        }
      }

      out.push({
        name: imageDef.name.replace(/\|.*$/, ''),
        imageData,
        opacity: 1.0,
        compositeOp: layer.additive ? 'addition' : 'normal',
      });
    }
  }
}

// ── LZF compressor (literal-only, compatible with Krita's lzf_decompress) ──

function lzfCompress(input: Uint8Array): Uint8Array {
  const maxLit = 32;
  const out = new Uint8Array(input.length + Math.ceil(input.length / maxLit) + 1);
  let op = 0, ip = 0;
  while (ip < input.length) {
    const n = Math.min(input.length - ip, maxLit);
    out[op++] = n - 1; // literal control byte: 000LLLLL
    out.set(input.subarray(ip, ip + n), op);
    op += n;
    ip += n;
  }
  return out.subarray(0, op);
}

// ── Krita tile data writer ──
// Krita uses 64×64 tiles, pixels in BGRA order, LZF compressed, version 1 format.

const TILE = 64;
const PX = 4; // BGRA

function writeInt32LE(arr: Uint8Array, off: number, val: number): void {
  arr[off]     =  val        & 0xff;
  arr[off + 1] = (val >>> 8) & 0xff;
  arr[off + 2] = (val >>> 16) & 0xff;
  arr[off + 3] = (val >>> 24) & 0xff;
}

function buildTileData(imageData: ImageData, w: number, h: number): Uint8Array {
  const tilesX = Math.ceil(w / TILE);
  const tilesY = Math.ceil(h / TILE);
  const parts: Uint8Array[] = [];

  // Version header (int32 LE = 1)
  const ver = new Uint8Array(4);
  writeInt32LE(ver, 0, 1);
  parts.push(ver);

  const src = imageData.data;
  const tilePixels = new Uint8Array(TILE * TILE * PX);

  for (let row = 0; row < tilesY; row++) {
    for (let col = 0; col < tilesX; col++) {
      tilePixels.fill(0);
      let hasContent = false;

      for (let ty = 0; ty < TILE; ty++) {
        const sy = row * TILE + ty;
        if (sy >= h) break;
        for (let tx = 0; tx < TILE; tx++) {
          const sx = col * TILE + tx;
          if (sx >= w) break;
          const si = (sy * w + sx) * 4;
          const di = (ty * TILE + tx) * PX;
          // Canvas RGBA → Krita BGRA
          tilePixels[di]     = src[si + 2]; // B
          tilePixels[di + 1] = src[si + 1]; // G
          tilePixels[di + 2] = src[si];     // R
          tilePixels[di + 3] = src[si + 3]; // A
          if (src[si + 3] !== 0) hasContent = true;
        }
      }

      if (!hasContent) continue; // skip fully transparent tiles

      const compressed = lzfCompress(tilePixels);

      // Tile header: dataLength(int32), col(int32), row(int32)
      const hdr = new Uint8Array(12);
      writeInt32LE(hdr, 0, compressed.length);
      writeInt32LE(hdr, 4, col);
      writeInt32LE(hdr, 8, row);
      parts.push(hdr);
      parts.push(compressed);
    }
  }

  // End marker: dataLength = 0
  parts.push(new Uint8Array(4));

  let total = 0;
  for (const p of parts) total += p.length;
  const result = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { result.set(p, off); off += p.length; }
  return result;
}

// ── PNG helper for merged image ──

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('Failed to encode PNG'));
      blob.arrayBuffer().then(buf => resolve(new Uint8Array(buf)));
    }, 'image/png');
  });
}

function imageDataToCanvas(imgData: ImageData, w: number, h: number): HTMLCanvasElement {
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  cvs.getContext('2d')!.putImageData(imgData, 0, 0);
  return cvs;
}

// ── CRC32 for ZIP ──

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

// ── ZIP writer (Store method) ──

interface ZipEntry { name: string; data: Uint8Array; }

function buildZip(files: ZipEntry[]): Uint8Array {
  const entries = files.map(f => ({
    name: new TextEncoder().encode(f.name),
    data: f.data,
  }));

  let offset = 0;
  const headers: { offset: number }[] = [];
  for (const e of entries) {
    headers.push({ offset });
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

  for (const e of entries) {
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

  return bytes;
}

// ── XML helpers ──

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── KRA XML generators ──

const IMAGE_NAME = 'pam-export';

function genMaindoc(w: number, h: number, layers: { name: string; filename: string; compositeOp: string; opacity: number }[]): string {
  // Krita XML: top-most layer first
  const layerXml = layers.map(l =>
    `   <layer channelflags="" channellockflags="" colorlabel="0" colorspacename="RGBA" compositeop="${esc(l.compositeOp)}" filename="${esc(l.filename)}" intimeline="1" locked="0" name="${esc(l.name)}" nodetype="paintlayer" onionskin="0" opacity="${Math.round(l.opacity * 255)}" uuid="{${uuid()}}" visible="1" x="0" y="0" collapsed="0"/>`
  ).reverse().join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE DOC PUBLIC '-//KDE//DTD krita 2.0//EN' 'http://www.calligra.org/DTD/krita-2.0.dtd'>
<DOC xmlns="http://www.calligra.org/DTD/krita" syntaxVersion="2.0" kritaVersion="5.2.0">
 <IMAGE colorspacename="RGBA" width="${w}" height="${h}" mime="application/x-krita" name="${IMAGE_NAME}" description="" x-res="72" y-res="72" profile="sRGB-elle-V2-srgbtrc.icc">
  <layers>
${layerXml}
  </layers>
 </IMAGE>
</DOC>`;
}

function genDocumentInfo(): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE document-info PUBLIC '-//KDE//DTD document-info 1.1//EN' 'http://www.calligra.org/DTD/document-info-1.1.dtd'>
<document-info xmlns="http://www.calligra.org/DTD/document-info">
 <about>
  <title>PAM Export</title>
  <creation-date>${now}</creation-date>
  <editing-cycles>1</editing-cycles>
 </about>
 <author/>
</document-info>`;
}

// ── Public export function ──

export async function exportKRA(
  animation: Animation,
  textures: Map<string, HTMLImageElement>,
  spriteTimelines: TimelinesMap,
  spriteIndex: number,
  frameIndex: number,
  w: number,
  h: number,
  scale: number,
): Promise<Blob> {
  const ox = animation.position[0] * scale;
  const oy = animation.position[1] * scale;
  const baseMatrix: Matrix6 = [scale, 0, 0, scale, ox, oy];
  const baseColor: Color = { r: 1, g: 1, b: 1, a: 1 };

  const rendered: RenderedLayer[] = [];
  collectLayers(animation, textures, spriteTimelines, spriteIndex, frameIndex, baseMatrix, baseColor, w, h, rendered);

  const enc = new TextEncoder();
  const entries: ZipEntry[] = [];

  // mimetype must be first entry
  entries.push({ name: 'mimetype', data: enc.encode('application/x-krita') });

  // Layer tile data files (Krita internal format)
  const layerInfos: { name: string; filename: string; compositeOp: string; opacity: number }[] = [];
  const defaultPixel = new Uint8Array(4); // BGRA transparent [0,0,0,0]

  for (let i = 0; i < rendered.length; i++) {
    const rl = rendered[i];
    const layerFile = `layer${i + 1}`;

    // Tile data: <imagename>/layers/<layerfile>
    const tileData = buildTileData(rl.imageData, w, h);
    entries.push({ name: `${IMAGE_NAME}/layers/${layerFile}`, data: tileData });

    // Default pixel: <imagename>/layers/<layerfile>.defaultpixel
    entries.push({ name: `${IMAGE_NAME}/layers/${layerFile}.defaultpixel`, data: defaultPixel });

    layerInfos.push({
      name: rl.name,
      filename: layerFile,
      compositeOp: rl.compositeOp,
      opacity: rl.opacity,
    });
  }

  // Merged image (flattened preview)
  const mergedCvs = document.createElement('canvas');
  mergedCvs.width = w; mergedCvs.height = h;
  const mergedCtx = mergedCvs.getContext('2d')!;
  for (const rl of rendered) {
    const tmpCvs = imageDataToCanvas(rl.imageData, w, h);
    if (rl.compositeOp === 'addition') {
      mergedCtx.globalCompositeOperation = 'lighter';
    } else {
      mergedCtx.globalCompositeOperation = 'source-over';
    }
    mergedCtx.globalAlpha = rl.opacity;
    mergedCtx.drawImage(tmpCvs, 0, 0);
  }
  const mergedPng = await canvasToPngBytes(mergedCvs);
  entries.push({ name: 'mergedimage.png', data: mergedPng });

  // XML metadata
  entries.push({ name: 'maindoc.xml', data: enc.encode(genMaindoc(w, h, layerInfos)) });
  entries.push({ name: 'documentinfo.xml', data: enc.encode(genDocumentInfo()) });

  const zipData = buildZip(entries);
  return new Blob([zipData as BlobPart], { type: 'application/x-krita' });
}
