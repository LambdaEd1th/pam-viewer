import type { Animation, RawPamJson } from '../../domain/types';

export function toRawJson(anim: Animation): RawPamJson {
  const transformToRaw = (t: Animation['image'][0]['transform']): number[] => {
    switch (t.type) {
      case 'translate': return [t.x, t.y];
      case 'rotate_translate': return [t.angle, t.x, t.y];
      case 'matrix_translate': return [t.a, t.b, t.c, t.d, t.x, t.y];
    }
  };

  const imageTransformToRaw = (t: Animation['image'][0]['transform']): number[] => {
    if (anim.version === 1) {
      switch (t.type) {
        case 'translate': return [0, t.x, t.y];
        case 'rotate_translate': return [t.angle, t.x, t.y];
        case 'matrix_translate': return [Math.atan2(t.b, t.a), t.x, t.y];
      }
    }
    switch (t.type) {
      case 'translate': return [1, 0, 0, 1, t.x, t.y];
      case 'rotate_translate': {
        const cos = Math.cos(t.angle);
        const sin = Math.sin(t.angle);
        return [cos, sin, -sin, cos, t.x, t.y];
      }
      case 'matrix_translate': return [t.a, t.b, t.c, t.d, t.x, t.y];
    }
  };

  const frameToRaw = (f: Animation['sprite'][0]['frame'][0]) => {
    const raw: Record<string, unknown> = {};
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
        const entry: Record<string, unknown> = { index: a.index, resource: a.resource, sprite: a.sprite };
        if (a.additive) entry.additive = true;
        if (a.preloadFrame !== 0) entry.preload_frame = a.preloadFrame;
        if (a.name != null) entry.name = a.name;
        if (a.timeScale !== 1.0) entry.time_scale = a.timeScale;
        return entry;
      });
    }
    if (f.change && f.change.length > 0) {
      raw.change = f.change.map(c => {
        const entry: Record<string, unknown> = { index: c.index, transform: transformToRaw(c.transform) };
        if (c.color) entry.color = [c.color.r, c.color.g, c.color.b, c.color.a];
        if (c.spriteFrameNumber != null) entry.sprite_frame_number = c.spriteFrameNumber;
        if (c.sourceRectangle) {
          entry.source_rectangle = {
            position: [c.sourceRectangle[0], c.sourceRectangle[1]],
            size: [c.sourceRectangle[2], c.sourceRectangle[3]],
          };
        }
        return entry;
      });
    }
    return raw;
  };

  const spriteToRaw = (s: Animation['sprite'][0]) => {
    const raw: Record<string, unknown> = {};
    if (anim.version >= 4) {
      raw.name = s.name ?? '';
      raw.frame_rate = s.frameRate ?? 0;
    }
    if (anim.version >= 5) {
      raw.work_area = s.workArea ? [s.workArea.start, s.workArea.duration] : [0, s.frame.length];
    }
    raw.frame = s.frame.map(frameToRaw);
    return raw;
  };

  return {
    version: anim.version,
    frame_rate: anim.frameRate,
    position: anim.position,
    size: anim.size,
    image: anim.image.map(img => {
      const raw: Record<string, unknown> = { name: img.name, transform: imageTransformToRaw(img.transform) };
      if (anim.version >= 4) raw.size = img.size ? [img.size.width, img.size.height] : [0, 0];
      return raw;
    }),
    sprite: anim.sprite.map(spriteToRaw),
    main_sprite: anim.mainSprite ? spriteToRaw(anim.mainSprite) : (anim.version <= 3 ? spriteToRaw({ name: null, frameRate: null, workArea: null, frame: [] }) : null),
  } as unknown as RawPamJson;
}
