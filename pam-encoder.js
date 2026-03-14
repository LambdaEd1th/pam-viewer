// pam-encoder.js — Encode raw PAM JSON to .pam binary format
// Inverse of pam-decoder.js

const PAM_MAGIC = 0xBAF01954;

class BinaryWriter {
  constructor() {
    this.chunks = [];
    this.buf = new ArrayBuffer(4096);
    this.view = new DataView(this.buf);
    this.offset = 0;
  }

  _ensure(bytes) {
    if (this.offset + bytes > this.buf.byteLength) {
      this.chunks.push(new Uint8Array(this.buf, 0, this.offset));
      const newSize = Math.max(4096, bytes * 2);
      this.buf = new ArrayBuffer(newSize);
      this.view = new DataView(this.buf);
      this.offset = 0;
    }
  }

  writeU8(v) { this._ensure(1); this.view.setUint8(this.offset, v); this.offset += 1; }
  writeI16(v) { this._ensure(2); this.view.setInt16(this.offset, v, true); this.offset += 2; }
  writeU16(v) { this._ensure(2); this.view.setUint16(this.offset, v, true); this.offset += 2; }
  writeI32(v) { this._ensure(4); this.view.setInt32(this.offset, v, true); this.offset += 4; }
  writeU32(v) { this._ensure(4); this.view.setUint32(this.offset, v, true); this.offset += 4; }

  writeString(s) {
    const bytes = new TextEncoder().encode(s);
    this.writeU16(bytes.length);
    this._ensure(bytes.length);
    new Uint8Array(this.buf, this.offset, bytes.length).set(bytes);
    this.offset += bytes.length;
  }

  toArrayBuffer() {
    this.chunks.push(new Uint8Array(this.buf, 0, this.offset));
    let total = 0;
    for (const c of this.chunks) total += c.length;
    const result = new Uint8Array(total);
    let off = 0;
    for (const c of this.chunks) { result.set(c, off); off += c.length; }
    return result.buffer;
  }
}

function writeCount(w, n) {
  if (n < 0xFF) {
    w.writeU8(n);
  } else {
    w.writeU8(0xFF);
    w.writeU16(n);
  }
}

function writeImage(w, img, version) {
  w.writeString(img.name);
  if (version >= 4) {
    w.writeI16(img.size ? img.size[0] : 0);
    w.writeI16(img.size ? img.size[1] : 0);
  }

  const t = img.transform;
  if (version === 1) {
    // rotate_translate: [angle, x, y]
    w.writeU16(Math.round(t[0] * 1000));
    w.writeI16(Math.round(t[1] * 20));
    w.writeI16(Math.round(t[2] * 20));
  } else {
    // matrix_translate: [a, b, c, d, x, y]
    if (t.length === 6) {
      w.writeI32(Math.round(t[0] * 1310720)); // a
      w.writeI32(Math.round(t[2] * 1310720)); // c (note: binary order is a,c,b,d)
      w.writeI32(Math.round(t[1] * 1310720)); // b
      w.writeI32(Math.round(t[3] * 1310720)); // d
      w.writeI16(Math.round(t[4] * 20));      // x
      w.writeI16(Math.round(t[5] * 20));      // y
    } else if (t.length === 3) {
      // rotate_translate stored as matrix for version >= 2
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
      // translate only → identity matrix
      w.writeI32(Math.round(1.0 * 1310720));
      w.writeI32(0);
      w.writeI32(0);
      w.writeI32(Math.round(1.0 * 1310720));
      w.writeI16(Math.round(t[0] * 20));
      w.writeI16(Math.round(t[1] * 20));
    }
  }
}

function needsLongCoords(transform) {
  const x = transform[transform.length - 2];
  const y = transform[transform.length - 1];
  const xVal = Math.round(x * 20);
  const yVal = Math.round(y * 20);
  return xVal < -32768 || xVal > 32767 || yVal < -32768 || yVal > 32767;
}

function writeFrame(w, frame, version) {
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

  // Removes
  if (hasRemoves) {
    writeCount(w, frame.remove.length);
    for (const r of frame.remove) {
      if (r.index >= 0x7FF) {
        w.writeU16(0x7FF);
        w.writeI32(r.index);
      } else {
        w.writeU16(r.index);
      }
    }
  }

  // Appends
  if (hasAppends) {
    writeCount(w, frame.append.length);
    for (const a of frame.append) {
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

      if (hasPreloadFrame) w.writeU16(a.preload_frame);
      if (hasName) w.writeString(a.name);
      if (hasTimeScale) w.writeI32(Math.round(a.time_scale * 65536));
    }
  }

  // Changes
  if (hasChanges) {
    writeCount(w, frame.change.length);
    for (const c of frame.change) {
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

      // Transform
      if (isMatrix) {
        w.writeI32(Math.round(t[0] * 65536)); // a
        w.writeI32(Math.round(t[2] * 65536)); // c
        w.writeI32(Math.round(t[1] * 65536)); // b
        w.writeI32(Math.round(t[3] * 65536)); // d
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
        w.writeI16(Math.round(c.source_rectangle[0] * 20));
        w.writeI16(Math.round(c.source_rectangle[1] * 20));
        w.writeI16(Math.round(c.source_rectangle[2] * 20));
        w.writeI16(Math.round(c.source_rectangle[3] * 20));
      }

      if (hasColor) {
        w.writeU8(Math.round(c.color[0] * 255));
        w.writeU8(Math.round(c.color[1] * 255));
        w.writeU8(Math.round(c.color[2] * 255));
        w.writeU8(Math.round(c.color[3] * 255));
      }

      if (hasAnimFrameNum) {
        w.writeU16(c.sprite_frame_number);
      }
    }
  }

  if (hasLabel) w.writeString(frame.label);

  if (hasCommands) {
    w.writeU8(frame.command.length);
    for (const [cmd, arg] of frame.command) {
      w.writeString(cmd);
      w.writeString(arg);
    }
  }
}

function writeSprite(w, sprite, version) {
  if (version >= 4) {
    w.writeString(sprite.name || '');
  }
  if (version >= 6) {
    w.writeString(''); // description (unused)
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

/**
 * Encode a raw PAM JSON object to .pam binary format.
 * @param {object} raw — raw JSON (same structure as decodePAM output)
 * @returns {ArrayBuffer}
 */
export function encodePAM(raw) {
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
    writeSprite(w, sp, version);
  }

  if (version <= 3) {
    if (raw.main_sprite) {
      writeSprite(w, raw.main_sprite, version);
    }
  } else {
    if (raw.main_sprite) {
      w.writeU8(1);
      writeSprite(w, raw.main_sprite, version);
    } else {
      w.writeU8(0);
    }
  }

  return w.toArrayBuffer();
}
