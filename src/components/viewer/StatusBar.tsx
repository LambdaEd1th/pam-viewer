import { useSyncExternalStore } from 'react';
import { getViewerChromeSnapshot, subscribeViewerChrome } from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function StatusBar() {
  const { t } = useI18n();
  const { coord, exportSize, status, zoom } = useSyncExternalStore(
    subscribeViewerChrome,
    getViewerChromeSnapshot,
    getViewerChromeSnapshot,
  );

  return (
    <footer id="statusbar">
      <span id="status-text">{status || t('status.hint')}</span>
      <span id="anim-size-display">{exportSize}</span>
      <span id="coord-display">{coord}</span>
      <span id="zoom-display">{zoom}</span>
      <a id="author-link" href="https://space.bilibili.com/8217621" target="_blank" rel="noopener noreferrer">by LambdaEd1th</a>
    </footer>
  );
}
