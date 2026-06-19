import { publishViewerChrome, publishViewerLayout } from '../viewer-bridge';
import { clampPanelWidth } from './geometry';

export type PanelKind = 'images' | 'sprites';

interface PanelLayoutOptions {
  requestCanvasResize: () => void;
  saveSettings: () => void;
}

interface PanelResizeState {
  panel: PanelKind;
  startX: number;
  startWidth: number;
}

interface PanelLayoutSnapshot {
  imagesPanelVisible: boolean;
  spritesPanelVisible: boolean;
  imagePanelWidth: number;
  spritePanelWidth: number;
}

export interface PanelLayoutController {
  getSnapshot: () => PanelLayoutSnapshot;
  publish: () => void;
  readWidth: (which: PanelKind) => number;
  setWidth: (which: PanelKind, width: number) => void;
  isVisible: (which: PanelKind) => boolean;
  setVisible: (which: PanelKind, visible: boolean) => void;
  toggleImages: () => void;
  toggleSprites: () => void;
  beginResize: (which: PanelKind, clientX: number) => void;
  resize: (clientX: number) => void;
  endResize: () => void;
}

export function createPanelLayoutController(options: PanelLayoutOptions): PanelLayoutController {
  let imagesPanelVisible = true;
  let spritesPanelVisible = true;
  let imagePanelWidth = 240;
  let spritePanelWidth = 240;
  let panelResizeState: PanelResizeState | null = null;

  function getSnapshot(): PanelLayoutSnapshot {
    return {
      imagesPanelVisible,
      spritesPanelVisible,
      imagePanelWidth,
      spritePanelWidth,
    };
  }

  function publish(): void {
    const layout = getSnapshot();
    publishViewerLayout(layout);
    publishViewerChrome({
      imagesPanelVisible: layout.imagesPanelVisible,
      spritesPanelVisible: layout.spritesPanelVisible,
    });
  }

  function readWidth(which: PanelKind): number {
    return which === 'images' ? imagePanelWidth : spritePanelWidth;
  }

  function setWidth(which: PanelKind, width: number): void {
    if (which === 'images') {
      imagePanelWidth = clampPanelWidth(width);
    } else {
      spritePanelWidth = clampPanelWidth(width);
    }
    publish();
  }

  function isVisible(which: PanelKind): boolean {
    return which === 'images' ? imagesPanelVisible : spritesPanelVisible;
  }

  function setVisible(which: PanelKind, visible: boolean): void {
    if (which === 'images') {
      imagesPanelVisible = visible;
    } else {
      spritesPanelVisible = visible;
    }
    publish();
  }

  function beginResize(which: PanelKind, clientX: number): void {
    panelResizeState = {
      panel: which,
      startX: clientX,
      startWidth: readWidth(which),
    };
  }

  function resize(clientX: number): void {
    if (!panelResizeState) return;
    const delta = panelResizeState.panel === 'images'
      ? clientX - panelResizeState.startX
      : panelResizeState.startX - clientX;
    setWidth(panelResizeState.panel, panelResizeState.startWidth + delta);
    options.requestCanvasResize();
  }

  function endResize(): void {
    if (!panelResizeState) return;
    panelResizeState = null;
    options.saveSettings();
  }

  function toggle(which: PanelKind): void {
    setVisible(which, !isVisible(which));
    options.saveSettings();
    options.requestCanvasResize();
  }

  return {
    getSnapshot,
    publish,
    readWidth,
    setWidth,
    isVisible,
    setVisible,
    toggleImages: () => toggle('images'),
    toggleSprites: () => toggle('sprites'),
    beginResize,
    resize,
    endResize,
  };
}
