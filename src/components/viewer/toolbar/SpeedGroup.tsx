import { useSyncExternalStore } from 'react';
import { ViewerCheckbox, ViewerInput, ViewerSelect } from '../Controls';
import {
  getViewerFormSnapshot,
  selectViewerSpeedPreset,
  setViewerAutoplay,
  setViewerBoundary,
  setViewerKeepSpeed,
  setViewerLoop,
  setViewerReverse,
  setViewerSpeed,
  subscribeViewerForm,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function SpeedGroup() {
  const { t } = useI18n();
  const {
    autoplayChecked,
    boundaryChecked,
    keepSpeedChecked,
    loopChecked,
    reverseChecked,
    speedDisabled,
    speedPresetDisabled,
    speedPresetValue,
    speedValue,
  } = useSyncExternalStore(
    subscribeViewerForm,
    getViewerFormSnapshot,
    getViewerFormSnapshot,
  );

  return (
    <div className="toolbar-group toolbar-group-speed">
      <label className="speed-label">{t('label.speed')}
        <span className="speed-control">
          <ViewerInput
            id="speed-input"
            type="number"
            value={speedValue}
            min="1"
            max="120"
            step="1"
            disabled={speedDisabled}
            onChange={event => setViewerSpeed(event.currentTarget.value)}
          />
          <span className="speed-unit">FPS</span>
        </span>
        <ViewerSelect
          id="speed-preset-select"
          small
          controlClassName="speed-preset-control"
          value={speedPresetValue}
          disabled={speedPresetDisabled}
          title={t('speed.preset.title')}
          onChange={event => selectViewerSpeedPreset(event.currentTarget.value)}
        >
          <option value="custom" hidden>{t('size.scale.custom')}</option>
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
          <option value="3">3×</option>
          <option value="4">4×</option>
        </ViewerSelect>
      </label>
      <ViewerCheckbox id="loop-check" checked={loopChecked} onChange={event => setViewerLoop(event.currentTarget.checked)}>{t('check.loop')}</ViewerCheckbox>
      <ViewerCheckbox id="reverse-check" checked={reverseChecked} onChange={event => setViewerReverse(event.currentTarget.checked)}>{t('check.reverse')}</ViewerCheckbox>
      <ViewerCheckbox id="autoplay-check" checked={autoplayChecked} onChange={event => setViewerAutoplay(event.currentTarget.checked)}>{t('check.autoplay')}</ViewerCheckbox>
      <ViewerCheckbox id="keep-speed-check" checked={keepSpeedChecked} onChange={event => setViewerKeepSpeed(event.currentTarget.checked)}>{t('check.keepSpeed')}</ViewerCheckbox>
      <ViewerCheckbox id="boundary-check" checked={boundaryChecked} onChange={event => setViewerBoundary(event.currentTarget.checked)}>{t('check.boundary')}</ViewerCheckbox>
    </div>
  );
}
