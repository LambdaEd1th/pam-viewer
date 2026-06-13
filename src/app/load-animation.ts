import * as jsYamlMod from 'js-yaml';
import * as smolTomlMod from 'smol-toml';
import { parseAnimation, parseImageFileName } from '../domain/model';
import { buildAllTimelines } from '../domain/timeline';
import { importFLA, importXFLFromFiles } from '../formats/fla/importer';
import { decodePAM } from '../formats/pam/decoder';
import type { Animation, TimelinesMap } from '../domain/types';
import { blobToImage } from './files';

export interface LoadedAnimation {
  displayName: string;
  animation: Animation;
  textures: Map<string, HTMLImageElement>;
  spriteTimelines: TimelinesMap;
  loaded: number;
}

export async function buildLoadedAnimation(files: File[]): Promise<LoadedAnimation | null> {
  const flaFile = files.find(f => /\.fla$/i.test(f.name));
  const hasXfl = !flaFile && files.some(f => /(?:^|[\/])DOMDocument\.xml$/i.test(f.name));

  let flaMediaPngs: Map<string, Uint8Array> | null = null;
  let displayName = '';
  let loadedAnimation: Animation | null = null;

  if (flaFile || hasXfl) {
    if (flaFile) {
      const buf = await flaFile.arrayBuffer();
      const result = await importFLA(buf);
      loadedAnimation = parseAnimation(result.json);
      flaMediaPngs = result.mediaPngs;
      displayName = flaFile.name;
    } else {
      const fileMap = new Map<string, Uint8Array>();
      for (const f of files) {
        const buf = await f.arrayBuffer();
        fileMap.set(f.name, new Uint8Array(buf));
      }
      const result = importXFLFromFiles(fileMap);
      loadedAnimation = parseAnimation(result.json);
      flaMediaPngs = result.mediaPngs;
      displayName = files[0]?.name?.split('/')[0] || 'XFL';
    }
  } else {
    let pamJsonFile = files.find(f => /\.pam\.json$/i.test(f.name));
    if (!pamJsonFile) pamJsonFile = files.find(f => /\.json$/i.test(f.name));
    let pamYamlFile = files.find(f => /\.pam\.ya?ml$/i.test(f.name));
    if (!pamYamlFile) pamYamlFile = files.find(f => /\.ya?ml$/i.test(f.name));
    let pamTomlFile = files.find(f => /\.pam\.toml$/i.test(f.name));
    if (!pamTomlFile) pamTomlFile = files.find(f => /\.toml$/i.test(f.name));
    const pamBinFile = files.find(f =>
      /\.pam$/i.test(f.name)
      && !/\.json$/i.test(f.name)
      && !/\.ya?ml$/i.test(f.name)
      && !/\.toml$/i.test(f.name)
    );

    const sourceFile = pamJsonFile || pamYamlFile || pamTomlFile || pamBinFile;
    if (!sourceFile) return null;
    displayName = sourceFile.name;

    if (pamJsonFile) {
      const text = await pamJsonFile.text();
      loadedAnimation = parseAnimation(JSON.parse(text));
    } else if (pamYamlFile) {
      const text = await pamYamlFile.text();
      loadedAnimation = parseAnimation(jsYamlMod.load(text));
    } else if (pamTomlFile) {
      const text = await pamTomlFile.text();
      loadedAnimation = parseAnimation(smolTomlMod.parse(text));
    } else {
      const buf = await pamBinFile!.arrayBuffer();
      loadedAnimation = parseAnimation(await decodePAM(buf));
    }
  }
  if (!loadedAnimation) return null;

  const pngMap = new Map<string, File>();
  for (const f of files) {
    if (/\.png$/i.test(f.name)) pngMap.set(f.name.toUpperCase(), f);
  }

  const loadedTextures = new Map<string, HTMLImageElement>();
  let loaded = 0;
  for (const img of loadedAnimation.image) {
    const baseName = parseImageFileName(img.name);
    const pipeIdx = img.name.indexOf('|');
    const altName = pipeIdx !== -1 ? img.name.substring(pipeIdx + 1) : null;

    if (flaMediaPngs) {
      for (const name of [baseName, altName].filter(Boolean) as string[]) {
        const pngData = flaMediaPngs.get(name);
        if (pngData) {
          try {
            const blob = new Blob([pngData as BlobPart], { type: 'image/png' });
            loadedTextures.set(img.name, await blobToImage(blob));
            loaded++;
          } catch { /* skip */ }
          break;
        }
      }
      if (loadedTextures.has(img.name)) continue;
    }

    for (const name of [baseName, altName].filter(Boolean) as string[]) {
      const pngFile = pngMap.get((name + '.png').toUpperCase());
      if (pngFile) {
        try {
          loadedTextures.set(img.name, await blobToImage(pngFile));
          loaded++;
        } catch { /* skip */ }
        break;
      }
    }
  }

  return {
    displayName,
    animation: loadedAnimation,
    textures: loadedTextures,
    spriteTimelines: buildAllTimelines(loadedAnimation),
    loaded,
  };
}
