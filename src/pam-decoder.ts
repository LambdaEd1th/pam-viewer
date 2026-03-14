import type { RawPamJson } from './types';

const PAM_MAGIC = 0xBAF01954;

class BinaryReader {
  private view: DataView;
  private offset: number;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
  }

  readU8(): number { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
  readI16(): number { const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  readU16(): number { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  readI32(): number { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  readU32(): number { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  readString(): string {
    const len = this.readU16();
    const bytes = new Uint8Array(this.view.buffer, this.offset, len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }
}

function readCount(r: BinaryReader): number {
  const n = r.readU8();
  return n === 0xFF ? r.readU16() : n;
}

interface RawDecodedImage {
  name: string;
  size: [number, number] | null;
  transform: number[];
}

function readImage(r: BinaryReader, version: number): RawDecodedImage {
  const name = r.readString();
  let size: [number, number] | null = null;
  if (version >= 4) {
    const w = r.readI16();
    const h = r.readI16();
    size = [w, h];
  }

  let transform: number[];
  if (version === 1) {
    const angle = r.readU16() / 1000.0;
    const x = r.readI16() / 20.0;
    const y = r.readI16() / 20.0;
    transform = [angle, x, y];
  } else {
    const a = r.readI32() / 1310720.0;
    const c = r.readI32() / 1310720.0;
    const b = r.readI32() / 1310720.0;
    const d = r.readI32() / 1310720.0;
    const x = r.readI16() / 20.0;
    const y = r.readI16() / 20.0;
    transform = [a, b, c, d, x, y];
  }

  return { name, size, transform };
}

interface RawDecodedFrame {
  label?: string;
  stop?: boolean;
  command?: [string, string][];
  remove?: { index: number }[];
  append?: Record<string, unknown>[];
  change?: Record<string, unknown>[];
}

function readFrame(r: BinaryReader, version: number): RawDecodedFrame {
  const flags = r.readU8();
  const hasRemoves  = (flags & 0x01) !== 0;
  const hasAppends  = (flags & 0x02) !== 0;
  const hasChanges  = (flags & 0x04) !== 0;
  const hasLabel    = (flags & 0x08) !== 0;
  const isStop      = (flags & 0x10) !== 0;
  const hasCommands = (flags & 0x20) !== 0;

  const remove: { index: number }[] = [];
  if (hasRemoves) {
    const count = readCount(r);
    for (let i = 0; i < count; i++) {
      const raw = r.readU16();
      let index = raw & 0x7FF;
      if (index === 0x7FF) index = r.readI32();
      remove.push({ index });
    }
  }

  const append: Record<string, unknown>[] = [];
  if (hasAppends) {
    const count = readCount(r);
    for (let i = 0; i < count; i++) {
      const raw = r.readU16();
      let index = raw & 0x7FF;
      if (index === 0x7FF) index = r.readI32();
      const hasTimeScale    = (raw & 0x0800) !== 0;
      const hasName         = (raw & 0x1000) !== 0;
      const hasPreloadFrame = (raw & 0x2000) !== 0;
      const additive        = (raw & 0x4000) !== 0;
      const sprite          = (raw & 0x8000) !== 0;

      let resource: number;
      if (version >= 6) {
        resource = r.readU8();
        if (resource === 0xFF) resource = r.readU16();
      } else {
        resource = r.readU8();
      }

      const preload_frame = hasPreloadFrame ? r.readU16() : 0;
      const name = hasName ? r.readString() : undefined;
      const time_scale = hasTimeScale ? r.readI32() / 65536.0 : 1.0;

      const entry: Record<string, unknown> = { index, resource, sprite };
      if (additive) entry.additive = true;
      if (preload_frame !== 0) entry.preload_frame = preload_frame;
      if (name !== undefined) entry.name = name;
      if (time_scale !== 1.0) entry.time_scale = time_scale;
      append.push(entry);
    }
  }

  const change: Record<string, unknown>[] = [];
  if (hasChanges) {
    const count = readCount(r);
    for (let i = 0; i < count; i++) {
      const raw = r.readU16();
      let index = raw & 0x3FF;
      if (index === 0x3FF) index = r.readI32();
      const hasAnimFrameNum = (raw & 0x0400) !== 0;
      const longCoords      = (raw & 0x0800) !== 0;
      const hasMatrix       = (raw & 0x1000) !== 0;
      const hasColor        = (raw & 0x2000) !== 0;
      const hasRotate       = (raw & 0x4000) !== 0;
      const hasSrcRect      = (raw & 0x8000) !== 0;

      let transform: number[];
      if (hasMatrix) {
        const a = r.readI32() / 65536.0;
        const c = r.readI32() / 65536.0;
        const b = r.readI32() / 65536.0;
        const d = r.readI32() / 65536.0;
        if (longCoords) {
          transform = [a, b, c, d, r.readI32() / 20.0, r.readI32() / 20.0];
        } else {
          transform = [a, b, c, d, r.readI16() / 20.0, r.readI16() / 20.0];
        }
      } else if (hasRotate) {
        const angle = r.readI16() / 1000.0;
        if (longCoords) {
          transform = [angle, r.readI32() / 20.0, r.readI32() / 20.0];
        } else {
          transform = [angle, r.readI16() / 20.0, r.readI16() / 20.0];
        }
      } else {
        if (longCoords) {
          transform = [r.readI32() / 20.0, r.readI32() / 20.0];
        } else {
          transform = [r.readI16() / 20.0, r.readI16() / 20.0];
        }
      }

      const entry: Record<string, unknown> = { index, transform };

      if (hasSrcRect) {
        entry.source_rectangle = [
          r.readI16() / 20, r.readI16() / 20,
          r.readI16() / 20, r.readI16() / 20,
        ];
      }

      if (hasColor) {
        entry.color = [
          r.readU8() / 255.0, r.readU8() / 255.0,
          r.readU8() / 255.0, r.readU8() / 255.0,
        ];
      }

      if (hasAnimFrameNum) {
        entry.sprite_frame_number = r.readU16();
      }

      change.push(entry);
    }
  }

  const frame: RawDecodedFrame = {};
  if (hasLabel) frame.label = r.readString();
  if (isStop) frame.stop = true;

  if (hasCommands) {
    const count = r.readU8();
    frame.command = [];
    for (let i = 0; i < count; i++) {
      const cmd = r.readString();
      const arg = r.readString();
      frame.command.push([cmd, arg]);
    }
  }

  if (remove.length > 0) frame.remove = remove;
  if (append.length > 0) frame.append = append;
  if (change.length > 0) frame.change = change;

  return frame;
}

interface RawDecodedSprite {
  name?: string;
  frame_rate?: number;
  work_area?: [number, number];
  frame: RawDecodedFrame[];
}

function readSprite(r: BinaryReader, version: number): RawDecodedSprite {
  const sprite: RawDecodedSprite = { frame: [] };

  if (version >= 4) {
    const name = r.readString();
    if (name) sprite.name = name;
  }
  if (version >= 6) {
    r.readString(); // description (unused)
  }
  if (version >= 4) {
    sprite.frame_rate = r.readI32() / 65536.0;
  }

  const frameCount = r.readU16();

  if (version >= 5) {
    const start = r.readU16();
    const duration = r.readU16();
    sprite.work_area = [start, duration];
  }

  for (let i = 0; i < frameCount; i++) {
    sprite.frame.push(readFrame(r, version));
  }

  return sprite;
}

export function decodePAM(buffer: ArrayBuffer): RawPamJson {
  const r = new BinaryReader(buffer);

  const magic = r.readU32();
  if (magic !== PAM_MAGIC) {
    throw new Error(`Invalid PAM file: bad magic 0x${magic.toString(16)} (expected 0xBAF01954)`);
  }

  const version = r.readI32();
  if (version < 1 || version > 6) {
    throw new Error(`Unsupported PAM version: ${version}`);
  }

  const frame_rate = r.readU8();
  const position: [number, number] = [r.readI16() / 20.0, r.readI16() / 20.0];
  const size: [number, number] = [r.readU16() / 20.0, r.readU16() / 20.0];

  const imageCount = r.readU16();
  const image: RawDecodedImage[] = [];
  for (let i = 0; i < imageCount; i++) {
    image.push(readImage(r, version));
  }

  const spriteCount = r.readU16();
  const sprite: RawDecodedSprite[] = [];
  for (let i = 0; i < spriteCount; i++) {
    sprite.push(readSprite(r, version));
  }

  let main_sprite: RawDecodedSprite | null = null;
  if (version <= 3) {
    main_sprite = readSprite(r, version);
  } else {
    const hasMain = r.readU8();
    if (hasMain) {
      main_sprite = readSprite(r, version);
    }
  }

  return {
    version,
    frame_rate,
    position,
    size,
    image,
    sprite,
    main_sprite,
  } as unknown as RawPamJson;
}
