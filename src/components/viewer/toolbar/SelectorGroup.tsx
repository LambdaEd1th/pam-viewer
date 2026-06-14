import { useSyncExternalStore } from 'react';
import { ViewerSelect } from '../Controls';
import {
  getViewerFormSnapshot,
  selectViewerLabel,
  selectViewerSprite,
  subscribeViewerForm,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function SelectorGroup() {
  const { t } = useI18n();
  const {
    labelDisabled,
    labelOptions,
    labelValue,
    spriteDisabled,
    spriteOptions,
    spriteValue,
  } = useSyncExternalStore(
    subscribeViewerForm,
    getViewerFormSnapshot,
    getViewerFormSnapshot,
  );

  return (
    <div className="toolbar-group toolbar-group-selectors">
      <label>{t('label.sprite')}
        <ViewerSelect
          id="sprite-select"
          value={spriteValue}
          disabled={spriteDisabled}
          onChange={event => selectViewerSprite(event.currentTarget.value)}
        >
          {spriteOptions.map(option => (
            <option key={option.value} value={option.value} hidden={option.hidden} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </ViewerSelect>
      </label>
      <label>{t('label.tag')}
        <ViewerSelect
          id="label-select"
          value={labelValue}
          disabled={labelDisabled}
          onChange={event => selectViewerLabel(event.currentTarget.value)}
        >
          {labelOptions.map(option => (
            <option key={option.value} value={option.value} hidden={option.hidden} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </ViewerSelect>
      </label>
    </div>
  );
}
