import { useEffect, useRef, useState } from 'react';
import type { ComponentType, DragEvent, MouseEvent } from 'react';
import { GripVertical } from 'lucide-react';
import {
  ConvertGroup,
  ExportGroup,
  FileGroup,
  LayerGroup,
  PlaybackGroup,
  PreferenceGroup,
  SelectorGroup,
  SizeGroup,
  SpeedGroup,
  ViewGroup,
} from './toolbar/index';
import { useI18n } from '@/localization/use-i18n';

const TOOLBAR_LAYOUT_KEY = 'pam-viewer-toolbar-layout';

const GROUP_COMPONENTS = {
  file: FileGroup,
  selectors: SelectorGroup,
  playback: PlaybackGroup,
  speed: SpeedGroup,
  layers: LayerGroup,
  view: ViewGroup,
  size: SizeGroup,
  prefs: PreferenceGroup,
  export: ExportGroup,
  convert: ConvertGroup,
} satisfies Record<string, ComponentType>;

type ToolbarGroupId = keyof typeof GROUP_COMPONENTS;
type ToolbarRows = ToolbarGroupId[][];
type DropPlacement = 'before' | 'after';
type DropMarker = { id: ToolbarGroupId; placement: DropPlacement };
type ToolbarDropTarget =
  | { type: 'group'; id: ToolbarGroupId; placement: DropPlacement }
  | { type: 'row-end'; rowIndex: number };

const GROUP_IDS = Object.keys(GROUP_COMPONENTS) as ToolbarGroupId[];

const DEFAULT_TOOLBAR_ROWS: ToolbarRows = [
  ['file', 'selectors', 'playback'],
  ['speed', 'layers', 'view', 'size', 'prefs', 'export', 'convert'],
];

function cloneRows(rows: ToolbarRows): ToolbarRows {
  return rows.map(row => [...row]);
}

function normalizeToolbarRows(value: unknown): ToolbarRows {
  const sourceRows = Array.isArray(value)
    ? value
    : DEFAULT_TOOLBAR_ROWS;
  const seen = new Set<ToolbarGroupId>();
  const rows: ToolbarRows = [[], []];

  sourceRows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) return;
    const targetRow = rows[Math.min(rowIndex, rows.length - 1)];
    row.forEach((id) => {
      if (typeof id !== 'string' || !(id in GROUP_COMPONENTS)) return;
      const groupId = id as ToolbarGroupId;
      if (seen.has(groupId)) return;
      seen.add(groupId);
      targetRow.push(groupId);
    });
  });

  GROUP_IDS.forEach((id) => {
    if (!seen.has(id)) rows[rows.length - 1].push(id);
  });

  return rows;
}

function readToolbarRows(): ToolbarRows {
  try {
    return normalizeToolbarRows(JSON.parse(localStorage.getItem(TOOLBAR_LAYOUT_KEY) ?? 'null'));
  } catch {
    return cloneRows(DEFAULT_TOOLBAR_ROWS);
  }
}

function moveGroup(rows: ToolbarRows, groupId: ToolbarGroupId, targetId: ToolbarGroupId, placement: DropPlacement): ToolbarRows {
  if (groupId === targetId) return rows;

  const sourceRowIndex = rows.findIndex(row => row.includes(groupId));
  const targetRowIndex = rows.findIndex(row => row.includes(targetId));
  if (sourceRowIndex === -1 || targetRowIndex === -1) return rows;

  const sourceIndex = rows[sourceRowIndex].indexOf(groupId);
  const targetIndex = rows[targetRowIndex].indexOf(targetId);
  if (
    sourceRowIndex === targetRowIndex
    && (
      (placement === 'before' && sourceIndex === targetIndex - 1)
      || (placement === 'after' && sourceIndex === targetIndex + 1)
    )
  ) {
    return rows;
  }

  const next = cloneRows(rows);
  const sourceRow = next[sourceRowIndex];
  sourceRow.splice(sourceRow.indexOf(groupId), 1);

  const targetRow = next[targetRowIndex];
  const insertTargetIndex = targetRow.indexOf(targetId);
  targetRow.splice(placement === 'after' ? insertTargetIndex + 1 : insertTargetIndex, 0, groupId);
  return next;
}

function moveGroupToRowEnd(rows: ToolbarRows, groupId: ToolbarGroupId, rowIndex: number): ToolbarRows {
  const sourceRowIndex = rows.findIndex(row => row.includes(groupId));
  const targetRow = rows[rowIndex];
  if (sourceRowIndex === -1 || !targetRow) return rows;
  if (sourceRowIndex === rowIndex && targetRow[targetRow.length - 1] === groupId) return rows;

  const next = cloneRows(rows);
  const sourceRow = next[sourceRowIndex];
  const nextTargetRow = next[rowIndex];
  sourceRow.splice(sourceRow.indexOf(groupId), 1);
  nextTargetRow.push(groupId);
  return next;
}

function isSameDropMarker(a: DropMarker | null, b: DropMarker | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.placement === b.placement;
}

function getDistanceToRectY(rect: DOMRect, clientY: number): number {
  if (clientY < rect.top) return rect.top - clientY;
  if (clientY > rect.bottom) return clientY - rect.bottom;
  return 0;
}

function findRowDropTarget(
  row: HTMLElement,
  clientX: number,
  clientY: number,
  draggedId: ToolbarGroupId,
): ToolbarDropTarget | null {
  const rowIndex = Number(row.dataset.toolbarRowIndex ?? NaN);
  if (!Number.isFinite(rowIndex)) return null;

  const groups = Array
    .from(row.querySelectorAll<HTMLElement>('.toolbar-group-shell'))
    .filter(group => group.dataset.toolbarGroupId !== draggedId);
  if (groups.length === 0) return { type: 'row-end', rowIndex };

  const nearestLineDistance = Math.min(
    ...groups.map(group => getDistanceToRectY(group.getBoundingClientRect(), clientY)),
  );
  const lineGroups = groups
    .filter(group => getDistanceToRectY(group.getBoundingClientRect(), clientY) <= nearestLineDistance + 2)
    .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

  for (const group of lineGroups) {
    const groupId = group.dataset.toolbarGroupId;
    if (!groupId || !(groupId in GROUP_COMPONENTS)) continue;

    const rect = group.getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) {
      return { type: 'group', id: groupId as ToolbarGroupId, placement: 'before' };
    }
  }

  const lastGroup = lineGroups[lineGroups.length - 1];
  const lastGroupId = lastGroup?.dataset.toolbarGroupId;
  if (!lastGroupId || !(lastGroupId in GROUP_COMPONENTS)) return { type: 'row-end', rowIndex };
  return { type: 'group', id: lastGroupId as ToolbarGroupId, placement: 'after' };
}

export function Toolbar() {
  const { t } = useI18n();
  const dragGroupIdRef = useRef<ToolbarGroupId | null>(null);
  const dragHandleIdRef = useRef<ToolbarGroupId | null>(null);
  const [rows, setRows] = useState<ToolbarRows>(() => readToolbarRows());
  const [draggedGroupId, setDraggedGroupId] = useState<ToolbarGroupId | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(TOOLBAR_LAYOUT_KEY, JSON.stringify(rows));
    } catch (error) {
      console.warn('Failed to save toolbar layout:', error);
    }
  }, [rows]);

  const finishDrag = () => {
    dragGroupIdRef.current = null;
    dragHandleIdRef.current = null;
    setDraggedGroupId(null);
    setDropMarker(null);
  };

  const updateDropMarker = (marker: DropMarker | null) => {
    setDropMarker(current => (isSameDropMarker(current, marker) ? current : marker));
  };

  useEffect(() => {
    const clearHandleArm = () => {
      if (!dragGroupIdRef.current) dragHandleIdRef.current = null;
    };

    window.addEventListener('mouseup', clearHandleArm, true);
    window.addEventListener('blur', finishDrag);
    return () => {
      window.removeEventListener('mouseup', clearHandleArm, true);
      window.removeEventListener('blur', finishDrag);
    };
  }, []);

  const armDragHandle = (event: MouseEvent<HTMLButtonElement>, id: ToolbarGroupId) => {
    if (event.button !== 0) return;
    dragHandleIdRef.current = id;
  };

  const startGroupDrag = (event: DragEvent<HTMLDivElement>, id: ToolbarGroupId) => {
    if (dragHandleIdRef.current !== id) {
      event.preventDefault();
      return;
    }

    dragGroupIdRef.current = id;
    setDraggedGroupId(id);
    setDropMarker(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const applyDropTarget = (event: DragEvent<HTMLElement>, target: ToolbarDropTarget) => {
    const draggedId = dragGroupIdRef.current;
    if (!draggedId) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';

    if (target.type === 'group') {
      if (target.id === draggedId) return;
      updateDropMarker({ id: target.id, placement: target.placement });
      setRows(currentRows => moveGroup(currentRows, draggedId, target.id, target.placement));
      return;
    }

    updateDropMarker(null);
    setRows(currentRows => moveGroupToRowEnd(currentRows, draggedId, target.rowIndex));
  };

  const moveDraggedGroup = (event: DragEvent<HTMLElement>, targetId: ToolbarGroupId) => {
    const draggedId = dragGroupIdRef.current;
    if (!draggedId || draggedId === targetId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const placement: DropPlacement = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
    applyDropTarget(event, { type: 'group', id: targetId, placement });
  };

  const moveDraggedGroupToRowEnd = (event: DragEvent<HTMLDivElement>, rowIndex: number) => {
    const draggedId = dragGroupIdRef.current;
    if (!draggedId) return;

    const row = event.currentTarget;
    const target = findRowDropTarget(row, event.clientX, event.clientY, draggedId) ?? { type: 'row-end' as const, rowIndex };
    applyDropTarget(event, target);
  };

  return (
    <header id="toolbar">
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className={`toolbar-row toolbar-row-${rowIndex === 0 ? 'primary' : 'secondary'}`}
          data-toolbar-row-index={rowIndex}
          onDragOver={event => moveDraggedGroupToRowEnd(event, rowIndex)}
          onDrop={(event) => {
            event.preventDefault();
            finishDrag();
          }}
        >
          {row.map((id) => {
            const Group = GROUP_COMPONENTS[id];
            return (
              <div
                key={id}
                className={[
                  'toolbar-group-shell',
                  draggedGroupId === id ? 'dragging' : '',
                  dropMarker?.id === id ? `drop-${dropMarker.placement}` : '',
                ].filter(Boolean).join(' ')}
                data-toolbar-group-id={id}
                draggable
                onDragStart={event => startGroupDrag(event, id)}
                onDragOver={event => moveDraggedGroup(event, id)}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  finishDrag();
                }}
                onDragEnd={finishDrag}
              >
                <button
                  type="button"
                  className="toolbar-group-drag-handle"
                  title={t('toolbar.move.title')}
                  aria-label={t('toolbar.move.title')}
                  onMouseDown={event => armDragHandle(event, id)}
                >
                  <GripVertical aria-hidden="true" />
                </button>
                <Group />
              </div>
            );
          })}
        </div>
      ))}
    </header>
  );
}
