import type { Animation } from '../domain/types';

export interface SpecialLayerIndices {
  plantCustomLayers: number[];
  zombieStateLayers: number[];
  groundSwatchLayers: number[];
  defaultHiddenLayers: number[];
}

export function getSpecialLayerIndices(anim: Animation): SpecialLayerIndices {
  const result: SpecialLayerIndices = {
    plantCustomLayers: [],
    zombieStateLayers: [],
    groundSwatchLayers: [],
    defaultHiddenLayers: [],
  };

  anim.sprite.forEach((sp, i) => {
    if (!sp.name) return;
    if (sp.name.startsWith('custom_')) result.plantCustomLayers.push(i);
    if (sp.name === 'ink' || sp.name === 'butter') result.zombieStateLayers.push(i);
    if (sp.name === 'ground_swatch' || sp.name === 'ground_swatch_plane') result.groundSwatchLayers.push(i);
    if (isDefaultHiddenSpriteName(sp.name)) result.defaultHiddenLayers.push(i);
  });

  return result;
}

function isDefaultHiddenSpriteName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith('custom_')
    || lower.includes('armor')
    || lower === 'magnet_item'
    || lower.includes('dark')
    || (lower.includes('nightshade') && lower.endsWith('_pf'));
}
