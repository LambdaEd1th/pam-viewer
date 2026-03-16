import { transformToMatrix, multiplyMatrix, multiplyColor } from '../model';
import type { Animation, Color, Matrix6, TimelinesMap } from '../types';

// ── Individual layer rendering ──

interface RenderedLayer {
  name: string;
  imageData: ImageData;
  opacity: number;
  compositeOp: string;
}

/**
 * Render each visible leaf layer for the given frame into separate ImageData objects.
 * Recursively resolves sprite references just like renderer.ts does.
 */
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
      ctx.globalAlpha = 1;
      const iw = imageDef.size ? imageDef.size.width : texture.naturalWidth;
      const ih = imageDef.size ? imageDef.size.height : texture.naturalHeight;
      ctx.drawImage(texture, 0, 0, iw, ih);

      const imageData = ctx.getImageData(0, 0, w, h);
      // Bake color tint into the pixel data
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

// ── PNG encoder (minimal, uncompressed for per-layer data) ──

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
    view.setUint16(pos, 0, true); pos += 2; // store
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

// ── XML escaping ──

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Unique ID generator ──

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── KRA XML generators ──

function genMaindoc(w: number, h: number, layers: { name: string; filename: string; compositeOp: string; opacity: number }[]): string {
  const layerXml = layers.map(l =>
    `       <layer channelflags="" channellockflags="" colorlabel="0" colorspacename="RGBA" compositeop="${esc(l.compositeOp)}" filename="${esc(l.filename)}" intimeline="1" locked="0" name="${esc(l.name)}" nodetype="paintlayer" onionskin="0" opacity="${Math.round(l.opacity * 255)}" uuid="{${uuid()}}" visible="1" x="0" y="0" collapsed="0"/>`
  ).reverse().join('\n');  // Krita layers: top = first in XML

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE DOC PUBLIC '-//KDE//DTD krita 2.0//EN' 'http://www.calligra.org/DTD/krita-2.0.dtd'>
<DOC xmlns="http://www.calligra.org/DTD/krita" syntaxVersion="2.0" kritaVersion="5.2.0">
 <IMAGE colorspacename="RGBA" width="${w}" height="${h}" mime="application/x-krita" name="pam-export" description="" x-res="72" y-res="72" profile="sRGB-elle-V2-srgbtrc.icc">
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

  // Layer PNGs
  const layerInfos: { name: string; filename: string; compositeOp: string; opacity: number }[] = [];
  for (let i = 0; i < rendered.length; i++) {
    const rl = rendered[i];
    const dirName = `layer${i + 1}`;
    const filename = `${dirName}/data.png`;

    const cvs = imageDataToCanvas(rl.imageData, w, h);
    const pngBytes = await canvasToPngBytes(cvs);
    entries.push({ name: filename, data: pngBytes });

    layerInfos.push({
      name: rl.name,
      filename: dirName,
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

  // XML files
  entries.push({ name: 'maindoc.xml', data: enc.encode(genMaindoc(w, h, layerInfos)) });
  entries.push({ name: 'documentinfo.xml', data: enc.encode(genDocumentInfo()) });

  const zipData = buildZip(entries);
  return new Blob([zipData as BlobPart], { type: 'application/x-krita' });
}
