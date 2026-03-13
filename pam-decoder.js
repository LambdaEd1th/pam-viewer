// PAM binary decoder — decodes .pam files into the same JSON structure as .pam.json
// Ported from pvz2-toolkit (Rust), Twinning (C++), and Sen (Dart/C#)

const PAM_MAGIC = 0xBAF01954;

class BinaryReader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
  }
  readU8() { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
  readI16() { const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
  readU16() { const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
  readI32() { const v = this.view.getInt32(this.offset, true); this.offset += 4; return v; }
  readU32() { const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
  readString() {
    const len = this.readU16();
    const bytes = new Uint8Array(this.view.buffer, this.offset, len);
    this.offset += len;
    return new TextDecoder().decode(bytes);
  }
}

function readCount(r) {
  const n = r.readU8();
  return n === 0xFF ? r.readU16() : n;
}

function readImage(r, version) {
  const name = r.readString();
  let size = null;
  if (version >= 4) {
    const w = r.readI16();
    const h = r.readI16();
    size = [w, h];
  }

  let transform;
  if (version === 1) {
    const angle = r.readU16() / 1000.0;
    const x = r.readI16() / 20.0;
    const y = r.readI16() / 20.0;
    transform = [angle, x, y]; // rotate_translate
  } else {
    const a = r.readI32() / 1310720.0;
    const c = r.readI32() / 1310720.0;
    const b = r.readI32() / 1310720.0;
    const d = r.readI32() / 1310720.0;
    const x = r.readI16() / 20.0;
    const y = r.readI16() / 20.0;
    transform = [a, b, c, d, x, y]; // matrix_translate
  }

  return { name, size, transform };
}

function readFrame(r, version) {
  const flags = r.readU8();
  const hasRemoves  = (flags & 0x01) !== 0;
  const hasAppends  = (flags & 0x02) !== 0;
  const hasChanges  = (flags & 0x04) !== 0;
  const hasLabel    = (flags & 0x08) !== 0;
  const isStop      = (flags & 0x10) !== 0;
  const hasCommands = (flags & 0x20) !== 0;

  // Removes
  const remove = [];
  if (hasRemoves) {
    const count = readCount(r);
    for (let i = 0; i < count; i++) {
      const raw = r.readU16();
      let index = raw & 0x7FF;
      if (index === 0x7FF) index = r.readI32();
      remove.push({ index });
    }
  }

  // Appends
  const append = [];
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

      let resource;
      if (version >= 6) {
        resource = r.readU8();
        if (resource === 0xFF) resource = r.readU16();
      } else {
        resource = r.readU8();
      }

      const preload_frame = hasPreloadFrame ? r.readU16() : 0;
      const name = hasName ? r.readString() : undefined;
      const time_scale = hasTimeScale ? r.readI32() / 65536.0 : 1.0;

      const entry = { index, resource, sprite };
      if (additive) entry.additive = true;
      if (preload_frame !== 0) entry.preload_frame = preload_frame;
      if (name !== undefined) entry.name = name;
      if (time_scale !== 1.0) entry.time_scale = time_scale;
      append.push(entry);
    }
  }

  // Changes
  const change = [];
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

      // Transform
      let transform;
      if (hasMatrix) {
        const a = r.readI32() / 65536.0;
        const c = r.readI32() / 65536.0;
        const b = r.readI32() / 65536.0;
        const d = r.readI32() / 65536.0;
        if (longCoords) {
          const x = r.readI32() / 20.0;
          const y = r.readI32() / 20.0;
          transform = [a, b, c, d, x, y];
        } else {
          const x = r.readI16() / 20.0;
          const y = r.readI16() / 20.0;
          transform = [a, b, c, d, x, y];
        }
      } else if (hasRotate) {
        const angle = r.readI16() / 1000.0;
        if (longCoords) {
          const x = r.readI32() / 20.0;
          const y = r.readI32() / 20.0;
          transform = [angle, x, y];
        } else {
          const x = r.readI16() / 20.0;
          const y = r.readI16() / 20.0;
          transform = [angle, x, y];
        }
      } else {
        if (longCoords) {
          const x = r.readI32() / 20.0;
          const y = r.readI32() / 20.0;
          transform = [x, y];
        } else {
          const x = r.readI16() / 20.0;
          const y = r.readI16() / 20.0;
          transform = [x, y];
        }
      }

      const entry = { index, transform };

      if (hasSrcRect) {
        const sx = r.readI16() / 20;
        const sy = r.readI16() / 20;
        const sw = r.readI16() / 20;
        const sh = r.readI16() / 20;
        entry.source_rectangle = [sx, sy, sw, sh];
      }

      if (hasColor) {
        const cr = r.readU8() / 255.0;
        const cg = r.readU8() / 255.0;
        const cb = r.readU8() / 255.0;
        const ca = r.readU8() / 255.0;
        entry.color = [cr, cg, cb, ca];
      }

      if (hasAnimFrameNum) {
        entry.sprite_frame_number = r.readU16();
      }

      change.push(entry);
    }
  }

  const frame = {};
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

function readSprite(r, version, globalFrameRate) {
  const sprite = {};

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

  sprite.frame = [];
  for (let i = 0; i < frameCount; i++) {
    sprite.frame.push(readFrame(r, version));
  }

  return sprite;
}

/**
 * Decode a .pam binary buffer into the same JSON structure as .pam.json.
 * @param {ArrayBuffer} buffer
 * @returns {object} — same shape as a parsed .pam.json file
 */
export function decodePAM(buffer) {
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
  const position = [r.readI16() / 20.0, r.readI16() / 20.0];
  const size = [r.readU16() / 20.0, r.readU16() / 20.0];

  const imageCount = r.readU16();
  const image = [];
  for (let i = 0; i < imageCount; i++) {
    image.push(readImage(r, version));
  }

  const spriteCount = r.readU16();
  const sprite = [];
  for (let i = 0; i < spriteCount; i++) {
    sprite.push(readSprite(r, version, frame_rate));
  }

  let main_sprite = null;
  if (version <= 3) {
    main_sprite = readSprite(r, version, frame_rate);
  } else {
    const hasMain = r.readU8() !== 0;
    if (hasMain) {
      main_sprite = readSprite(r, version, frame_rate);
    }
  }

  return { version, frame_rate, position, size, image, sprite, main_sprite };
}
