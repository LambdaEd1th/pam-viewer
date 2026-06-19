import type { Animation } from '../../domain/types';

export const SPEED_PRESETS = [
  { label: '0.25\u00d7', factor: 0.25 },
  { label: '0.5\u00d7', factor: 0.5 },
  { label: '1\u00d7', factor: 1 },
  { label: '1.5\u00d7', factor: 1.5 },
  { label: '2\u00d7', factor: 2 },
  { label: '3\u00d7', factor: 3 },
  { label: '4\u00d7', factor: 4 },
];

export function getBaseFrameRate(
  animation: Animation | null,
  activeSprite: Animation['mainSprite'],
): number {
  return Number((activeSprite as any)?.frameRate ?? animation?.frameRate ?? 30);
}

export function getMatchingSpeedPresetValue(speedValue: string, baseFrameRate: number): string {
  const fps = parseInt(speedValue, 10);
  if (!Number.isFinite(fps)) return 'custom';
  const preset = SPEED_PRESETS.find(p => Math.round(baseFrameRate * p.factor) === fps);
  return preset ? String(preset.factor) : 'custom';
}
