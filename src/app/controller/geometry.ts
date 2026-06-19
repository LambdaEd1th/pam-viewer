import { computeAnimationBounds } from '../../domain/timeline';
import type { Animation, TimelinesMap } from '../../domain/types';
import type { ExportSize, StageBounds } from './types';

export function clampPanelWidth(width: number): number {
  return Math.max(120, Math.min(500, Math.round(width)));
}

export function getPresetExportSize(anim: Animation): ExportSize {
  return {
    width: Math.max(1, Math.round(anim.size[0])),
    height: Math.max(1, Math.round(anim.size[1])),
  };
}

export function getExportScaleValueFor(anim: Animation | null, size: ExportSize): string {
  if (!anim || anim.size[0] <= 0 || anim.size[1] <= 0) return 'custom';
  const ratioW = size.width / anim.size[0];
  const ratioH = size.height / anim.size[1];
  if (Math.abs(ratioW - ratioH) > 0.01) return 'custom';
  const rounded = Math.round(ratioW);
  return rounded >= 1 && rounded <= 4 && Math.abs(ratioW - rounded) <= 0.01
    ? String(rounded)
    : 'custom';
}

export function parseExportDimensionValue(value: string, fallback: number): number {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(99999, parsed) : fallback;
}

export function normalizeExportSize(size: ExportSize): ExportSize {
  return {
    width: Math.max(1, Math.min(99999, Math.round(size.width))),
    height: Math.max(1, Math.min(99999, Math.round(size.height))),
  };
}

export function getPamStageBounds(anim: Animation): StageBounds {
  return {
    x: -anim.position[0],
    y: -anim.position[1],
    width: Math.max(1, anim.size[0]),
    height: Math.max(1, anim.size[1]),
  };
}

export function unionStageBounds(a: StageBounds, b: StageBounds): StageBounds {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: x1,
    y: y1,
    width: Math.max(1, x2 - x1),
    height: Math.max(1, y2 - y1),
  };
}

export function computeStageViewBoundsFor(
  anim: Animation,
  tex: Map<string, HTMLImageElement>,
  timelines: TimelinesMap | null,
): StageBounds {
  const pamBounds = getPamStageBounds(anim);
  if (!timelines) return pamBounds;

  const contentBounds = computeAnimationBounds(anim, tex, timelines);
  if (contentBounds.width <= 0 || contentBounds.height <= 0) {
    return pamBounds;
  }
  return unionStageBounds(pamBounds, contentBounds);
}

export function getPanForStageBounds(bounds: StageBounds): { x: number; y: number } {
  return {
    x: -bounds.x - bounds.width / 2,
    y: -bounds.y - bounds.height / 2,
  };
}
