import { useSyncExternalStore } from 'react';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { ViewerButton, ViewerInput } from '../Controls';
import {
  beginViewerFrameScrub,
  endViewerFrameScrub,
  getViewerChromeSnapshot,
  getViewerPlaybackSnapshot,
  nextViewerFrame,
  previousViewerFrame,
  setViewerFrame,
  setViewerRangeBegin,
  setViewerRangeEnd,
  subscribeViewerChrome,
  subscribeViewerPlayback,
  toggleViewerPlayback,
} from '@/app/viewer-bridge';
import { useI18n } from '@/localization/use-i18n';

export function PlaybackGroup() {
  const { t } = useI18n();
  const { frame, playing } = useSyncExternalStore(
    subscribeViewerChrome,
    getViewerChromeSnapshot,
    getViewerChromeSnapshot,
  );
  const {
    controlsDisabled,
    frameSliderDisabled,
    frameSliderMax,
    frameSliderMin,
    frameSliderValue,
    rangeBeginValue,
    rangeDisabled,
    rangeEndValue,
    rangeMax,
  } = useSyncExternalStore(
    subscribeViewerPlayback,
    getViewerPlaybackSnapshot,
    getViewerPlaybackSnapshot,
  );

  return (
    <div className="toolbar-group toolbar-group-playback">
      <ViewerButton id="btn-prev" className="btn-icon" title={t('btn.prev.title')} disabled={controlsDisabled} onClick={previousViewerFrame}><SkipBack aria-hidden="true" /></ViewerButton>
      <ViewerButton id="btn-play" className="btn-icon btn-play" title={t('btn.play.title')} data-playing={playing ? 'true' : 'false'} disabled={controlsDisabled} onClick={toggleViewerPlayback}>
        <Play className="play-icon" aria-hidden="true" />
        <Pause className="pause-icon" aria-hidden="true" />
      </ViewerButton>
      <ViewerButton id="btn-next" className="btn-icon" title={t('btn.next.title')} disabled={controlsDisabled} onClick={nextViewerFrame}><SkipForward aria-hidden="true" /></ViewerButton>
      <span id="frame-display">{frame}</span>
      <ViewerInput
        id="frame-slider"
        type="range"
        min={frameSliderMin}
        max={frameSliderMax}
        value={frameSliderValue}
        step="1"
        title={t('frame.slider.title')}
        disabled={frameSliderDisabled}
        onPointerDown={beginViewerFrameScrub}
        onChange={event => setViewerFrame(event.currentTarget.value)}
        onPointerUp={endViewerFrameScrub}
      />
      <label className="frame-range-label">{t('label.range')}
        <ViewerInput
          id="range-begin"
          type="number"
          min="0"
          max={rangeMax}
          value={rangeBeginValue}
          title={t('range.begin.title')}
          disabled={rangeDisabled}
          onChange={event => setViewerRangeBegin(event.currentTarget.value)}
        />
        <span>–</span>
        <ViewerInput
          id="range-end"
          type="number"
          min="0"
          max={rangeMax}
          value={rangeEndValue}
          title={t('range.end.title')}
          disabled={rangeDisabled}
          onChange={event => setViewerRangeEnd(event.currentTarget.value)}
        />
      </label>
    </div>
  );
}
