import { useRef, useSyncExternalStore } from 'react';
import { FolderOpen } from 'lucide-react';
import { registerViewerDomRef } from '@/app/viewer-dom';
import {
  dropViewerFiles,
  getViewerChromeSnapshot,
  pointerDownViewerStage,
  pointerLeaveViewerStage,
  pointerMoveViewerStage,
  pointerUpViewerStage,
  setViewerStageDragOver,
  subscribeViewerChrome,
  wheelViewerStage,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function StageView() {
  const { t } = useI18n();
  const capturedPointerId = useRef<number | null>(null);
  const { dropHintVisible, stageCursor, stageDragOver } = useSyncExternalStore(
    subscribeViewerChrome,
    getViewerChromeSnapshot,
    getViewerChromeSnapshot,
  );

  return (
    <div
      id="stage-container"
      ref={element => registerViewerDomRef('stageContainer', element)}
      className={stageDragOver ? 'drag-over' : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setViewerStageDragOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setViewerStageDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setViewerStageDragOver(false);
        dropViewerFiles(event.dataTransfer);
      }}
    >
      <canvas
        id="stage"
        ref={element => registerViewerDomRef('canvas', element)}
        style={{ cursor: stageCursor || undefined }}
        onWheel={(event) => {
          event.preventDefault();
          wheelViewerStage(event.clientX, event.clientY, event.deltaY);
        }}
        onPointerDown={(event) => {
          if (pointerDownViewerStage(event.clientX, event.clientY, event.button)) {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            capturedPointerId.current = event.pointerId;
          }
        }}
        onPointerMove={(event) => {
          pointerMoveViewerStage(event.clientX, event.clientY);
        }}
        onPointerLeave={() => {
          pointerLeaveViewerStage();
        }}
        onPointerUp={(event) => {
          const shouldRelease = pointerUpViewerStage();
          if (
            (shouldRelease || capturedPointerId.current === event.pointerId)
            && event.currentTarget.hasPointerCapture(event.pointerId)
          ) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          if (capturedPointerId.current === event.pointerId) capturedPointerId.current = null;
        }}
      />
      <div id="drop-hint" className={dropHintVisible ? undefined : 'hidden'}>
        <div className="drop-hint-icon"><FolderOpen aria-hidden="true" /></div>
        <div className="drop-hint-text">{t('drop.hint')}</div>
        <div className="drop-hint-sub">{t('drop.hintSub')}</div>
      </div>
    </div>
  );
}
