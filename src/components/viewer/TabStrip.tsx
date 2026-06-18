import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { registerViewerDomRef } from '@/app/viewer-dom';
import {
  activateViewerTab,
  closeViewerTab,
  getViewerTabsSnapshot,
  moveViewerTab,
  subscribeViewerTabs,
} from '@/app/viewer-bridge';
import { t } from '@/localization/i18n';

type DropPlacement = 'before' | 'after';
type DropMarker = { id: number; placement: DropPlacement };
type TabOrderItem = { id: number };

function isSameDropMarker(a: DropMarker | null, b: DropMarker | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.placement === b.placement;
}

function isCurrentTabPlacement(
  tabs: readonly TabOrderItem[],
  draggedId: number,
  targetId: number,
  placement: DropPlacement,
): boolean {
  const draggedIndex = tabs.findIndex(tab => tab.id === draggedId);
  const targetIndex = tabs.findIndex(tab => tab.id === targetId);
  if (draggedIndex === -1 || targetIndex === -1) return true;

  return (
    (placement === 'before' && draggedIndex === targetIndex - 1)
    || (placement === 'after' && draggedIndex === targetIndex + 1)
  );
}

function reorderTabs<T extends TabOrderItem>(
  tabs: readonly T[],
  draggedId: number,
  targetId: number,
  placement: DropPlacement,
): T[] {
  const sourceIndex = tabs.findIndex(tab => tab.id === draggedId);
  if (sourceIndex === -1) return [...tabs];

  const next = [...tabs];
  const [tab] = next.splice(sourceIndex, 1);
  const targetIndex = next.findIndex(candidate => candidate.id === targetId);
  if (targetIndex === -1) return [...tabs];

  next.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, tab);
  return next;
}

function findTabDropTarget(container: HTMLElement, clientX: number, draggedId: number): DropMarker | null {
  const tabElements = Array
    .from(container.querySelectorAll<HTMLElement>('.animation-tab'))
    .filter(tab => Number(tab.dataset.tabId ?? NaN) !== draggedId);
  if (tabElements.length === 0) return null;

  for (const tab of tabElements) {
    const targetId = Number(tab.dataset.tabId ?? NaN);
    if (!Number.isFinite(targetId)) continue;

    const rect = tab.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { id: targetId, placement: 'before' };
    }
  }

  const lastTabId = Number(tabElements[tabElements.length - 1]?.dataset.tabId ?? NaN);
  if (!Number.isFinite(lastTabId)) return null;
  return { id: lastTabId, placement: 'after' };
}

export function TabStrip() {
  const { tabs } = useSyncExternalStore(
    subscribeViewerTabs,
    getViewerTabsSnapshot,
    getViewerTabsSnapshot,
  );
  const dragTabIdRef = useRef<number | null>(null);
  const dragArmedTabIdRef = useRef<number | null>(null);
  const tabsRef = useRef(tabs);
  const [draggedTabId, setDraggedTabId] = useState<number | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker | null>(null);
  tabsRef.current = tabs;

  const finishDrag = () => {
    dragTabIdRef.current = null;
    dragArmedTabIdRef.current = null;
    setDraggedTabId(null);
    setDropMarker(null);
  };

  const updateDropMarker = (marker: DropMarker | null) => {
    setDropMarker(current => (isSameDropMarker(current, marker) ? current : marker));
  };

  useEffect(() => {
    const clearDragArm = () => {
      if (!dragTabIdRef.current) dragArmedTabIdRef.current = null;
    };

    window.addEventListener('mouseup', clearDragArm, true);
    window.addEventListener('blur', finishDrag);
    return () => {
      window.removeEventListener('mouseup', clearDragArm, true);
      window.removeEventListener('blur', finishDrag);
    };
  }, []);

  const armTabDrag = (event: MouseEvent<HTMLDivElement>, tabId: number) => {
    if (tabs.length < 2 || event.button !== 0) return;
    if ((event.target as Element).closest('.animation-tab-close')) return;
    dragArmedTabIdRef.current = tabId;
  };

  const startTabDrag = (event: DragEvent<HTMLDivElement>, tabId: number) => {
    if (dragArmedTabIdRef.current !== tabId) {
      event.preventDefault();
      return;
    }

    dragTabIdRef.current = tabId;
    setDraggedTabId(tabId);
    setDropMarker(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(tabId));
  };

  const applyTabDropTarget = (event: DragEvent<HTMLDivElement>, target: DropMarker | null) => {
    const draggedId = dragTabIdRef.current;
    if (draggedId === null || !target || draggedId === target.id) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    updateDropMarker(target);
    if (isCurrentTabPlacement(tabsRef.current, draggedId, target.id, target.placement)) return;

    tabsRef.current = reorderTabs(tabsRef.current, draggedId, target.id, target.placement);
    moveViewerTab(draggedId, target.id, target.placement);
  };

  const moveDraggedTab = (event: DragEvent<HTMLDivElement>, targetId: number) => {
    const draggedId = dragTabIdRef.current;
    if (draggedId === null || draggedId === targetId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const placement: DropPlacement = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    applyTabDropTarget(event, { id: targetId, placement });
  };

  const moveDraggedTabInContainer = (event: DragEvent<HTMLDivElement>) => {
    const draggedId = dragTabIdRef.current;
    if (draggedId === null) return;
    applyTabDropTarget(event, findTabDropTarget(event.currentTarget, event.clientX, draggedId));
  };

  return (
    <div id="tab-strip" ref={element => registerViewerDomRef('tabStrip', element)} className="tab-strip">
      <div
        id="animation-tabs"
        className="animation-tabs"
        role="tablist"
        aria-label="Animation tabs"
        onDragOver={moveDraggedTabInContainer}
      >
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={[
              'animation-tab',
              tab.active ? 'active' : '',
              draggedTabId === tab.id ? 'dragging' : '',
              dropMarker?.id === tab.id ? `drop-${dropMarker.placement}` : '',
            ].filter(Boolean).join(' ')}
            data-tab-id={tab.id}
            draggable={tabs.length > 1}
            onMouseDown={event => armTabDrag(event, tab.id)}
            onDragStart={event => startTabDrag(event, tab.id)}
            onDragOver={event => moveDraggedTab(event, tab.id)}
            onDrop={(event) => {
              event.preventDefault();
              finishDrag();
            }}
            onDragEnd={finishDrag}
          >
            <button
              type="button"
              className="animation-tab-main"
              role="tab"
              aria-selected={tab.active}
              title={t('tab.switch.title', { name: tab.displayName })}
              onClick={() => activateViewerTab(tab.id)}
            >
              <span className="animation-tab-name">{tab.displayName}</span>
            </button>
            <button
              type="button"
              className="animation-tab-close"
              title={t('tab.close.title')}
              aria-label={t('tab.close.title')}
              onClick={(event) => {
                event.stopPropagation();
                closeViewerTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
