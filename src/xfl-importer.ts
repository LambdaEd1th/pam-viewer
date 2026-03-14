import type { RawPamJson } from './types';

async function readZipAsync(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const files = new Map<string, Uint8Array>();
  let pos = 0;

  while (pos + 4 <= bytes.length) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) break;

    const method = view.getUint16(pos + 8, true);
    const compressedSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const nameBytes = bytes.subarray(pos + 30, pos + 30 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    const dataStart = pos + 30 + nameLen + extraLen;
    const compressedData = bytes.subarray(dataStart, dataStart + compressedSize);

    if (!name.endsWith('/')) {
      if (method === 0) {
        files.set(name, compressedData.slice());
      } else if (method === 8) {
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        writer.write(compressedData);
        writer.close();
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        const result = new Uint8Array(totalLen);
        let off = 0;
        for (const c of chunks) { result.set(c, off); off += c.length; }
        files.set(name, result);
      }
    }

    pos = dataStart + compressedSize;
  }

  return files;
}

// ── XML helpers ──
function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'text/xml');
}

function getAttrF(el: Element, name: string, def = 0): number {
  const v = el.getAttribute(name);
  return v != null ? parseFloat(v) : def;
}

function getAttrI(el: Element, name: string, def = 0): number {
  const v = el.getAttribute(name);
  return v != null ? parseInt(v, 10) : def;
}

interface MainFrameInfo {
  label: string | null;
  stop: boolean;
  command: [string, string][];
}

function parseDOMDocument(xmlText: string): { width: number; height: number; frameRate: number; frames: MainFrameInfo[] } {
  const doc = parseXml(xmlText);
  const root = doc.documentElement;

  const width = getAttrF(root, 'width', 0);
  const height = getAttrF(root, 'height', 0);
  const frameRate = getAttrI(root, 'frameRate', 30);

  const frames: MainFrameInfo[] = [];

  const ensureFrame = (idx: number) => {
    while (frames.length <= idx) {
      frames.push({ label: null, stop: false, command: [] });
    }
  };

  const timelines = root.querySelectorAll('DOMTimeline[name="animation"]');
  if (timelines.length > 0) {
    const tl = timelines[0];
    const layers = tl.querySelectorAll(':scope > layers > DOMLayer');
    for (const layer of layers) {
      const layerName = layer.getAttribute('name') || '';
      if (layerName !== 'flow' && layerName !== 'command') continue;

      const domFrames = layer.querySelectorAll(':scope > frames > DOMFrame');
      for (const df of domFrames) {
        const idx = getAttrI(df, 'index', 0);
        ensureFrame(idx);

        if (layerName === 'flow') {
          const label = df.getAttribute('name');
          if (label) frames[idx].label = label;

          const scripts = df.querySelectorAll('Actionscript script');
          for (const s of scripts) {
            if (s.textContent?.includes('stop()')) {
              frames[idx].stop = true;
            }
          }
        }

        if (layerName === 'command') {
          const scripts = df.querySelectorAll('Actionscript script');
          for (const s of scripts) {
            const text = s.textContent || '';
            const fsRe = /fscommand\("([^"]+)"(?:,\s*"([^"]*)")?\)/g;
            let m;
            while ((m = fsRe.exec(text)) !== null) {
              frames[idx].command.push([m[1], m[2] || '']);
            }
          }
        }
      }
    }
  }

  return { width, height, frameRate, frames };
}

function parseSource(xmlText: string): { name: string; size: [number, number] } | null {
  const doc = parseXml(xmlText);
  const bmpInst = doc.querySelector('DOMBitmapInstance');
  if (!bmpInst) return null;

  const libItem = bmpInst.getAttribute('libraryItemName') || '';
  const name = libItem.replace(/^media\//, '');

  const dimRe = /_(\d+)x(\d+)(?:_\d+)?$/;
  const dimMatch = name.match(dimRe);
  const size: [number, number] = dimMatch ? [parseInt(dimMatch[1]), parseInt(dimMatch[2])] : [0, 0];

  return { name, size };
}

function parseImage(xmlText: string): number[] {
  const doc = parseXml(xmlText);
  const transform = [1, 0, 0, 1, 0, 0];

  const matrix = doc.querySelector('Matrix');
  if (matrix) {
    transform[0] = getAttrF(matrix, 'a', 1);
    transform[1] = getAttrF(matrix, 'b', 0);
    transform[2] = getAttrF(matrix, 'c', 0);
    transform[3] = getAttrF(matrix, 'd', 1);
    transform[4] = getAttrF(matrix, 'tx', 0);
    transform[5] = getAttrF(matrix, 'ty', 0);
  }

  return transform;
}

interface SpriteState {
  resource: number;
  transform: number[];
  color: number[];
  firstFrame: number | null;
}

interface SparseFrame {
  label?: string | null;
  stop?: boolean;
  command?: [string, string][];
  remove: { index: number }[];
  append: { index: number; resource: number; sprite: boolean }[];
  change: { index: number; transform: number[]; color?: number[]; sprite_frame_number?: number }[];
}

function parseSpriteDocument(xmlText: string): { frames: SparseFrame[]; totalFrames: number } {
  const doc = parseXml(xmlText);

  let totalFrames = 0;
  const stateMap = new Map<number, (SpriteState | null)[]>();

  const domLayers = doc.querySelectorAll('DOMLayer');
  for (const layer of domLayers) {
    const layerName = layer.getAttribute('name') || '';
    const zIndex = parseInt(layerName);
    if (isNaN(zIndex)) continue;

    const domFrames = layer.querySelectorAll(':scope > frames > DOMFrame');
    for (const df of domFrames) {
      const startIdx = getAttrI(df, 'index', 0);
      const duration = getAttrI(df, 'duration', 1);
      const endIdx = startIdx + duration;
      if (endIdx > totalFrames) totalFrames = endIdx;

      let state: SpriteState | null = null;
      const symInst = df.querySelector(':scope > elements > DOMSymbolInstance');
      if (symInst) {
        const libItem = symInst.getAttribute('libraryItemName') || '';
        let resourceId = -1;
        const imageMatch = libItem.match(/^image\/image_(\d+)$/);
        const spriteMatch = libItem.match(/^sprite\/sprite_(\d+)$/);
        if (imageMatch) {
          resourceId = parseInt(imageMatch[1]) - 1;
        } else if (spriteMatch) {
          resourceId = parseInt(spriteMatch[1]) - 1 + 10000;
        }

        let firstFrame: number | null = null;
        const ff = symInst.getAttribute('firstFrame');
        if (ff != null) firstFrame = parseInt(ff);

        if (resourceId >= 0) {
          const transform = [1, 0, 0, 1, 0, 0];
          const matrixEl = symInst.querySelector(':scope > matrix > Matrix');
          if (matrixEl) {
            transform[0] = getAttrF(matrixEl, 'a', 1);
            transform[1] = getAttrF(matrixEl, 'b', 0);
            transform[2] = getAttrF(matrixEl, 'c', 0);
            transform[3] = getAttrF(matrixEl, 'd', 1);
            transform[4] = getAttrF(matrixEl, 'tx', 0);
            transform[5] = getAttrF(matrixEl, 'ty', 0);
          }

          const color = [1, 1, 1, 1];
          const colorEl = symInst.querySelector(':scope > color > Color');
          if (colorEl) {
            color[0] = getAttrF(colorEl, 'redMultiplier', 1);
            color[1] = getAttrF(colorEl, 'greenMultiplier', 1);
            color[2] = getAttrF(colorEl, 'blueMultiplier', 1);
            color[3] = getAttrF(colorEl, 'alphaMultiplier', 1);
          }

          state = { resource: resourceId, transform, color, firstFrame };
        }
      }

      if (!stateMap.has(zIndex)) stateMap.set(zIndex, []);
      const tl = stateMap.get(zIndex)!;
      while (tl.length < endIdx) tl.push(null);
      if (state) {
        for (let i = startIdx; i < endIdx; i++) {
          tl[i] = { ...state, transform: [...state.transform], color: [...state.color] };
        }
      }
    }
  }

  const frames: SparseFrame[] = [];
  for (let i = 0; i < totalFrames; i++) {
    frames.push({ remove: [], append: [], change: [] });
  }

  const zKeys = [...stateMap.keys()].sort((a, b) => a - b);

  for (const z of zKeys) {
    const tl = stateMap.get(z)!;
    let prevState: SpriteState | null = null;
    let virtualPrev: SpriteState | null = null;

    for (let t = 0; t < totalFrames; t++) {
      const curr = t < tl.length ? tl[t] : null;

      if (prevState !== null && curr === null) {
        frames[t].remove.push({ index: z });
        virtualPrev = null;
      } else if (prevState === null && curr !== null) {
        frames[t].append.push({
          index: z,
          resource: curr.resource % 10000,
          sprite: curr.resource >= 10000,
        });
        virtualPrev = {
          resource: curr.resource,
          transform: [1, 0, 0, 1, 0, 0],
          color: [1, 1, 1, 1],
          firstFrame: null,
        };
      } else if (prevState !== null && curr !== null && prevState.resource !== curr.resource) {
        frames[t].remove.push({ index: z });
        frames[t].append.push({
          index: z,
          resource: curr.resource % 10000,
          sprite: curr.resource >= 10000,
        });
        virtualPrev = {
          resource: curr.resource,
          transform: [1, 0, 0, 1, 0, 0],
          color: [1, 1, 1, 1],
          firstFrame: null,
        };
      }

      if (curr !== null && virtualPrev !== null) {
        const transformChange = !arrEq(virtualPrev.transform, curr.transform);
        const colorChange = !arrEq(virtualPrev.color, curr.color);
        const frameChange = virtualPrev.firstFrame !== curr.firstFrame;

        if (transformChange || colorChange || frameChange) {
          const change: SparseFrame['change'][0] = {
            index: z,
            transform: [...curr.transform],
          };

          if (!arrEq(curr.color, [1, 1, 1, 1])) {
            change.color = [...curr.color];
          }

          if (curr.firstFrame != null) {
            change.sprite_frame_number = curr.firstFrame;
          }

          frames[t].change.push(change);
        }

        virtualPrev = {
          resource: curr.resource,
          transform: [...curr.transform],
          color: [...curr.color],
          firstFrame: curr.firstFrame,
        };
      }

      prevState = curr;
    }
  }

  return { frames, totalFrames };
}

function arrEq(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-9) return false;
  }
  return true;
}

export interface ImportResult {
  json: RawPamJson;
  mediaPngs: Map<string, Uint8Array>;
}

export async function importFLA(buf: ArrayBuffer): Promise<ImportResult> {
  const zipFiles = await readZipAsync(buf);
  return importXFLFromFiles(zipFiles);
}

export function importXFLFromFiles(files: Map<string, Uint8Array>): ImportResult {
  const decoder = new TextDecoder();

  const getText = (path: string): string | null => {
    if (files.has(path)) return decoder.decode(files.get(path)!);
    for (const [k, v] of files) {
      const normalized = k.replace(/\\/g, '/').replace(/^\//, '');
      if (normalized === path || normalized.endsWith('/' + path)) {
        return decoder.decode(v);
      }
    }
    return null;
  };

  const docXml = getText('DOMDocument.xml');
  if (!docXml) throw new Error('DOMDocument.xml not found in FLA/XFL');
  const { width, height, frameRate, frames: mainFrames } = parseDOMDocument(docXml);

  const idToName = new Map<number, string>();
  const idToSize = new Map<number, [number, number]>();
  for (const [path] of files) {
    const norm = path.replace(/\\/g, '/');
    const m = norm.match(/(?:LIBRARY\/)?source\/source_(\d+)\.xml$/i);
    if (!m) continue;
    const idx = parseInt(m[1]);
    const xml = getText(path);
    if (!xml) continue;
    const info = parseSource(xml);
    if (info) {
      idToName.set(idx, info.name);
      idToSize.set(idx, info.size);
    }
  }

  const imageKeys = [...idToName.keys()].sort((a, b) => a - b);
  const images: { name: string; size: [number, number]; transform: number[] }[] = [];
  for (const idx of imageKeys) {
    const xml = getText(`LIBRARY/image/image_${idx}.xml`);
    const transform = xml ? parseImage(xml) : [1, 0, 0, 1, 0, 0];
    images.push({
      name: idToName.get(idx)!,
      size: idToSize.get(idx)!,
      transform,
    });
  }

  const spriteEntries: { idx: number; path: string }[] = [];
  for (const [path] of files) {
    const norm = path.replace(/\\/g, '/');
    const m = norm.match(/(?:LIBRARY\/)?sprite\/sprite_(\d+)\.xml$/i);
    if (!m) continue;
    spriteEntries.push({ idx: parseInt(m[1]), path });
  }
  spriteEntries.sort((a, b) => a.idx - b.idx);

  const sprites: { frame: Record<string, unknown>[] }[] = [];
  for (const entry of spriteEntries) {
    const xml = getText(entry.path);
    if (!xml) continue;
    const sp = parseSpriteDocument(xml);
    sprites.push({
      frame: sp.frames.map(f => buildRawFrame(f)),
    });
  }

  const mainXml = getText('LIBRARY/main.xml');
  let mainSprite: { frame: Record<string, unknown>[] } | null = null;
  if (mainXml) {
    const mainSp = parseSpriteDocument(mainXml);
    const maxLen = Math.max(mainFrames.length, mainSp.frames.length);

    const mergedFrames: SparseFrame[] = [];
    for (let i = 0; i < maxLen; i++) {
      const flowFrame = i < mainFrames.length ? mainFrames[i] : { label: null, stop: false, command: [] as [string, string][] };
      const animFrame = i < mainSp.frames.length ? mainSp.frames[i] : { remove: [], append: [], change: [] };
      mergedFrames.push({
        ...animFrame,
        label: flowFrame.label,
        stop: flowFrame.stop,
        command: flowFrame.command,
      });
    }

    mainSprite = {
      frame: mergedFrames.map(f => buildRawFrame(f)),
    };
  }

  const mediaPngs = new Map<string, Uint8Array>();
  for (const [path, data] of files) {
    const norm = path.replace(/\\/g, '/');
    const m = norm.match(/(?:LIBRARY\/)?media\/(.+\.png)$/i);
    if (m) {
      mediaPngs.set(m[1].replace(/\.png$/i, ''), data);
    }
  }

  const result: RawPamJson = {
    version: 6,
    frame_rate: frameRate,
    position: [0, 0],
    size: [width, height],
    image: images,
    sprite: sprites,
    main_sprite: mainSprite,
  } as unknown as RawPamJson;

  return { json: result, mediaPngs };
}

function buildRawFrame(f: SparseFrame): Record<string, unknown> {
  const raw: Record<string, unknown> = {};

  if (f.label) raw.label = f.label;
  if (f.stop) raw.stop = true;
  if (f.command && f.command.length > 0) raw.command = f.command;

  if (f.remove && f.remove.length > 0) {
    raw.remove = f.remove.map(r => ({ index: r.index }));
  }

  if (f.append && f.append.length > 0) {
    raw.append = f.append.map(a => ({
      index: a.index,
      resource: a.resource,
      sprite: a.sprite,
    }));
  }

  if (f.change && f.change.length > 0) {
    raw.change = f.change.map(c => {
      const out: Record<string, unknown> = { index: c.index, transform: c.transform };
      if (c.color) out.color = c.color;
      if (c.sprite_frame_number != null) out.sprite_frame_number = c.sprite_frame_number;
      return out;
    });
  }

  return raw;
}
