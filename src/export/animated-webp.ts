import webpEncode, { init as initWebpEncode } from '@jsquash/webp/encode';

let webpWasmReady = false;

export async function initAnimatedWebpEncoder(): Promise<void> {
  await initWebpEncode();
  webpWasmReady = true;
}

async function extractWebpPayload(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const isRIFF = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const isWEBP = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!isRIFF || !isWEBP) {
    throw new Error('Browser returned non-WebP data. WebP export is not supported on this browser.');
  }

  let pos = 12;
  const parts: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const fourCC = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
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
  for (const c of parts) {
    result.set(c, off);
    off += c.length;
  }
  return result;
}

function writeU32LE(arr: Uint8Array, off: number, val: number): void {
  arr[off] = val & 0xff;
  arr[off + 1] = (val >> 8) & 0xff;
  arr[off + 2] = (val >> 16) & 0xff;
  arr[off + 3] = (val >> 24) & 0xff;
}

function writeU24LE(arr: Uint8Array, off: number, val: number): void {
  arr[off] = val & 0xff;
  arr[off + 1] = (val >> 8) & 0xff;
  arr[off + 2] = (val >> 16) & 0xff;
}

function writeU16LE(arr: Uint8Array, off: number, val: number): void {
  arr[off] = val & 0xff;
  arr[off + 1] = (val >> 8) & 0xff;
}

export async function encodeAnimatedWebp(
  canvasFrames: HTMLCanvasElement[],
  w: number,
  h: number,
  fps: number,
): Promise<Uint8Array> {
  if (!webpWasmReady) throw new Error('WebP WASM encoder is not ready.');

  const durationMs = Math.round(1000 / fps);
  const framePayloads: Uint8Array[] = [];
  for (const cvs of canvasFrames) {
    const ctx = cvs.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable.');
    const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height);
    const webpBuf = await webpEncode(imgData, { quality: 90 });
    const blob = new Blob([webpBuf], { type: 'image/webp' });
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
    chunk[0] = 0x41;
    chunk[1] = 0x4e;
    chunk[2] = 0x4d;
    chunk[3] = 0x46;
    writeU32LE(chunk, 4, chunkSize);
    chunk.set(anmfData, 8);
    if (padded) chunk[8 + chunkSize] = 0;
    anmfChunks.push(chunk);
  }

  const vp8x = new Uint8Array(18);
  vp8x[0] = 0x56;
  vp8x[1] = 0x50;
  vp8x[2] = 0x38;
  vp8x[3] = 0x58;
  writeU32LE(vp8x, 4, 10);
  vp8x[8] = 0x12;
  writeU24LE(vp8x, 12, w - 1);
  writeU24LE(vp8x, 15, h - 1);

  const anim = new Uint8Array(14);
  anim[0] = 0x41;
  anim[1] = 0x4e;
  anim[2] = 0x49;
  anim[3] = 0x4d;
  writeU32LE(anim, 4, 6);
  writeU32LE(anim, 8, 0);
  writeU16LE(anim, 12, 0);

  const riffPayloadSize = 4 + vp8x.length + anim.length + anmfChunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(12 + riffPayloadSize - 4);
  result[0] = 0x52;
  result[1] = 0x49;
  result[2] = 0x46;
  result[3] = 0x46;
  writeU32LE(result, 4, result.length - 8);
  result[8] = 0x57;
  result[9] = 0x45;
  result[10] = 0x42;
  result[11] = 0x50;

  let off = 12;
  result.set(vp8x, off);
  off += vp8x.length;
  result.set(anim, off);
  off += anim.length;
  for (const chunk of anmfChunks) {
    result.set(chunk, off);
    off += chunk.length;
  }
  return result;
}
