import { useRef, useSyncExternalStore } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { ViewerButton } from '../Controls';
import { readDirectoryHandle } from '@/app/files';
import {
  clearViewerAnimation,
  getViewerChromeSnapshot,
  getViewerCommandSnapshot,
  loadViewerFiles,
  subscribeViewerChrome,
  subscribeViewerCommand,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function FileGroup() {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { animationName } = useSyncExternalStore(
    subscribeViewerChrome,
    getViewerChromeSnapshot,
    getViewerChromeSnapshot,
  );
  const { clearDisabled } = useSyncExternalStore(
    subscribeViewerCommand,
    getViewerCommandSnapshot,
    getViewerCommandSnapshot,
  );
  const requestLoad = async () => {
    const directoryPicker = (window as unknown as {
      showDirectoryPicker?: () => Promise<Parameters<typeof readDirectoryHandle>[0]>;
    }).showDirectoryPicker;
    if (typeof directoryPicker === 'function') {
      try {
        const dirHandle = await directoryPicker();
        loadViewerFiles(await readDirectoryHandle(dirHandle));
        return;
      } catch (error) {
        if ((error as DOMException).name === 'AbortError') return;
      }
    }

    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  };

  return (
    <div className="toolbar-group toolbar-group-file">
      <ViewerButton id="btn-load" className="btn-primary" title={t('btn.load.title')} onClick={() => { void requestLoad(); }}>
        <FolderOpen aria-hidden="true" />
        <span>{t('btn.load')}</span>
      </ViewerButton>
      <ViewerButton id="btn-clear" className="btn-quiet" title={t('btn.clear.title')} disabled={clearDisabled} onClick={clearViewerAnimation}>
        <X aria-hidden="true" />
        <span>{t('btn.clear')}</span>
      </ViewerButton>
      <span id="anim-name" className="toolbar-label">{animationName || t('anim.unloaded')}</span>
      <input
        id="file-input"
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={event => {
          const { files } = event.currentTarget;
          if (files && files.length > 0) loadViewerFiles(Array.from(files));
        }}
      />
    </div>
  );
}
