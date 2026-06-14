import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { ViewerButton } from './Controls';
import { cancelViewerExport, getViewerExportSnapshot, subscribeViewerExport } from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function ExportOverlay() {
  const { t } = useI18n();
  const { progress, status, title, visible } = useSyncExternalStore(
    subscribeViewerExport,
    getViewerExportSnapshot,
    getViewerExportSnapshot,
  );

  return (
    <div id="export-overlay" className={`export-overlay${visible ? '' : ' hidden'}`}>
      <div className="export-dialog">
        <div className="export-title">{title || t('export.title')}</div>
        <progress id="export-progress" max="100" value={progress} />
        <div id="export-status">{status || t('export.preparing')}</div>
        <ViewerButton id="export-cancel" onClick={cancelViewerExport}><X aria-hidden="true" /><span>{t('export.cancel')}</span></ViewerButton>
      </div>
    </div>
  );
}
