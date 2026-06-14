import { useSyncExternalStore } from 'react';
import { ViewerCheckbox, ViewerSelect } from '../Controls';
import {
  getViewerFormSnapshot,
  selectViewerPlantLayer,
  selectViewerZombieState,
  setViewerGroundSwatch,
  subscribeViewerForm,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function LayerGroup() {
  const { t } = useI18n();
  const {
    groundSwatchChecked,
    groundSwatchDisabled,
    plantLayerDisabled,
    plantLayerOptions,
    plantLayerValue,
    zombieStateDisabled,
    zombieStateOptions,
    zombieStateValue,
  } = useSyncExternalStore(
    subscribeViewerForm,
    getViewerFormSnapshot,
    getViewerFormSnapshot,
  );

  return (
    <div className="toolbar-group toolbar-group-layers">
      <label>{t('label.plantLayer')}
        <ViewerSelect
          id="plant-layer-select"
          value={plantLayerValue}
          disabled={plantLayerDisabled}
          onChange={event => selectViewerPlantLayer(event.currentTarget.value)}
        >
          {plantLayerOptions.map(option => (
            <option key={option.value} value={option.value} hidden={option.hidden} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </ViewerSelect>
      </label>
      <label>{t('label.zombieState')}
        <ViewerSelect
          id="zombie-state-select"
          value={zombieStateValue}
          disabled={zombieStateDisabled}
          onChange={event => selectViewerZombieState(event.currentTarget.value)}
        >
          {zombieStateOptions.map(option => (
            <option key={option.value} value={option.value} hidden={option.hidden} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </ViewerSelect>
      </label>
      <ViewerCheckbox
        id="ground-swatch-check"
        checked={groundSwatchChecked}
        disabled={groundSwatchDisabled}
        onChange={event => setViewerGroundSwatch(event.currentTarget.checked)}
      >
        {t('check.groundSwatch')}
      </ViewerCheckbox>
    </div>
  );
}
