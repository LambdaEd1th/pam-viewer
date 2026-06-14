import { useSyncExternalStore } from 'react';
import { FileArchive, FileCode2, FileJson, RefreshCw } from 'lucide-react';
import { ViewerButton } from '../Controls';
import {
  convertViewerJson,
  convertViewerPam,
  convertViewerToml,
  convertViewerYaml,
  getViewerCommandSnapshot,
  subscribeViewerCommand,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function ConvertGroup() {
  const { t } = useI18n();
  const { commandDisabled } = useSyncExternalStore(
    subscribeViewerCommand,
    getViewerCommandSnapshot,
    getViewerCommandSnapshot,
  );

  return (
    <div className="toolbar-group toolbar-group-convert">
      <ViewerButton id="btn-convert-json" title={t('btn.convertJson.title')} disabled={commandDisabled} onClick={convertViewerJson}><FileJson aria-hidden="true" />JSON</ViewerButton>
      <ViewerButton id="btn-convert-yaml" title={t('btn.convertYaml.title')} disabled={commandDisabled} onClick={convertViewerYaml}><FileCode2 aria-hidden="true" />YAML</ViewerButton>
      <ViewerButton id="btn-convert-toml" title={t('btn.convertToml.title')} disabled={commandDisabled} onClick={convertViewerToml}><FileArchive aria-hidden="true" />TOML</ViewerButton>
      <ViewerButton id="btn-convert-pam" title={t('btn.convertPam.title')} disabled={commandDisabled} onClick={convertViewerPam}><RefreshCw aria-hidden="true" />PAM</ViewerButton>
    </div>
  );
}
