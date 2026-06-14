import { useSyncExternalStore } from 'react';
import { Image as ImageIcon, RotateCcw, Shapes } from 'lucide-react';
import { ViewerButton } from '../Controls';
import {
  getViewerChromeSnapshot,
  resetViewerZoom,
  subscribeViewerChrome,
  toggleViewerImagesPanel,
  toggleViewerSpritesPanel,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function ViewGroup() {
  const { t } = useI18n();
  const { imagesPanelVisible, spritesPanelVisible } = useSyncExternalStore(
    subscribeViewerChrome,
    getViewerChromeSnapshot,
    getViewerChromeSnapshot,
  );

  return (
    <div className="toolbar-group toolbar-group-view">
      <ViewerButton id="btn-toggle-images" className={`btn-icon btn-icon-text btn-panel-toggle${imagesPanelVisible ? ' active' : ''}`} title={t('btn.toggleImages.title')} onClick={toggleViewerImagesPanel}><ImageIcon aria-hidden="true" /><span>{t('btn.toggleImages')}</span></ViewerButton>
      <ViewerButton id="btn-toggle-sprites" className={`btn-icon btn-icon-text btn-panel-toggle${spritesPanelVisible ? ' active' : ''}`} title={t('btn.toggleSprites.title')} onClick={toggleViewerSpritesPanel}><Shapes aria-hidden="true" /><span>{t('btn.toggleSprites')}</span></ViewerButton>
      <ViewerButton id="btn-zoom-reset" className="btn-icon btn-icon-text" title={t('btn.zoomReset.title')} onClick={resetViewerZoom}><RotateCcw aria-hidden="true" /><span>{t('btn.zoomReset')}</span></ViewerButton>
    </div>
  );
}
