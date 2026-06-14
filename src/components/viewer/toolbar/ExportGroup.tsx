import { useSyncExternalStore } from 'react';
import { Camera, Clapperboard, FileImage, Film } from 'lucide-react';
import { ViewerButton } from '../Controls';
import {
  exportViewerApng,
  exportViewerFla,
  exportViewerPng,
  exportViewerWebp,
  getViewerCommandSnapshot,
  subscribeViewerCommand,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function ExportGroup() {
  const { t } = useI18n();
  const { commandDisabled, webpDisabled, webpTitle } = useSyncExternalStore(
    subscribeViewerCommand,
    getViewerCommandSnapshot,
    getViewerCommandSnapshot,
  );

  return (
    <div className="toolbar-group toolbar-group-export">
      <ViewerButton id="btn-export-png" title={t('btn.exportPng.title')} disabled={commandDisabled} onClick={exportViewerPng}><Camera aria-hidden="true" />PNG</ViewerButton>
      <ViewerButton id="btn-export-apng" title={t('btn.exportApng.title')} disabled={commandDisabled} onClick={exportViewerApng}><FileImage aria-hidden="true" />APNG</ViewerButton>
      <ViewerButton id="btn-export-webp" title={webpTitle || t('btn.exportWebp.title')} disabled={webpDisabled} onClick={exportViewerWebp}><Film aria-hidden="true" />WebP</ViewerButton>
      <ViewerButton id="btn-export-fla" title={t('btn.exportFla.title')} disabled={commandDisabled} onClick={exportViewerFla}><Clapperboard aria-hidden="true" />FLA</ViewerButton>
    </div>
  );
}
