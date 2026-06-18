import type { Animation } from '../domain/types';

export interface SpecialLayerIndices {
  plantCustomLayers: number[];
  zombieStateLayers: number[];
  groundSwatchLayers: number[];
  defaultHiddenLayers: number[];
}

const LOWERCASE_EXACT_DEFAULT_HIDDEN_LAYERS = new Set([
  'magnet_item',
]);

const SHADOW_POWER_ANIMATION_STEMS = [
  'dragonbabybruit',
  'dragonbruit',
  'dusklobber',
  'gloomvine',
  'grimrose',
  'guardshroom',
  'moonflower',
  'murkadamia',
  'nightshade',
  'noctarine',
  'powervine',
  'shadowpea',
  'shadowshroom',
];

export function getSpecialLayerIndices(anim: Animation, sourceName = ''): SpecialLayerIndices {
  const result: SpecialLayerIndices = {
    plantCustomLayers: [],
    zombieStateLayers: [],
    groundSwatchLayers: [],
    defaultHiddenLayers: [],
  };
  const sourceStem = getSourceStem(sourceName);
  const sourceKey = normalizeSourceKey(sourceStem);
  const isNightshadeAnimation = sourceKey.includes('nightshade');
  const isShadowPowerAnimation = isShadowPowerSource(sourceKey);
  const spriteNames = new Set(anim.sprite.map(sp => sp.name).filter((name): name is string => !!name));

  anim.sprite.forEach((sp, i) => {
    if (!sp.name) return;
    const name = sp.name;
    const lowerName = name.toLowerCase();
    if (lowerName.startsWith('custom_')) result.plantCustomLayers.push(i);
    if (name === 'ink' || name === 'butter') result.zombieStateLayers.push(i);
    if (name === 'ground_swatch' || name === 'ground_swatch_plane') result.groundSwatchLayers.push(i);
    if (isDefaultHiddenSpriteName(name, isNightshadeAnimation, isShadowPowerAnimation, spriteNames)) {
      result.defaultHiddenLayers.push(i);
    }
  });

  return result;
}

function getSourceStem(sourceName: string): string {
  const baseName = sourceName.split(/[\\/]/).pop() ?? sourceName;
  return baseName
    .replace(/\.pam\.json$/i, '')
    .replace(/\.pam\.ya?ml$/i, '')
    .replace(/\.pam\.toml$/i, '')
    .replace(/\.json$/i, '')
    .replace(/\.ya?ml$/i, '')
    .replace(/\.toml$/i, '')
    .replace(/\.pam$/i, '')
    .replace(/\.fla$/i, '');
}

function normalizeSourceKey(sourceStem: string): string {
  return sourceStem.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isShadowPowerSource(sourceKey: string): boolean {
  return SHADOW_POWER_ANIMATION_STEMS.some(stem => sourceKey.includes(stem));
}

function isDefaultHiddenSpriteName(
  name: string,
  isNightshadeAnimation: boolean,
  isShadowPowerAnimation: boolean,
  spriteNames: ReadonlySet<string>,
): boolean {
  const lowerName = name.toLowerCase();
  return lowerName.startsWith('custom_')
    || lowerName.includes('armor')
    || LOWERCASE_EXACT_DEFAULT_HIDDEN_LAYERS.has(lowerName)
    || isDarkLayerName(name, isShadowPowerAnimation, spriteNames)
    || (isNightshadeAnimation && lowerName.endsWith('_pf'));
}

function isDarkLayerName(
  name: string,
  isShadowPowerAnimation: boolean,
  spriteNames: ReadonlySet<string>,
): boolean {
  return isPairedDarkLayer(name, spriteNames)
    || (isShadowPowerAnimation && name.toLowerCase().includes('dark'));
}

function isPairedDarkLayer(name: string, spriteNames: ReadonlySet<string>): boolean {
  if (name.endsWith('_dark')) {
    const base = name.slice(0, -'_dark'.length);
    if (spriteNames.has(base) || spriteNames.has(`${base}_normal`) || spriteNames.has(`${base}_white`)) {
      return true;
    }
  }

  const darkInfix = '_dark_';
  const infixIndex = name.indexOf(darkInfix);
  if (infixIndex !== -1) {
    const lightName = name.slice(0, infixIndex) + '_' + name.slice(infixIndex + darkInfix.length);
    if (spriteNames.has(lightName)) return true;
  }

  const darkPrefix = 'dark_';
  if (name.startsWith(darkPrefix)) {
    if (spriteNames.has(name.slice(darkPrefix.length))) return true;
  }

  return false;
}
