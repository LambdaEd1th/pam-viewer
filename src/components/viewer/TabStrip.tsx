import { useSyncExternalStore } from 'react';
import { registerViewerDomRef } from '@/app/viewer-dom';
import {
  activateViewerTab,
  closeViewerTab,
  getViewerTabsSnapshot,
  subscribeViewerTabs,
} from '@/app/viewer-bridge';
import { t } from '@/localization/i18n';

export function TabStrip() {
  const { tabs } = useSyncExternalStore(
    subscribeViewerTabs,
    getViewerTabsSnapshot,
    getViewerTabsSnapshot,
  );

  return (
    <div id="tab-strip" ref={element => registerViewerDomRef('tabStrip', element)} className="tab-strip">
      <div id="animation-tabs" className="animation-tabs" role="tablist" aria-label="Animation tabs">
        {tabs.map(tab => (
          <div key={tab.id} className={`animation-tab${tab.active ? ' active' : ''}`}>
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
