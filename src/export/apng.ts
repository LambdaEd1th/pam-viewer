async function extractPngIdat(blob: Blob): Promise<Uint8Array> {
  const buf = await blob.arrayBuffer();
  const view = new DataView(buf);
  const chunks: Uint8Array[] = [];
  let pos = 8;
  while (pos < buf.byteLength) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(
      view.getUint8(pos + 4),
      view.getUint8(pos + 5),
      view.getUint8(pos + 6),
      view.getUint8(pos + 7),
    );
    if (type === 'IDAT') chunks.push(new Uint8Array(buf, pos + 8, len));
    pos += 12 + len;
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    result.set(c, off);
    off += c.length;
  }
  return result;
}

const apngCrc32Table: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function apngCrc32(data: Uint8Array, start: number, length: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < start + length; i++) {
    crc = apngCrc32Table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeApngChunk(type: string, data: Uint8Array): Uint8Array {
  const len = data.length;
  const chunk = new Uint8Array(12 + len);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, len);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  view.setUint32(8 + len, apngCrc32(chunk, 4, 4 + len));
  return chunk;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas PNG export failed.'));
    }, 'image/png');
  });
}

export async function encodeApng(
  canvasFrames: HTMLCanvasElement[],
  w: number,
  h: number,
  fps: number,
): Promise<Uint8Array> {
  const numFrames = canvasFrames.length;
  const delayNum = 1;
  const delayDen = fps;

  const framePngDatas: Uint8Array[] = [];
  for (const cvs of canvasFrames) {
    framePngDatas.push(await extractPngIdat(await canvasToPngBlob(cvs)));
  }

  const firstBuf = await (await canvasToPngBlob(canvasFrames[0])).arrayBuffer();
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
    fctlView.setUint32(0, seqNum++);
    fctlView.setUint32(4, w);
    fctlView.setUint32(8, h);
    fctlView.setUint32(12, 0);
    fctlView.setUint32(16, 0);
    fctlView.setUint16(20, delayNum);
    fctlView.setUint16(22, delayDen);
    fctlData[24] = 0;
    fctlData[25] = 0;
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
  for (const p of parts) {
    result.set(p, off);
    off += p.length;
  }
  return result;
}
