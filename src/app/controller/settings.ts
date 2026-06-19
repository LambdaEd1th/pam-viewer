import type { ThemePreference } from './types';

export const SETTINGS_KEY = 'pam-viewer-settings';

export function readSettings(): Record<string, unknown> | null {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    return s && typeof s === 'object' ? s as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function getStoredThemePreference(): ThemePreference {
  const s = readSettings();
  return isThemePreference(s?.theme) ? s.theme : 'system';
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isPositiveNumericString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

export function getStoredSpeedValue(): string | null {
  const value = readSettings()?.speedValue;
  return isPositiveNumericString(value) ? value : null;
}

export function getStoredSizeScale(): string {
  const value = readSettings()?.sizeScale;
  return typeof value === 'string' && ['custom', '1', '2', '3', '4'].includes(value) ? value : '1';
}
