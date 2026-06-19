import { parseImageFileName } from '../../domain/model';
import type { Animation } from '../../domain/types';
import type { ViewerPanelsSnapshot } from '../viewer-bridge';

interface ViewerPanelsSnapshotOptions {
  animation: Animation | null;
  textures: Map<string, HTMLImageElement>;
  activeSpriteIndex: number;
  imageFilter: boolean[];
  spriteFilter: boolean[];
  imageRegex: string;
  spriteRegex: string;
}

function getSpriteThumbTexture(
  animation: Animation,
  textures: Map<string, HTMLImageElement>,
  sp: Animation['sprite'][0],
): HTMLImageElement | null {
  if (sp.frame.length !== 1) return null;
  const frame0 = sp.frame[0];
  for (const a of frame0.append) {
    if (!a.sprite && a.resource < animation.image.length) {
      const imgDef = animation.image[a.resource];
      return textures.get(imgDef.name) || null;
    }
  }
  return null;
}

export function buildViewerPanelsSnapshot(options: ViewerPanelsSnapshotOptions): ViewerPanelsSnapshot {
  const {
    animation,
    textures,
    activeSpriteIndex,
    imageFilter,
    spriteFilter,
    imageRegex,
    spriteRegex,
  } = options;

  if (!animation) {
    return { images: [], sprites: [], imageRegex, spriteRegex };
  }

  return {
    imageRegex,
    spriteRegex,
    images: animation.image.map((img, i) => {
      const tex = textures.get(img.name);
      const name = parseImageFileName(img.name);
      return {
        index: i,
        name,
        title: img.name,
        filterName: name.toLowerCase(),
        thumbSrc: tex?.src ?? null,
        sizeText: img.size ? `${img.size.width}\u00d7${img.size.height}` : null,
        checked: imageFilter[i] ?? true,
      };
    }),
    sprites: [
      ...animation.sprite.map((sp, i) => {
        const thumbTex = getSpriteThumbTexture(animation, textures, sp);
        const name = sp.name || 'sprite_' + i;
        return {
          key: String(i),
          spriteIndex: i,
          name,
          filterName: name.toLowerCase(),
          thumbSrc: thumbTex?.src ?? null,
          frameText: sp.frame.length + 'f',
          checked: spriteFilter[i] ?? true,
          active: activeSpriteIndex === i,
          main: false,
        };
      }),
      ...(animation.mainSprite ? [{
        key: 'main',
        spriteIndex: -1,
        name: 'MainSprite',
        filterName: 'mainsprite',
        thumbSrc: null,
        frameText: animation.mainSprite.frame.length + 'f',
        checked: null,
        active: activeSpriteIndex === -1,
        main: true,
      }] : []),
    ],
  };
}
