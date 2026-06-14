import { ViewerSelect } from '../Controls';
import { useSyncExternalStore } from 'react';
import {
  getViewerFormSnapshot,
  selectViewerTheme,
  subscribeViewerForm,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function PreferenceGroup() {
  const { getLangLabel, lang, langs, setLang, t } = useI18n();
  const { themeValue } = useSyncExternalStore(
    subscribeViewerForm,
    getViewerFormSnapshot,
    getViewerFormSnapshot,
  );

  return (
    <div className="toolbar-group toolbar-group-prefs">
      <label className="lang-label"><span>{t('label.lang')}</span>
        <ViewerSelect id="lang-select" value={lang} onChange={event => setLang(event.currentTarget.value)}>
          {langs.map(value => (
            <option key={value} value={value}>{getLangLabel(value)}</option>
          ))}
        </ViewerSelect>
      </label>
      <label className="theme-label">{t('label.theme')}
        <ViewerSelect
          id="theme-select"
          value={themeValue}
          title={t('theme.select.title')}
          onChange={event => selectViewerTheme(event.currentTarget.value)}
        >
          <option value="system">{t('theme.system')}</option>
          <option value="light">{t('theme.light')}</option>
          <option value="dark">{t('theme.dark')}</option>
        </ViewerSelect>
      </label>
    </div>
  );
}
