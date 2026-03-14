import type { RawPamJson } from './types';

const PAM_MAGIC = 0xBAF01954;

class BinaryWriter {
  private chunks: Uint8Array[] = [];
  private buf: ArrayBuffer;
  private view: DataView;
  private offset = 0;

  constructor() {
    this.buf = new ArrayBuffer(4096);
    this.view = new DataView(this.buf);
  }

  private ensure(bytes: number): void {
    if (this.offset + bytes > this.buf.byteLength) {
      this.chunks.push(new Uint8Array(this.buf, 0, this.offset));
      const newSize = Math.max(4096, bytes * 2);
      this.buf = new ArrayBuffer(newSize);
      this.view = new DataView(this.buf);
      this.offset = 0;
    }
  }

  writeU8(v: number): void { this.ensure(1); this.view.setUint8(this.offset, v); this.offset += 1; }
  writeI16(v: number): void { this.ensure(2); this.view.setInt16(this.offset, v, true); this.offset += 2; }
  writeU16(v: number): void { this.ensure(2); this.view.setUint16(this.offset, v, true); this.offset += 2; }
  writeI32(v: number): void { this.ensure(4); this.view.setInt32(this.offset, v, true); this.offset += 4; }
  writeU32(v: number): void { this.ensure(4); this.view.setUint32(this.offset, v, true); this.offset += 4; }

  writeString(s: string): void {
    const bytes = new TextEncoder().encode(s);
    this.writeU16(bytes.length);
    this.ensure(bytes.length);
    new Uint8Array(this.buf, this.offset, bytes.length).set(bytes);
    this.offset += bytes.length;
  }

  toArrayBuffer(): ArrayBuffer {
    this.chunks.push(new Uint8Array(this.buf, 0, this.offset));
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const result = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) { result.set(c, off); off += c.length; }
    return result.buffer;
  }
}

function writeCount(w: BinaryWriter, n: number): void {
  if (n < 0xFF) {
    w.writeU8(n);
  } else {
    w.writeU8(0xFF);
    w.writeU16(n);
  }
}

interface RawImg {
  name: string;
  size?: [number, number] | null;
  transform: number[];
}

function writeImage(w: BinaryWriter, img: RawImg, version: number): void {
  w.writeString(img.name);
  if (version >= 4) {
    w.writeI16(img.size ? img.size[0] : 0);
    w.writeI16(img.size ? img.size[1] : 0);
  }

  const t = img.transform;
  if (version === 1) {
    w.writeU16(Math.round(t[0] * 1000));
    w.writeI16(Math.round(t[1] * 20));
    w.writeI16(Math.round(t[2] * 20));
  } else {
    if (t.length === 6) {
      w.writeI32(Math.round(t[0] * 1310720));
      w.writeI32(Math.round(t[2] * 1310720));
      w.writeI32(Math.round(t[1] * 1310720));
      w.writeI32(Math.round(t[3] * 1310720));
      w.writeI16(Math.round(t[4] * 20));
      w.writeI16(Math.round(t[5] * 20));
    } else if (t.length === 3) {
      const angle = t[0];
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      w.writeI32(Math.round(cos * 1310720));
      w.writeI32(Math.round(-sin * 1310720));
      w.writeI32(Math.round(sin * 1310720));
      w.writeI32(Math.round(cos * 1310720));
      w.writeI16(Math.round(t[1] * 20));
      w.writeI16(Math.round(t[2] * 20));
    } else {
      w.writeI32(Math.round(1.0 * 1310720));
      w.writeI32(0);
      w.writeI32(0);
      w.writeI32(Math.round(1.0 * 1310720));
      w.writeI16(Math.round(t[0] * 20));
      w.writeI16(Math.round(t[1] * 20));
    }
  }
}

function needsLongCoords(transform: number[]): boolean {
  const x = transform[transform.length - 2];
  const y = transform[transform.length - 1];
  const xVal = Math.round(x * 20);
  const yVal = Math.round(y * 20);
  return xVal < -32768 || xVal > 32767 || yVal < -32768 || yVal > 32767;
}

interface RawFrameEnc {
  label?: string | null;
  stop?: boolean;
  command?: [string, string][];
  remove?: { index: number }[];
  append?: {
    index: number;
    resource: number;
    sprite: boolean;
    additive?: boolean;
    preload_frame?: number;
    name?: string;
    time_scale?: number;
  }[];
  change?: {
    index: number;
    transform: number[];
    color?: number[];
    sprite_frame_number?: number;
    source_rectangle?: number[];
  }[];
}

function writeFrame(w: BinaryWriter, frame: RawFrameEnc, version: number): void {
  const hasRemoves  = frame.remove && frame.remove.length > 0;
  const hasAppends  = frame.append && frame.append.length > 0;
  const hasChanges  = frame.change && frame.change.length > 0;
  const hasLabel    = frame.label != null;
  const isStop      = frame.stop === true;
  const hasCommands = frame.command && frame.command.length > 0;

  let flags = 0;
  if (hasRemoves)  flags |= 0x01;
  if (hasAppends)  flags |= 0x02;
  if (hasChanges)  flags |= 0x04;
  if (hasLabel)    flags |= 0x08;
  if (isStop)      flags |= 0x10;
  if (hasCommands) flags |= 0x20;
  w.writeU8(flags);

  if (hasRemoves) {
    writeCount(w, frame.remove!.length);
    for (const r of frame.remove!) {
      if (r.index >= 0x7FF) {
        w.writeU16(0x7FF);
        w.writeI32(r.index);
      } else {
        w.writeU16(r.index);
      }
    }
  }

  if (hasAppends) {
    writeCount(w, frame.append!.length);
    for (const a of frame.append!) {
      const hasTimeScale    = a.time_scale !== undefined && a.time_scale !== 1.0;
      const hasName         = a.name !== undefined;
      const hasPreloadFrame = a.preload_frame !== undefined && a.preload_frame !== 0;
      const additive        = a.additive === true;
      const sprite          = a.sprite === true;

      let raw = a.index & 0x7FF;
      const needsExtIndex = a.index >= 0x7FF;
      if (needsExtIndex) raw = 0x7FF;
      if (hasTimeScale)    raw |= 0x0800;
      if (hasName)         raw |= 0x1000;
      if (hasPreloadFrame) raw |= 0x2000;
      if (additive)        raw |= 0x4000;
      if (sprite)          raw |= 0x8000;
      w.writeU16(raw);

      if (needsExtIndex) w.writeI32(a.index);

      if (version >= 6) {
        if (a.resource >= 0xFF) {
          w.writeU8(0xFF);
          w.writeU16(a.resource);
        } else {
          w.writeU8(a.resource);
        }
      } else {
        w.writeU8(a.resource);
      }

      if (hasPreloadFrame) w.writeU16(a.preload_frame!);
      if (hasName) w.writeString(a.name!);
      if (hasTimeScale) w.writeI32(Math.round(a.time_scale! * 65536));
    }
  }

  if (hasChanges) {
    writeCount(w, frame.change!.length);
    for (const c of frame.change!) {
      const t = c.transform;
      const isMatrix  = t.length === 6;
      const isRotate  = t.length === 3;
      const longCoords = needsLongCoords(t);
      const hasColor  = c.color !== undefined;
      const hasAnimFrameNum = c.sprite_frame_number !== undefined;
      const hasSrcRect = c.source_rectangle !== undefined;

      let raw = c.index & 0x3FF;
      const needsExtIndex = c.index >= 0x3FF;
      if (needsExtIndex) raw = 0x3FF;
      if (hasAnimFrameNum) raw |= 0x0400;
      if (longCoords)      raw |= 0x0800;
      if (isMatrix)        raw |= 0x1000;
      if (hasColor)        raw |= 0x2000;
      if (isRotate)        raw |= 0x4000;
      if (hasSrcRect)      raw |= 0x8000;
      w.writeU16(raw);

      if (needsExtIndex) w.writeI32(c.index);

      if (isMatrix) {
        w.writeI32(Math.round(t[0] * 65536));
        w.writeI32(Math.round(t[2] * 65536));
        w.writeI32(Math.round(t[1] * 65536));
        w.writeI32(Math.round(t[3] * 65536));
      } else if (isRotate) {
        w.writeI16(Math.round(t[0] * 1000));
      }

      if (longCoords) {
        w.writeI32(Math.round(t[t.length - 2] * 20));
        w.writeI32(Math.round(t[t.length - 1] * 20));
      } else {
        w.writeI16(Math.round(t[t.length - 2] * 20));
        w.writeI16(Math.round(t[t.length - 1] * 20));
      }

      if (hasSrcRect) {
        w.writeI16(Math.round(c.source_rectangle![0] * 20));
        w.writeI16(Math.round(c.source_rectangle![1] * 20));
        w.writeI16(Math.round(c.source_rectangle![2] * 20));
        w.writeI16(Math.round(c.source_rectangle![3] * 20));
      }

      if (hasColor) {
        w.writeU8(Math.round(c.color![0] * 255));
        w.writeU8(Math.round(c.color![1] * 255));
        w.writeU8(Math.round(c.color![2] * 255));
        w.writeU8(Math.round(c.color![3] * 255));
      }

      if (hasAnimFrameNum) {
        w.writeU16(c.sprite_frame_number!);
      }
    }
  }

  if (hasLabel) w.writeString(frame.label!);

  if (hasCommands) {
    w.writeU8(frame.command!.length);
    for (const [cmd, arg] of frame.command!) {
      w.writeString(cmd);
      w.writeString(arg);
    }
  }
}

interface RawSpriteEnc {
  name?: string | null;
  frame_rate?: number | null;
  work_area?: [number, number] | null;
  frame: RawFrameEnc[];
}

function writeSprite(w: BinaryWriter, sprite: RawSpriteEnc, version: number): void {
  if (version >= 4) {
    w.writeString(sprite.name || '');
  }
  if (version >= 6) {
    w.writeString('');
  }
  if (version >= 4) {
    w.writeI32(Math.round((sprite.frame_rate ?? 0) * 65536));
  }

  const frames = sprite.frame || [];
  w.writeU16(frames.length);

  if (version >= 5) {
    const wa = sprite.work_area || [0, frames.length];
    w.writeU16(wa[0]);
    w.writeU16(wa[1]);
  }

  for (const f of frames) {
    writeFrame(w, f, version);
  }
}

export function encodePAM(raw: RawPamJson): ArrayBuffer {
  const w = new BinaryWriter();
  const version = raw.version ?? 6;

  w.writeU32(PAM_MAGIC);
  w.writeI32(version);
  w.writeU8(raw.frame_rate ?? 30);
  w.writeI16(Math.round(raw.position[0] * 20));
  w.writeI16(Math.round(raw.position[1] * 20));
  w.writeU16(Math.round(raw.size[0] * 20));
  w.writeU16(Math.round(raw.size[1] * 20));

  const images = raw.image || [];
  w.writeU16(images.length);
  for (const img of images) {
    writeImage(w, img, version);
  }

  const sprites = raw.sprite || [];
  w.writeU16(sprites.length);
  for (const sp of sprites) {
    writeSprite(w, sp as unknown as RawSpriteEnc, version);
  }

  if (version <= 3) {
    if (raw.main_sprite) {
      writeSprite(w, raw.main_sprite as unknown as RawSpriteEnc, version);
    }
  } else {
    if (raw.main_sprite) {
      w.writeU8(1);
      writeSprite(w, raw.main_sprite as unknown as RawSpriteEnc, version);
    } else {
      w.writeU8(0);
    }
  }

  return w.toArrayBuffer();
}
