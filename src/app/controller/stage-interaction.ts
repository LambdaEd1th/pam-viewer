import type { Animation } from '../../domain/types';
import type { ExportSize } from './types';

type EdgeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface PanPoint {
  x: number;
  y: number;
}

interface StageInteractionOptions {
  canvas: HTMLCanvasElement;
  getAnimation: () => Animation | null;
  isBoundaryEnabled: () => boolean;
  getZoom: () => number;
  setZoom: (zoom: number) => void;
  getPan: () => PanPoint;
  setPan: (pan: PanPoint) => void;
  getStageFitScale: () => number;
  getStageRenderScale: () => number;
  getSizeScaleValue: () => string;
  getCurrentExportSize: () => ExportSize;
  setExportSizeScaleValue: (size: ExportSize) => void;
  setExportSizeFromScale: (scaleValue: string) => void;
  updateZoomDisplay: () => void;
  updateSizeDisplay: () => void;
  setCoordText: (coord: string) => void;
  setStageCursor: (cursor: string) => void;
  refreshStageViewBounds: () => void;
  resetPanToStageView: () => void;
  resizeCanvas: () => void;
  drawCurrentFrame: () => void;
}

export interface StageInteractionController {
  wheel: (clientX: number, clientY: number, deltaY: number) => void;
  pointerDown: (clientX: number, clientY: number, button: number) => boolean;
  pointerMove: (clientX: number, clientY: number) => void;
  pointerLeave: () => void;
  pointerUp: () => boolean;
  resetZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

interface BoundaryDragStart {
  mx: number;
  my: number;
  origW: number;
  origH: number;
  origPosX: number;
  origPosY: number;
  exportScale: string;
}

const EDGE_HIT = 6;

const EDGE_CURSORS: Record<EdgeDir, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

export function createStageInteractionController(options: StageInteractionOptions): StageInteractionController {
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let boundaryDragEdge: EdgeDir | null = null;
  let boundaryDragStart: BoundaryDragStart | null = null;

  function getCanvasBitmapPoint(clientX: number, clientY: number): PanPoint {
    const rect = options.canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? options.canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? options.canvas.height / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function clientToAnimSpace(clientX: number, clientY: number): { ax: number; ay: number } {
    const animation = options.getAnimation()!;
    const point = getCanvasBitmapPoint(clientX, clientY);
    const pan = options.getPan();
    const renderScale = options.getStageRenderScale();
    const zoom = options.getZoom();
    const cx = options.canvas.width / 2 + pan.x * renderScale;
    const cy = options.canvas.height / 2 + pan.y * renderScale;
    const ox = animation.position[0];
    const oy = animation.position[1];
    const ax = (point.x - cx) / (zoom * renderScale) + ox;
    const ay = (point.y - cy) / (zoom * renderScale) + oy;
    return { ax, ay };
  }

  function updateCoordDisplayAt(clientX: number, clientY: number): void {
    const animation = options.getAnimation();
    if (!animation) {
      options.setCoordText('');
      return;
    }
    const { ax, ay } = clientToAnimSpace(clientX, clientY);
    options.setCoordText(`${Math.round(ax)}, ${Math.round(ay)}`);
  }

  function hitTestBoundaryEdge(clientX: number, clientY: number): EdgeDir | null {
    const animation = options.getAnimation();
    if (!animation || !options.isBoundaryEnabled()) return null;

    const w = animation.size[0];
    const h = animation.size[1];
    const { ax, ay } = clientToAnimSpace(clientX, clientY);
    const threshold = EDGE_HIT / (options.getZoom() * options.getStageFitScale());

    const nearLeft = Math.abs(ax) < threshold;
    const nearRight = Math.abs(ax - w) < threshold;
    const nearTop = Math.abs(ay) < threshold;
    const nearBottom = Math.abs(ay - h) < threshold;
    const inX = ax > -threshold && ax < w + threshold;
    const inY = ay > -threshold && ay < h + threshold;

    if (nearTop && nearLeft && inX && inY) return 'nw';
    if (nearTop && nearRight && inX && inY) return 'ne';
    if (nearBottom && nearLeft && inX && inY) return 'sw';
    if (nearBottom && nearRight && inX && inY) return 'se';
    if (nearTop && inX) return 'n';
    if (nearBottom && inX) return 's';
    if (nearLeft && inY) return 'w';
    if (nearRight && inY) return 'e';
    return null;
  }

  function syncExportSizeAfterBoundaryResize(exportScale: string): void {
    if (exportScale === 'custom') {
      options.setExportSizeScaleValue(options.getCurrentExportSize());
      options.updateSizeDisplay();
      return;
    }

    options.setExportSizeFromScale(exportScale);
  }

  function wheel(clientX: number, clientY: number, deltaY: number): void {
    const animation = options.getAnimation();
    if (!animation) return;

    const point = getCanvasBitmapPoint(clientX, clientY);
    const pan = options.getPan();
    const renderScale = options.getStageRenderScale();
    const zoom = options.getZoom();
    const cx = options.canvas.width / 2 + pan.x * renderScale;
    const cy = options.canvas.height / 2 + pan.y * renderScale;
    const ax = (point.x - cx) / (zoom * renderScale) + animation.position[0];
    const ay = (point.y - cy) / (zoom * renderScale) + animation.position[1];

    const factor = deltaY > 0 ? 0.9 : 1.1;
    const nextZoom = Math.max(0.05, Math.min(100, zoom * factor));
    options.setZoom(nextZoom);
    options.setPan({
      x: (point.x - options.canvas.width / 2) / renderScale - (ax - animation.position[0]) * nextZoom,
      y: (point.y - options.canvas.height / 2) / renderScale - (ay - animation.position[1]) * nextZoom,
    });

    options.updateZoomDisplay();
    options.drawCurrentFrame();
  }

  function pointerDown(clientX: number, clientY: number, button: number): boolean {
    const animation = options.getAnimation();
    const edge = hitTestBoundaryEdge(clientX, clientY);
    if (animation && edge && button === 0) {
      boundaryDragEdge = edge;
      boundaryDragStart = {
        mx: clientX,
        my: clientY,
        origW: animation.size[0],
        origH: animation.size[1],
        origPosX: animation.position[0],
        origPosY: animation.position[1],
        exportScale: options.getSizeScaleValue(),
      };
      return true;
    }

    if (button === 0 || button === 1) {
      const pan = options.getPan();
      isPanning = true;
      panStartX = clientX;
      panStartY = clientY;
      panOriginX = pan.x;
      panOriginY = pan.y;
      return true;
    }
    return false;
  }

  function pointerMove(clientX: number, clientY: number): void {
    updateCoordDisplayAt(clientX, clientY);

    const animation = options.getAnimation();
    if (animation && boundaryDragEdge && boundaryDragStart) {
      const dx = (clientX - boundaryDragStart.mx) / (options.getZoom() * options.getStageFitScale());
      const dy = (clientY - boundaryDragStart.my) / (options.getZoom() * options.getStageFitScale());
      const edge = boundaryDragEdge;
      let newW = boundaryDragStart.origW;
      let newH = boundaryDragStart.origH;
      let newPosX = boundaryDragStart.origPosX;
      let newPosY = boundaryDragStart.origPosY;

      if (edge.includes('e')) newW = Math.max(1, Math.round(boundaryDragStart.origW + dx));
      if (edge.includes('w')) {
        newW = Math.max(1, Math.round(boundaryDragStart.origW - dx));
        newPosX = Math.round(boundaryDragStart.origPosX - dx);
      }
      if (edge.includes('s')) newH = Math.max(1, Math.round(boundaryDragStart.origH + dy));
      if (edge.includes('n')) {
        newH = Math.max(1, Math.round(boundaryDragStart.origH - dy));
        newPosY = Math.round(boundaryDragStart.origPosY - dy);
      }

      animation.size[0] = newW;
      animation.size[1] = newH;
      animation.position[0] = newPosX;
      animation.position[1] = newPosY;
      options.refreshStageViewBounds();
      options.resetPanToStageView();
      syncExportSizeAfterBoundaryResize(boundaryDragStart.exportScale);
      options.resizeCanvas();
      return;
    }

    if (!isPanning) {
      const edge = hitTestBoundaryEdge(clientX, clientY);
      options.setStageCursor(edge ? EDGE_CURSORS[edge] : '');
    }

    if (!isPanning) return;
    options.setPan({
      x: panOriginX + (clientX - panStartX) / options.getStageFitScale(),
      y: panOriginY + (clientY - panStartY) / options.getStageFitScale(),
    });
    options.drawCurrentFrame();
  }

  function pointerLeave(): void {
    options.setCoordText('');
    if (!boundaryDragEdge) options.setStageCursor('');
  }

  function pointerUp(): boolean {
    if (boundaryDragEdge) {
      boundaryDragEdge = null;
      boundaryDragStart = null;
      options.setStageCursor('');
      return true;
    }
    if (isPanning) {
      isPanning = false;
      return true;
    }
    return false;
  }

  function resetZoom(): void {
    options.setZoom(1);
    options.resetPanToStageView();
    options.updateZoomDisplay();
    options.drawCurrentFrame();
  }

  function zoomIn(): void {
    options.setZoom(Math.min(100, options.getZoom() * 1.15));
    options.updateZoomDisplay();
    options.drawCurrentFrame();
  }

  function zoomOut(): void {
    options.setZoom(Math.max(0.05, options.getZoom() / 1.15));
    options.updateZoomDisplay();
    options.drawCurrentFrame();
  }

  return {
    wheel,
    pointerDown,
    pointerMove,
    pointerLeave,
    pointerUp,
    resetZoom,
    zoomIn,
    zoomOut,
  };
}
