import { publishViewerPlayback } from '../viewer-bridge';
import type { Animation } from '../../domain/types';
import type { FrameRange } from './types';

interface PlaybackControllerOptions {
  getActiveSprite: () => Animation['mainSprite'];
  getFrameRange: () => FrameRange;
  setFrameRange: (range: FrameRange) => void;
  getCurrentFrame: () => number;
  setCurrentFrame: (frame: number) => void;
  getSpeedValue: () => string;
  isLoopChecked: () => boolean;
  isReverseChecked: () => boolean;
  setPlayingState: (isPlaying: boolean) => void;
  setFrameText: (frameText: string) => void;
  drawCurrentFrame: () => void;
}

export interface PlaybackController {
  updateSliderRange: () => void;
  updateRangeInputs: () => void;
  updateFrameDisplay: () => void;
  beginFrameScrub: () => void;
  setFrame: (value: string) => void;
  endFrameScrub: () => void;
  setRangeBegin: (value: string) => void;
  setRangeEnd: (value: string) => void;
  toggle: () => void;
  previousFrame: () => void;
  nextFrame: () => void;
  play: () => void;
  stop: () => void;
}

export function createPlaybackController(options: PlaybackControllerOptions): PlaybackController {
  let playing = false;
  let wasPlayingBeforeSlider = false;
  let lastTimestamp = 0;
  let accumulator = 0;
  let rafId: number | null = null;

  function updateSliderRange(): void {
    const frameRange = options.getFrameRange();
    publishViewerPlayback({
      frameSliderMin: String(frameRange.begin),
      frameSliderMax: String(frameRange.end),
      frameSliderValue: String(options.getCurrentFrame()),
      frameSliderDisabled: !options.getActiveSprite(),
    });
  }

  function updateRangeInputs(): void {
    const activeSprite = options.getActiveSprite();
    const frameRange = options.getFrameRange();
    const maxFrame = activeSprite ? activeSprite.frame.length - 1 : 0;
    publishViewerPlayback({
      rangeBeginValue: String(frameRange.begin),
      rangeEndValue: String(frameRange.end),
      rangeMax: String(maxFrame),
      rangeDisabled: !activeSprite,
    });
  }

  function updateFrameDisplay(): void {
    const activeSprite = options.getActiveSprite();
    const total = activeSprite ? activeSprite.frame.length : 0;
    if (total === 0) {
      options.setFrameText('0 / 0');
      publishViewerPlayback({ frameSliderValue: '0' });
      return;
    }
    const currentFrame = options.getCurrentFrame();
    options.setFrameText(`${currentFrame} / ${total - 1}`);
    publishViewerPlayback({ frameSliderValue: String(currentFrame) });
  }

  function setRangeBeginValue(value: string): void {
    const frameRange = options.getFrameRange();
    const v = Math.max(0, Math.min(parseInt(value, 10) || 0, frameRange.end));
    options.setFrameRange({ ...frameRange, begin: v });
    if (options.getCurrentFrame() < v) options.setCurrentFrame(v);
    updateSliderRange();
    updateRangeInputs();
    updateFrameDisplay();
    options.drawCurrentFrame();
  }

  function setRangeEndValue(value: string): void {
    const activeSprite = options.getActiveSprite();
    const frameRange = options.getFrameRange();
    const maxFrame = activeSprite ? activeSprite.frame.length - 1 : 0;
    const v = Math.max(frameRange.begin, Math.min(parseInt(value, 10) || 0, maxFrame));
    options.setFrameRange({ ...frameRange, end: v });
    if (options.getCurrentFrame() > v) options.setCurrentFrame(v);
    updateSliderRange();
    updateRangeInputs();
    updateFrameDisplay();
    options.drawCurrentFrame();
  }

  function beginFrameScrub(): void {
    wasPlayingBeforeSlider = playing;
    if (playing) stop();
  }

  function setFrameValue(value: string): void {
    options.setCurrentFrame(parseInt(value, 10));
    updateFrameDisplay();
    options.drawCurrentFrame();
  }

  function endFrameScrub(): void {
    if (wasPlayingBeforeSlider) play();
  }

  function togglePlayback(): void {
    if (playing) stop();
    else play();
  }

  function previousFrame(): void {
    stop();
    const frameRange = options.getFrameRange();
    const currentFrame = options.getCurrentFrame();
    options.setCurrentFrame(currentFrame <= frameRange.begin ? frameRange.end : currentFrame - 1);
    updateFrameDisplay();
    options.drawCurrentFrame();
  }

  function nextFrame(): void {
    stop();
    const frameRange = options.getFrameRange();
    const currentFrame = options.getCurrentFrame();
    options.setCurrentFrame(currentFrame >= frameRange.end ? frameRange.begin : currentFrame + 1);
    updateFrameDisplay();
    options.drawCurrentFrame();
  }

  function play(): void {
    if (!options.getActiveSprite()) return;
    playing = true;
    options.setPlayingState(true);
    lastTimestamp = performance.now();
    accumulator = 0;
    tick(lastTimestamp);
  }

  function stop(): void {
    playing = false;
    options.setPlayingState(false);
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function tick(timestamp: number): void {
    if (!playing) return;
    const fps = parseFloat(options.getSpeedValue()) || 30;
    const frameDuration = 1000 / fps;
    const delta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    accumulator += delta;

    const reverse = options.isReverseChecked();
    let frameRange = options.getFrameRange();
    let currentFrame = options.getCurrentFrame();
    let advanced = false;
    while (accumulator >= frameDuration) {
      accumulator -= frameDuration;
      currentFrame += reverse ? -1 : 1;
      if (!reverse && currentFrame > frameRange.end) {
        if (options.isLoopChecked()) {
          currentFrame = frameRange.begin;
        } else {
          options.setCurrentFrame(frameRange.end);
          stop();
          updateFrameDisplay();
          options.drawCurrentFrame();
          return;
        }
      } else if (reverse && currentFrame < frameRange.begin) {
        if (options.isLoopChecked()) {
          currentFrame = frameRange.end;
        } else {
          options.setCurrentFrame(frameRange.begin);
          stop();
          updateFrameDisplay();
          options.drawCurrentFrame();
          return;
        }
      }
      advanced = true;
      frameRange = options.getFrameRange();
    }

    if (advanced) {
      options.setCurrentFrame(currentFrame);
      updateFrameDisplay();
      options.drawCurrentFrame();
    }
    rafId = requestAnimationFrame(tick);
  }

  return {
    updateSliderRange,
    updateRangeInputs,
    updateFrameDisplay,
    beginFrameScrub,
    setFrame: setFrameValue,
    endFrameScrub,
    toggle: togglePlayback,
    previousFrame,
    nextFrame,
    play,
    stop,
    setRangeBegin: setRangeBeginValue,
    setRangeEnd: setRangeEndValue,
  };
}
