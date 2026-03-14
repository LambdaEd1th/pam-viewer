// pam-serializer.js — Convert internal animation object back to raw JSON (snake_case)
// and encode to PAM binary format

/**
 * Convert the internal (camelCase) animation object back to the raw JSON structure
 * used by .pam.json files (snake_case).
 * @param {object} anim — internal animation object from parseAnimation()
 * @returns {object} — raw JSON object
 */
export function toRawJson(anim) {
  const transformToRaw = (t) => {
    switch (t.type) {
      case 'translate': return [t.x, t.y];
      case 'rotate_translate': return [t.angle, t.x, t.y];
      case 'matrix_translate': return [t.a, t.b, t.c, t.d, t.x, t.y];
      default: return [t.x, t.y];
    }
  };

  const frameToRaw = (f) => {
    const raw = {};
    if (f.label != null) raw.label = f.label;
    if (f.stop) raw.stop = true;
    if (f.command && f.command.length > 0) {
      raw.command = f.command.map(c => [c.command, c.argument]);
    }
    if (f.remove && f.remove.length > 0) {
      raw.remove = f.remove.map(r => ({ index: r.index }));
    }
    if (f.append && f.append.length > 0) {
      raw.append = f.append.map(a => {
        const entry = { index: a.index, resource: a.resource, sprite: a.sprite };
        if (a.additive) entry.additive = true;
        if (a.preloadFrame !== 0) entry.preload_frame = a.preloadFrame;
        if (a.name != null) entry.name = a.name;
        if (a.timeScale !== 1.0) entry.time_scale = a.timeScale;
        return entry;
      });
    }
    if (f.change && f.change.length > 0) {
      raw.change = f.change.map(c => {
        const entry = { index: c.index, transform: transformToRaw(c.transform) };
        if (c.color) entry.color = [c.color.r, c.color.g, c.color.b, c.color.a];
        if (c.spriteFrameNumber != null) entry.sprite_frame_number = c.spriteFrameNumber;
        if (c.sourceRectangle) entry.source_rectangle = c.sourceRectangle;
        return entry;
      });
    }
    return raw;
  };

  const spriteToRaw = (s) => {
    const raw = {};
    if (s.name != null) raw.name = s.name;
    if (s.frameRate != null) raw.frame_rate = s.frameRate;
    if (s.workArea) raw.work_area = [s.workArea.start, s.workArea.duration];
    raw.frame = s.frame.map(frameToRaw);
    return raw;
  };

  return {
    version: anim.version,
    frame_rate: anim.frameRate,
    position: anim.position,
    size: anim.size,
    image: anim.image.map(img => {
      const raw = { name: img.name, transform: transformToRaw(img.transform) };
      if (img.size) raw.size = [img.size.width, img.size.height];
      return raw;
    }),
    sprite: anim.sprite.map(spriteToRaw),
    main_sprite: anim.mainSprite ? spriteToRaw(anim.mainSprite) : null,
  };
}
