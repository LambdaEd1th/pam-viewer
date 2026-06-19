import { useState, useSyncExternalStore } from 'react';
import {
  beginViewerPanelResize,
  endViewerPanelResize,
  getViewerChromeSnapshot,
  resizeViewerPanel,
  subscribeViewerChrome,
} from '@/app/viewer-bridge';
import { SidePanel } from './SidePanel';
import { StageView } from './StageView';

interface ResizeHandleProps {
  id: string;
  panel: 'images' | 'sprites';
  hidden: boolean;
}

function ResizeHandle({ id, panel, hidden }: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      id={id}
      className={[
        'resize-handle',
        hidden ? 'hidden' : '',
        dragging ? 'dragging' : '',
      ].filter(Boolean).join(' ')}
      onPointerDown={(event) => {
        if (hidden) return;
        event.preventDefault();
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        beginViewerPanelResize(panel, event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging) resizeViewerPanel(event.clientX);
      }}
      onPointerUp={(event) => {
        if (!dragging) return;
        setDragging(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
        endViewerPanelResize();
      }}
    />
  );
}

export function Workspace() {
  const { imagesPanelVisible, spritesPanelVisible } = useSyncExternalStore(
    subscribeViewerChrome,
    getViewerChromeSnapshot,
    getViewerChromeSnapshot,
  );

  return (
    <div id="main-content">
      <SidePanel
        id="panel-images"
        titleKey="panel.images"
        title="Images"
        allId="btn-img-all"
        noneId="btn-img-none"
        inputId="img-regex"
        listId="image-list"
        placeholderKey="filter.image.placeholder"
        titleKeyForInput="filter.image.title"
        placeholder="正则过滤…"
        inputTitle="输入正则表达式过滤 Image"
        kind="images"
        domRefName="panelImages"
        hidden={!imagesPanelVisible}
      />
      <ResizeHandle id="resize-handle-left" panel="images" hidden={!imagesPanelVisible} />
      <StageView />
      <ResizeHandle id="resize-handle-right" panel="sprites" hidden={!spritesPanelVisible} />
      <SidePanel
        id="panel-sprites"
        titleKey="panel.sprites"
        title="Sprites"
        allId="btn-spr-all"
        noneId="btn-spr-none"
        inputId="spr-regex"
        listId="sprite-list"
        placeholderKey="filter.sprite.placeholder"
        titleKeyForInput="filter.sprite.title"
        placeholder="正则过滤…"
        inputTitle="输入正则表达式过滤 Sprite"
        kind="sprites"
        domRefName="panelSprites"
        hidden={!spritesPanelVisible}
      />
    </div>
  );
}
