import { useSyncExternalStore } from 'react';
import { ViewerInput, ViewerSelect } from '../Controls';
import {
  getViewerFormSnapshot,
  selectViewerSizeScale,
  setViewerSizeHeight,
  setViewerSizeWidth,
  subscribeViewerForm,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function SizeGroup() {
  const { t } = useI18n();
  const {
    sizeDisabled,
    sizeHeightValue,
    sizeScaleDisabled,
    sizeScaleValue,
    sizeWidthValue,
  } = useSyncExternalStore(
    subscribeViewerForm,
    getViewerFormSnapshot,
    getViewerFormSnapshot,
  );

  return (
    <div className="toolbar-group toolbar-group-size">
      <label className="size-label" title={t('label.size.title')}>{t('label.size')}
        <ViewerInput
          id="size-w"
          type="number"
          min="1"
          max="99999"
          value={sizeWidthValue}
          disabled={sizeDisabled}
          onChange={event => setViewerSizeWidth(event.currentTarget.value)}
        />
        <span>×</span>
        <ViewerInput
          id="size-h"
          type="number"
          min="1"
          max="99999"
          value={sizeHeightValue}
          disabled={sizeDisabled}
          onChange={event => setViewerSizeHeight(event.currentTarget.value)}
        />
        <ViewerSelect
          id="size-scale"
          small
          title={t('size.scale.title')}
          value={sizeScaleValue}
          disabled={sizeScaleDisabled}
          onChange={event => selectViewerSizeScale(event.currentTarget.value)}
        >
          <option value="custom">{t('size.scale.custom')}</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="3">3×</option>
          <option value="4">4×</option>
        </ViewerSelect>
      </label>
    </div>
  );
}
