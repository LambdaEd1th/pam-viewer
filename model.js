// PAM animation data model — ported from Twinning's model.dart

/**
 * Parse image file name: strip (…), $prefix, […], |suffix
 * @param {string} value
 * @returns {string}
 */
export function parseImageFileName(value) {
  let result = value;
  const a1 = result.indexOf('(');
  const a2 = result.indexOf(')');
  if (a1 !== -1 || a2 !== -1) {
    result = result.substring(0, a1) + result.substring(a2 + 1);
  }
  const b1 = result.indexOf('$');
  if (b1 !== -1) {
    result = result.substring(b1 + 1);
  }
  const c1 = result.indexOf('[');
  const c2 = result.indexOf(']');
  if (c1 !== -1 || c2 !== -1) {
    result = result.substring(0, c1) + result.substring(c2 + 1);
  }
  const d1 = result.indexOf('|');
  if (d1 !== -1) {
    result = result.substring(0, d1);
  }
  return result;
}

/**
 * Parse variant transform from array.
 * length 2 → translate, 3 → rotate+translate, 6 → full matrix
 * @param {number[]} list
 * @returns {{type: string, values: number[]}}
 */
export function parseTransform(list) {
  switch (list.length) {
    case 2: return { type: 'translate', x: list[0], y: list[1] };
    case 3: return { type: 'rotate_translate', angle: list[0], x: list[1], y: list[2] };
    case 6: return { type: 'matrix_translate', a: list[0], b: list[1], c: list[2], d: list[3], x: list[4], y: list[5] };
    default: throw new Error(`Invalid transform length: ${list.length}`);
  }
}

/**
 * Build a 2D affine matrix [a,b,c,d,tx,ty] from a variant transform.
 * Returns a DOMMatrix-compatible 6-element array for ctx.setTransform().
 * @param {object} t
 * @returns {number[]} [a, b, c, d, e, f]
 */
export function transformToMatrix(t) {
  switch (t.type) {
    case 'translate':
      return [1, 0, 0, 1, t.x, t.y];
    case 'rotate_translate': {
      const cos = Math.cos(t.angle);
      const sin = Math.sin(t.angle);
      return [cos, sin, -sin, cos, t.x, t.y];
    }
    case 'matrix_translate':
      return [t.a, t.b, t.c, t.d, t.x, t.y];
    default:
      return [1, 0, 0, 1, 0, 0];
  }
}

/**
 * Multiply two 2D affine matrices represented as [a,b,c,d,e,f].
 * @param {number[]} p - parent
 * @param {number[]} c - child
 * @returns {number[]}
 */
export function multiplyMatrix(p, c) {
  return [
    p[0] * c[0] + p[2] * c[1],
    p[1] * c[0] + p[3] * c[1],
    p[0] * c[2] + p[2] * c[3],
    p[1] * c[2] + p[3] * c[3],
    p[0] * c[4] + p[2] * c[5] + p[4],
    p[1] * c[4] + p[3] * c[5] + p[5],
  ];
}

/**
 * Multiply two RGBA color tints (each component 0..1).
 * @param {{r:number,g:number,b:number,a:number}} parent
 * @param {{r:number,g:number,b:number,a:number}} child
 * @returns {{r:number,g:number,b:number,a:number}}
 */
export function multiplyColor(parent, child) {
  return {
    r: parent.r * child.r,
    g: parent.g * child.g,
    b: parent.b * child.b,
    a: parent.a * child.a,
  };
}

/**
 * Parse a .pam.json object into a normalized Animation structure.
 * @param {object} json
 * @returns {object}
 */
export function parseAnimation(json) {
  const parseFrame = (f) => ({
    label: f.label ?? null,
    stop: f.stop ?? false,
    command: (f.command ?? []).map(c => ({ command: c[0], argument: c[1] })),
    remove: (f.remove ?? []).map(r => ({ index: r.index })),
    append: (f.append ?? []).map(a => ({
      index: a.index,
      name: a.name ?? null,
      resource: a.resource,
      sprite: a.sprite,
      additive: a.additive ?? false,
      preloadFrame: a.preload_frame ?? 0,
      timeScale: a.time_scale ?? 1.0,
    })),
    change: (f.change ?? []).map(c => ({
      index: c.index,
      transform: parseTransform(c.transform),
      color: c.color ? { r: c.color[0], g: c.color[1], b: c.color[2], a: c.color[3] } : null,
      spriteFrameNumber: c.sprite_frame_number ?? null,
      sourceRectangle: c.source_rectangle ?? null,
    })),
  });

  const parseSprite = (s) => ({
    name: s.name ?? null,
    frameRate: s.frame_rate ?? null,
    workArea: s.work_area ? { start: s.work_area[0], duration: s.work_area[1] } : null,
    frame: (s.frame ?? []).map(parseFrame),
  });

  return {
    version: json.version,
    frameRate: json.frame_rate,
    position: json.position,
    size: json.size,
    image: (json.image ?? []).map(img => ({
      name: img.name,
      size: img.size ? { width: img.size[0], height: img.size[1] } : null,
      transform: parseTransform(img.transform),
    })),
    sprite: (json.sprite ?? []).map(parseSprite),
    mainSprite: json.main_sprite ? parseSprite(json.main_sprite) : null,
  };
}

/**
 * Extract frame labels from a sprite.
 * @param {object} sprite
 * @returns {{name: string, begin: number, end: number}[]}
 */
export function parseSpriteFrameLabels(sprite) {
  const result = [];
  const current = [];
  for (let i = 0; i < sprite.frame.length; i++) {
    const frame = sprite.frame[i];
    if (frame.label != null) {
      current.push({ name: frame.label, begin: i });
    }
    if (frame.stop) {
      for (const item of current) {
        result.push({ name: item.name, begin: item.begin, end: i });
      }
      current.length = 0;
    }
  }
  return result;
}
