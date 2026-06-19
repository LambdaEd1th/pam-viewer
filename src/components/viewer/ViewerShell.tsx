import { useEffect, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import {
  getViewerLayoutSnapshot,
  nextViewerFrame,
  previousViewerFrame,
  resizeViewerViewport,
  resetViewerZoom,
  subscribeViewerLayout,
  toggleViewerPlayback,
  zoomViewerIn,
  zoomViewerOut,
} from '@/app/viewer-bridge';
import { ExportOverlay } from './ExportOverlay';
import { StatusBar } from './StatusBar';
import { TabStrip } from './TabStrip';
import { Toolbar } from './Toolbar';
import { Workspace } from './Workspace';

export function ViewerShell() {
  const {
    imagesPanelVisible,
    spritesPanelVisible,
    imagePanelWidth,
    spritePanelWidth,
  } = useSyncExternalStore(
    subscribeViewerLayout,
    getViewerLayoutSnapshot,
    getViewerLayoutSnapshot,
  );
  const layoutStyle = {
    '--image-panel-width': `${imagePanelWidth}px`,
    '--sprite-panel-width': `${spritePanelWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    const handleResize = () => resizeViewerViewport();
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (tagName === 'INPUT' || tagName === 'SELECT') return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          toggleViewerPlayback();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          previousViewerFrame();
          break;
        case 'ArrowRight':
          event.preventDefault();
          nextViewerFrame();
          break;
        case '0':
          event.preventDefault();
          resetViewerZoom();
          break;
        case '=':
        case '+':
          event.preventDefault();
          zoomViewerIn();
          break;
        case '-':
          event.preventDefault();
          zoomViewerOut();
          break;
        default:
          break;
      }
    };

    window.addEventListener('resize', handleResize);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div
      id="app"
      data-images-panel={imagesPanelVisible ? 'open' : 'closed'}
      data-sprites-panel={spritesPanelVisible ? 'open' : 'closed'}
      style={layoutStyle}
    >
      <Toolbar />
      <TabStrip />
      <ExportOverlay />
      <Workspace />
      <StatusBar />
    </div>
  );
}
