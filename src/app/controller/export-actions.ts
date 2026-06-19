import { Rectangle, type Application } from 'pixi.js';
import * as jsYamlMod from 'js-yaml';
import * as smolTomlMod from 'smol-toml';
import { toRawJson } from '../../formats/pam/serializer';
import { loadPamCodecWasm } from '../../formats/pam/wasm';
import { encodePAM } from '../../formats/pam/encoder';
import { exportFLA } from '../../formats/fla/exporter';
import { encodeApng } from '../../export/apng';
import { encodeAnimatedWebp } from '../../export/animated-webp';
import { downloadBlob, stripKnownAnimationExtension } from '../../export/download';
import { renderFrameToPixiContainer } from '../../rendering/pixi-renderer';
import { t } from '../../localization/i18n';
import { publishViewerCommand, publishViewerExport } from '../viewer-bridge';
import type { Animation, TimelinesMap } from '../../domain/types';
import type { ExportSize, FrameRange } from './types';

interface ExportActionsOptions {
  getPixiApp: () => Application | null;
  getAnimation: () => Animation | null;
  getTextures: () => Map<string, HTMLImageElement>;
  getSpriteTimelines: () => TimelinesMap | null;
  getActiveSprite: () => Animation['mainSprite'];
  getActiveSpriteIndex: () => number;
  getCurrentFrame: () => number;
  getFrameRange: () => FrameRange;
  getImageFilter: () => boolean[];
  getSpriteFilter: () => boolean[];
  getSpeedValue: () => string;
  getExportSize: () => ExportSize;
  getDisplayName: () => string;
  drawCurrentFrame: () => void;
  setControlsEnabled: (enabled: boolean) => void;
}

export interface ExportActions {
  exportPng: () => void;
  exportApng: () => void;
  exportWebp: () => void;
  exportFla: () => Promise<void>;
  convertJson: () => Promise<void>;
  convertYaml: () => void;
  convertToml: () => void;
  convertPam: () => Promise<void>;
  cancelExport: () => void;
}

function isCanvasImageSource(value: unknown): value is CanvasImageSource {
  if (value instanceof HTMLCanvasElement) return true;
  if (value instanceof HTMLImageElement) return true;
  if (value instanceof HTMLVideoElement) return true;
  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) return true;
  if (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas) return true;
  return false;
}

export function createExportActions(options: ExportActionsOptions): ExportActions {
  let exportCancelled = false;

  function getActiveAnimationBaseName(): string {
    return stripKnownAnimationExtension(options.getDisplayName() || 'animation');
  }

  function getExportName(ext: string): string {
    const animation = options.getAnimation();
    const activeSpriteIndex = options.getActiveSpriteIndex();
    const base = getActiveAnimationBaseName();
    const sprName = activeSpriteIndex === -1
      ? 'main'
      : (animation!.sprite[activeSpriteIndex].name || 'sprite_' + activeSpriteIndex);
    return base + '_' + sprName + '.' + ext;
  }

  function renderFrameToCanvas(frameIdx: number, w: number, h: number): HTMLCanvasElement {
    const pixiApp = options.getPixiApp();
    const animation = options.getAnimation();
    const spriteTimelines = options.getSpriteTimelines();
    if (!pixiApp) throw new Error('PixiJS app is not initialized.');
    if (!animation || !spriteTimelines) throw new Error('PAM animation is not loaded.');

    const scale = Math.min(w / Math.max(animation.size[0], 1), h / Math.max(animation.size[1], 1));
    const panExportX = animation.position[0] * scale - w / 2;
    const panExportY = animation.position[1] * scale - h / 2;

    const frameContent = renderFrameToPixiContainer(
      animation,
      options.getTextures(),
      spriteTimelines,
      options.getActiveSpriteIndex(),
      frameIdx,
      options.getImageFilter(),
      options.getSpriteFilter(),
      scale,
      panExportX,
      panExportY,
      w,
      h,
      1,
    );

    const extracted = pixiApp.renderer.extract.canvas({
      target: frameContent,
      frame: new Rectangle(0, 0, w, h),
      resolution: 1,
      clearColor: '#00000000',
    });

    if (extracted instanceof HTMLCanvasElement) {
      return extracted;
    }

    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.width = w;
    fallbackCanvas.height = h;
    const fallbackCtx = fallbackCanvas.getContext('2d');
    if (fallbackCtx && isCanvasImageSource(extracted)) {
      fallbackCtx.drawImage(extracted, 0, 0, w, h);
    } else {
      console.warn('Pixi extract returned non-canvas image source; export frame is blank.');
    }
    return fallbackCanvas;
  }

  function getExportPixelSize(): { w: number; h: number } {
    const size = options.getExportSize();
    return { w: size.width, h: size.height };
  }

  function showExportOverlay(title: string): void {
    exportCancelled = false;
    publishViewerExport({
      visible: true,
      title,
      progress: 0,
      status: t('export.preparing'),
    });
  }

  function hideExportOverlay(): void {
    publishViewerExport({ visible: false });
  }

  function exportPng(): void {
    if (!options.getAnimation() || !options.getActiveSprite()) return;
    const { w, h } = getExportPixelSize();
    const offCanvas = renderFrameToCanvas(options.getCurrentFrame(), w, h);
    offCanvas.toBlob(blob => {
      if (blob) downloadBlob(blob, getExportName('png'));
    }, 'image/png');
    options.drawCurrentFrame();
  }

  async function exportAnimCommon(
    formatLabel: string,
    encodeFn: (frames: HTMLCanvasElement[], w: number, h: number, fps: number) => Promise<Uint8Array>,
    mime: string,
    ext: string,
  ): Promise<void> {
    if (!options.getAnimation() || !options.getActiveSprite()) return;
    showExportOverlay(t('export.exporting', { format: formatLabel }));

    try {
      const { w, h } = getExportPixelSize();
      const { begin, end } = options.getFrameRange();
      const totalFrames = end - begin + 1;
      const fps = parseInt(options.getSpeedValue(), 10) || 30;

      const canvasFrames: HTMLCanvasElement[] = [];
      for (let i = 0; i < totalFrames; i++) {
        if (exportCancelled) {
          hideExportOverlay();
          options.drawCurrentFrame();
          return;
        }
        const fi = begin + i;
        canvasFrames.push(renderFrameToCanvas(fi, w, h));
        publishViewerExport({
          progress: ((i + 1) / totalFrames) * 50,
          status: t('export.rendering', { current: String(i + 1), total: String(totalFrames) }),
        });
        if (i % 5 === 4) await new Promise(resolve => setTimeout(resolve, 0));
      }

      if (exportCancelled) {
        hideExportOverlay();
        options.drawCurrentFrame();
        return;
      }
      publishViewerExport({
        progress: 50,
        status: t('export.encoding', { format: formatLabel }),
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      const bytes = await encodeFn(canvasFrames, w, h, fps);
      publishViewerExport({ progress: 100 });

      if (!exportCancelled) {
        const blob = new Blob([bytes as BlobPart], { type: mime });
        downloadBlob(blob, getExportName(ext));
      }
    } catch (e: any) {
      alert(e.message || t('export.failed'));
    }
    hideExportOverlay();
    options.drawCurrentFrame();
  }

  async function exportFla(): Promise<void> {
    const animation = options.getAnimation();
    if (!animation) return;
    const baseName = getActiveAnimationBaseName();
    publishViewerCommand({ commandDisabled: true });
    try {
      const blob = await exportFLA(animation, options.getTextures());
      downloadBlob(blob, baseName + '.fla');
    } finally {
      options.setControlsEnabled(Boolean(options.getActiveSprite()));
    }
  }

  function getConvertName(ext: string): string {
    return getActiveAnimationBaseName() + '.pam.' + ext;
  }

  async function convertJson(): Promise<void> {
    const animation = options.getAnimation();
    if (!animation) return;
    const raw = toRawJson(animation);
    const wasm = await loadPamCodecWasm();
    const text = wasm.pamToJson(raw) + '\n';
    const blob = new Blob([text], { type: 'application/json' });
    downloadBlob(blob, getConvertName('json'));
  }

  function convertYaml(): void {
    const animation = options.getAnimation();
    if (!animation) return;
    const raw = toRawJson(animation);
    const text = jsYamlMod.dump(raw, { lineWidth: -1, noRefs: true });
    const blob = new Blob([text], { type: 'text/yaml' });
    downloadBlob(blob, getConvertName('yaml'));
  }

  function convertToml(): void {
    const animation = options.getAnimation();
    if (!animation) return;
    const raw = toRawJson(animation);
    const text = smolTomlMod.stringify(raw as any);
    const blob = new Blob([text], { type: 'application/toml' });
    downloadBlob(blob, getConvertName('toml'));
  }

  async function convertPam(): Promise<void> {
    const animation = options.getAnimation();
    if (!animation) return;
    const raw = toRawJson(animation);
    const buf = await encodePAM(raw);
    const blob = new Blob([buf], { type: 'application/octet-stream' });
    downloadBlob(blob, getActiveAnimationBaseName() + '.pam');
  }

  return {
    exportPng,
    exportApng: () => {
      void exportAnimCommon('APNG', encodeApng, 'image/apng', 'apng');
    },
    exportWebp: () => {
      void exportAnimCommon('WebP', encodeAnimatedWebp, 'image/webp', 'webp');
    },
    exportFla,
    convertJson,
    convertYaml,
    convertToml,
    convertPam,
    cancelExport: () => {
      exportCancelled = true;
    },
  };
}
