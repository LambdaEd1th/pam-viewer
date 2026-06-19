export interface ViewerTabItem {
  id: number;
  displayName: string;
  active: boolean;
}

export interface ViewerTabsSnapshot {
  tabs: ViewerTabItem[];
}

export interface ViewerChromeSnapshot {
  animationName: string;
  status: string;
  exportSize: string;
  coord: string;
  zoom: string;
  frame: string;
  playing: boolean;
  dropHintVisible: boolean;
  stageDragOver: boolean;
  stageCursor: string;
  imagesPanelVisible: boolean;
  spritesPanelVisible: boolean;
}

export interface ViewerLayoutSnapshot {
  imagesPanelVisible: boolean;
  spritesPanelVisible: boolean;
  imagePanelWidth: number;
  spritePanelWidth: number;
}

export interface ViewerExportSnapshot {
  visible: boolean;
  title: string;
  status: string;
  progress: number;
}

export interface ViewerPlaybackSnapshot {
  controlsDisabled: boolean;
  frameSliderMin: string;
  frameSliderMax: string;
  frameSliderValue: string;
  frameSliderDisabled: boolean;
  rangeBeginValue: string;
  rangeEndValue: string;
  rangeMax: string;
  rangeDisabled: boolean;
}

export interface ViewerCommandSnapshot {
  clearDisabled: boolean;
  commandDisabled: boolean;
  webpDisabled: boolean;
  webpTitle: string;
}

export interface ViewerImageItem {
  index: number;
  name: string;
  title: string;
  filterName: string;
  thumbSrc: string | null;
  sizeText: string | null;
  checked: boolean;
}

export interface ViewerSpriteItem {
  key: string;
  spriteIndex: number | null;
  name: string;
  filterName: string;
  thumbSrc: string | null;
  frameText: string;
  checked: boolean | null;
  active: boolean;
  main: boolean;
}

export interface ViewerPanelsSnapshot {
  images: ViewerImageItem[];
  sprites: ViewerSpriteItem[];
  imageRegex: string;
  spriteRegex: string;
}

export interface ViewerOption {
  value: string;
  label: string;
  hidden?: boolean;
  disabled?: boolean;
}

export interface ViewerFormSnapshot {
  spriteOptions: ViewerOption[];
  spriteValue: string;
  spriteDisabled: boolean;
  labelOptions: ViewerOption[];
  labelValue: string;
  labelDisabled: boolean;
  plantLayerOptions: ViewerOption[];
  plantLayerValue: string;
  plantLayerDisabled: boolean;
  zombieStateOptions: ViewerOption[];
  zombieStateValue: string;
  zombieStateDisabled: boolean;
  groundSwatchChecked: boolean;
  groundSwatchDisabled: boolean;
  speedValue: string;
  speedDisabled: boolean;
  speedPresetValue: string;
  speedPresetDisabled: boolean;
  sizeWidthValue: string;
  sizeHeightValue: string;
  sizeScaleValue: string;
  sizeDisabled: boolean;
  sizeScaleDisabled: boolean;
  loopChecked: boolean;
  reverseChecked: boolean;
  autoplayChecked: boolean;
  keepSpeedChecked: boolean;
  boundaryChecked: boolean;
  themeValue: string;
}

interface ViewerTabActions {
  activateTab: (id: number) => void;
  closeTab: (id: number) => void;
  moveTab: (id: number, targetId: number, placement: 'before' | 'after') => void;
}

interface ViewerPanelActions {
  setImageChecked: (index: number, checked: boolean) => void;
  setSpriteChecked: (index: number, checked: boolean) => void;
  activateSprite: (index: number) => void;
  setImageRegex: (value: string) => void;
  setSpriteRegex: (value: string) => void;
  selectAllImages: () => void;
  clearImages: () => void;
  selectAllSprites: () => void;
  clearSprites: () => void;
}

interface ViewerPlaybackActions {
  previousFrame: () => void;
  togglePlayback: () => void;
  nextFrame: () => void;
  beginFrameScrub: () => void;
  setFrame: (value: string) => void;
  endFrameScrub: () => void;
  setRangeBegin: (value: string) => void;
  setRangeEnd: (value: string) => void;
}

interface ViewerCommandActions {
  loadFiles: (files: File[]) => void;
  dropFiles: (dataTransfer: DataTransfer) => void;
  clear: () => void;
  toggleImages: () => void;
  toggleSprites: () => void;
  beginPanelResize: (panel: 'images' | 'sprites', clientX: number) => void;
  resizePanel: (clientX: number) => void;
  endPanelResize: () => void;
  resizeViewport: () => void;
  resetZoom: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  exportPng: () => void;
  exportApng: () => void;
  exportWebp: () => void;
  exportFla: () => void;
  convertJson: () => void;
  convertYaml: () => void;
  convertToml: () => void;
  convertPam: () => void;
  cancelExport: () => void;
}

interface ViewerStageActions {
  wheel: (clientX: number, clientY: number, deltaY: number) => void;
  pointerDown: (clientX: number, clientY: number, button: number) => boolean;
  pointerMove: (clientX: number, clientY: number) => void;
  pointerLeave: () => void;
  pointerUp: () => boolean;
}

interface ViewerFormActions {
  selectSprite: (value: string) => void;
  selectLabel: (value: string) => void;
  selectPlantLayer: (value: string) => void;
  selectZombieState: (value: string) => void;
  setGroundSwatch: (checked: boolean) => void;
  setSpeed: (value: string) => void;
  selectSpeedPreset: (value: string) => void;
  setSizeWidth: (value: string) => void;
  setSizeHeight: (value: string) => void;
  selectSizeScale: (value: string) => void;
  setLoop: (checked: boolean) => void;
  setReverse: (checked: boolean) => void;
  setAutoplay: (checked: boolean) => void;
  setKeepSpeed: (checked: boolean) => void;
  setBoundary: (checked: boolean) => void;
  selectTheme: (value: string) => void;
}

let tabsSnapshot: ViewerTabsSnapshot = { tabs: [] };
let chromeSnapshot: ViewerChromeSnapshot = {
  animationName: '',
  status: '',
  exportSize: '',
  coord: '',
  zoom: '100%',
  frame: '0 / 0',
  playing: false,
  dropHintVisible: true,
  stageDragOver: false,
  stageCursor: '',
  imagesPanelVisible: true,
  spritesPanelVisible: true,
};
let layoutSnapshot: ViewerLayoutSnapshot = {
  imagesPanelVisible: true,
  spritesPanelVisible: true,
  imagePanelWidth: 240,
  spritePanelWidth: 240,
};
let exportSnapshot: ViewerExportSnapshot = {
  visible: false,
  title: '',
  status: '',
  progress: 0,
};
let playbackSnapshot: ViewerPlaybackSnapshot = {
  controlsDisabled: true,
  frameSliderMin: '0',
  frameSliderMax: '0',
  frameSliderValue: '0',
  frameSliderDisabled: true,
  rangeBeginValue: '0',
  rangeEndValue: '0',
  rangeMax: '0',
  rangeDisabled: true,
};
let commandSnapshot: ViewerCommandSnapshot = {
  clearDisabled: true,
  commandDisabled: true,
  webpDisabled: true,
  webpTitle: '',
};
let panelsSnapshot: ViewerPanelsSnapshot = {
  images: [],
  sprites: [],
  imageRegex: '',
  spriteRegex: '',
};
let formSnapshot: ViewerFormSnapshot = {
  spriteOptions: [],
  spriteValue: '',
  spriteDisabled: true,
  labelOptions: [],
  labelValue: '',
  labelDisabled: true,
  plantLayerOptions: [],
  plantLayerValue: '',
  plantLayerDisabled: true,
  zombieStateOptions: [],
  zombieStateValue: '',
  zombieStateDisabled: true,
  groundSwatchChecked: false,
  groundSwatchDisabled: true,
  speedValue: '30',
  speedDisabled: true,
  speedPresetValue: 'custom',
  speedPresetDisabled: true,
  sizeWidthValue: '0',
  sizeHeightValue: '0',
  sizeScaleValue: '1',
  sizeDisabled: true,
  sizeScaleDisabled: true,
  loopChecked: true,
  reverseChecked: false,
  autoplayChecked: true,
  keepSpeedChecked: false,
  boundaryChecked: false,
  themeValue: 'system',
};
let tabActions: ViewerTabActions = {
  activateTab: () => undefined,
  closeTab: () => undefined,
  moveTab: () => undefined,
};
let panelActions: ViewerPanelActions = {
  setImageChecked: () => undefined,
  setSpriteChecked: () => undefined,
  activateSprite: () => undefined,
  setImageRegex: () => undefined,
  setSpriteRegex: () => undefined,
  selectAllImages: () => undefined,
  clearImages: () => undefined,
  selectAllSprites: () => undefined,
  clearSprites: () => undefined,
};
let playbackActions: ViewerPlaybackActions = {
  previousFrame: () => undefined,
  togglePlayback: () => undefined,
  nextFrame: () => undefined,
  beginFrameScrub: () => undefined,
  setFrame: () => undefined,
  endFrameScrub: () => undefined,
  setRangeBegin: () => undefined,
  setRangeEnd: () => undefined,
};
let commandActions: ViewerCommandActions = {
  loadFiles: () => undefined,
  dropFiles: () => undefined,
  clear: () => undefined,
  toggleImages: () => undefined,
  toggleSprites: () => undefined,
  beginPanelResize: () => undefined,
  resizePanel: () => undefined,
  endPanelResize: () => undefined,
  resizeViewport: () => undefined,
  resetZoom: () => undefined,
  zoomIn: () => undefined,
  zoomOut: () => undefined,
  exportPng: () => undefined,
  exportApng: () => undefined,
  exportWebp: () => undefined,
  exportFla: () => undefined,
  convertJson: () => undefined,
  convertYaml: () => undefined,
  convertToml: () => undefined,
  convertPam: () => undefined,
  cancelExport: () => undefined,
};
let stageActions: ViewerStageActions = {
  wheel: () => undefined,
  pointerDown: () => false,
  pointerMove: () => undefined,
  pointerLeave: () => undefined,
  pointerUp: () => false,
};
let formActions: ViewerFormActions = {
  selectSprite: () => undefined,
  selectLabel: () => undefined,
  selectPlantLayer: () => undefined,
  selectZombieState: () => undefined,
  setGroundSwatch: () => undefined,
  setSpeed: () => undefined,
  selectSpeedPreset: () => undefined,
  setSizeWidth: () => undefined,
  setSizeHeight: () => undefined,
  selectSizeScale: () => undefined,
  setLoop: () => undefined,
  setReverse: () => undefined,
  setAutoplay: () => undefined,
  setKeepSpeed: () => undefined,
  setBoundary: () => undefined,
  selectTheme: () => undefined,
};

const tabListeners = new Set<() => void>();
const chromeListeners = new Set<() => void>();
const layoutListeners = new Set<() => void>();
const exportListeners = new Set<() => void>();
const playbackListeners = new Set<() => void>();
const commandListeners = new Set<() => void>();
const panelListeners = new Set<() => void>();
const formListeners = new Set<() => void>();

export function publishViewerTabs(
  tabs: Array<{ id: number; displayName: string }>,
  activeTabId: number | null,
): void {
  tabsSnapshot = {
    tabs: tabs.map(tab => ({
      id: tab.id,
      displayName: tab.displayName,
      active: tab.id === activeTabId,
    })),
  };
  for (const listener of tabListeners) listener();
}

export function getViewerTabsSnapshot(): ViewerTabsSnapshot {
  return tabsSnapshot;
}

export function subscribeViewerTabs(listener: () => void): () => void {
  tabListeners.add(listener);
  return () => tabListeners.delete(listener);
}

export function publishViewerChrome(next: Partial<ViewerChromeSnapshot>): void {
  chromeSnapshot = { ...chromeSnapshot, ...next };
  for (const listener of chromeListeners) listener();
}

export function getViewerChromeSnapshot(): ViewerChromeSnapshot {
  return chromeSnapshot;
}

export function subscribeViewerChrome(listener: () => void): () => void {
  chromeListeners.add(listener);
  return () => chromeListeners.delete(listener);
}

export function publishViewerLayout(next: Partial<ViewerLayoutSnapshot>): void {
  layoutSnapshot = { ...layoutSnapshot, ...next };
  for (const listener of layoutListeners) listener();
}

export function getViewerLayoutSnapshot(): ViewerLayoutSnapshot {
  return layoutSnapshot;
}

export function subscribeViewerLayout(listener: () => void): () => void {
  layoutListeners.add(listener);
  return () => layoutListeners.delete(listener);
}

export function publishViewerExport(next: Partial<ViewerExportSnapshot>): void {
  exportSnapshot = { ...exportSnapshot, ...next };
  for (const listener of exportListeners) listener();
}

export function getViewerExportSnapshot(): ViewerExportSnapshot {
  return exportSnapshot;
}

export function subscribeViewerExport(listener: () => void): () => void {
  exportListeners.add(listener);
  return () => exportListeners.delete(listener);
}

export function publishViewerPlayback(next: Partial<ViewerPlaybackSnapshot>): void {
  playbackSnapshot = { ...playbackSnapshot, ...next };
  for (const listener of playbackListeners) listener();
}

export function getViewerPlaybackSnapshot(): ViewerPlaybackSnapshot {
  return playbackSnapshot;
}

export function subscribeViewerPlayback(listener: () => void): () => void {
  playbackListeners.add(listener);
  return () => playbackListeners.delete(listener);
}

export function publishViewerCommand(next: Partial<ViewerCommandSnapshot>): void {
  commandSnapshot = { ...commandSnapshot, ...next };
  for (const listener of commandListeners) listener();
}

export function getViewerCommandSnapshot(): ViewerCommandSnapshot {
  return commandSnapshot;
}

export function subscribeViewerCommand(listener: () => void): () => void {
  commandListeners.add(listener);
  return () => commandListeners.delete(listener);
}

export function publishViewerPanels(next: ViewerPanelsSnapshot): void {
  panelsSnapshot = next;
  for (const listener of panelListeners) listener();
}

export function getViewerPanelsSnapshot(): ViewerPanelsSnapshot {
  return panelsSnapshot;
}

export function subscribeViewerPanels(listener: () => void): () => void {
  panelListeners.add(listener);
  return () => panelListeners.delete(listener);
}

export function publishViewerForm(next: Partial<ViewerFormSnapshot>): void {
  formSnapshot = { ...formSnapshot, ...next };
  for (const listener of formListeners) listener();
}

export function getViewerFormSnapshot(): ViewerFormSnapshot {
  return formSnapshot;
}

export function subscribeViewerForm(listener: () => void): () => void {
  formListeners.add(listener);
  return () => formListeners.delete(listener);
}

export function setViewerTabActions(actions: ViewerTabActions): () => void {
  tabActions = actions;
  return () => {
    tabActions = {
      activateTab: () => undefined,
      closeTab: () => undefined,
      moveTab: () => undefined,
    };
  };
}

export function setViewerPanelActions(actions: ViewerPanelActions): () => void {
  panelActions = actions;
  return () => {
    panelActions = {
      setImageChecked: () => undefined,
      setSpriteChecked: () => undefined,
      activateSprite: () => undefined,
      setImageRegex: () => undefined,
      setSpriteRegex: () => undefined,
      selectAllImages: () => undefined,
      clearImages: () => undefined,
      selectAllSprites: () => undefined,
      clearSprites: () => undefined,
    };
  };
}

export function setViewerPlaybackActions(actions: ViewerPlaybackActions): () => void {
  playbackActions = actions;
  return () => {
    playbackActions = {
      previousFrame: () => undefined,
      togglePlayback: () => undefined,
      nextFrame: () => undefined,
      beginFrameScrub: () => undefined,
      setFrame: () => undefined,
      endFrameScrub: () => undefined,
      setRangeBegin: () => undefined,
      setRangeEnd: () => undefined,
    };
  };
}

export function setViewerCommandActions(actions: ViewerCommandActions): () => void {
  commandActions = actions;
  return () => {
    commandActions = {
      loadFiles: () => undefined,
      dropFiles: () => undefined,
      clear: () => undefined,
      toggleImages: () => undefined,
      toggleSprites: () => undefined,
      beginPanelResize: () => undefined,
      resizePanel: () => undefined,
      endPanelResize: () => undefined,
      resizeViewport: () => undefined,
      resetZoom: () => undefined,
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      exportPng: () => undefined,
      exportApng: () => undefined,
      exportWebp: () => undefined,
      exportFla: () => undefined,
      convertJson: () => undefined,
      convertYaml: () => undefined,
      convertToml: () => undefined,
      convertPam: () => undefined,
      cancelExport: () => undefined,
    };
  };
}

export function setViewerStageActions(actions: ViewerStageActions): () => void {
  stageActions = actions;
  return () => {
    stageActions = {
      wheel: () => undefined,
      pointerDown: () => false,
      pointerMove: () => undefined,
      pointerLeave: () => undefined,
      pointerUp: () => false,
    };
  };
}

export function setViewerFormActions(actions: ViewerFormActions): () => void {
  formActions = actions;
  return () => {
    formActions = {
      selectSprite: () => undefined,
      selectLabel: () => undefined,
      selectPlantLayer: () => undefined,
      selectZombieState: () => undefined,
      setGroundSwatch: () => undefined,
      setSpeed: () => undefined,
      selectSpeedPreset: () => undefined,
      setSizeWidth: () => undefined,
      setSizeHeight: () => undefined,
      selectSizeScale: () => undefined,
      setLoop: () => undefined,
      setReverse: () => undefined,
      setAutoplay: () => undefined,
      setKeepSpeed: () => undefined,
      setBoundary: () => undefined,
      selectTheme: () => undefined,
    };
  };
}

export function activateViewerTab(id: number): void {
  tabActions.activateTab(id);
}

export function closeViewerTab(id: number): void {
  tabActions.closeTab(id);
}

export function moveViewerTab(id: number, targetId: number, placement: 'before' | 'after'): void {
  tabActions.moveTab(id, targetId, placement);
}

export function setViewerImageChecked(index: number, checked: boolean): void {
  panelActions.setImageChecked(index, checked);
}

export function setViewerSpriteChecked(index: number, checked: boolean): void {
  panelActions.setSpriteChecked(index, checked);
}

export function activateViewerSprite(index: number): void {
  panelActions.activateSprite(index);
}

export function setViewerImageRegex(value: string): void {
  panelActions.setImageRegex(value);
}

export function setViewerSpriteRegex(value: string): void {
  panelActions.setSpriteRegex(value);
}

export function selectAllViewerImages(): void {
  panelActions.selectAllImages();
}

export function clearViewerImages(): void {
  panelActions.clearImages();
}

export function selectAllViewerSprites(): void {
  panelActions.selectAllSprites();
}

export function clearViewerSprites(): void {
  panelActions.clearSprites();
}

export function previousViewerFrame(): void {
  playbackActions.previousFrame();
}

export function toggleViewerPlayback(): void {
  playbackActions.togglePlayback();
}

export function nextViewerFrame(): void {
  playbackActions.nextFrame();
}

export function beginViewerFrameScrub(): void {
  playbackActions.beginFrameScrub();
}

export function setViewerFrame(value: string): void {
  playbackActions.setFrame(value);
}

export function endViewerFrameScrub(): void {
  playbackActions.endFrameScrub();
}

export function setViewerRangeBegin(value: string): void {
  playbackActions.setRangeBegin(value);
}

export function setViewerRangeEnd(value: string): void {
  playbackActions.setRangeEnd(value);
}

export function loadViewerFiles(files: File[]): void {
  commandActions.loadFiles(files);
}

export function dropViewerFiles(dataTransfer: DataTransfer): void {
  commandActions.dropFiles(dataTransfer);
}

export function clearViewerAnimation(): void {
  commandActions.clear();
}

export function toggleViewerImagesPanel(): void {
  commandActions.toggleImages();
}

export function toggleViewerSpritesPanel(): void {
  commandActions.toggleSprites();
}

export function beginViewerPanelResize(panel: 'images' | 'sprites', clientX: number): void {
  commandActions.beginPanelResize(panel, clientX);
}

export function resizeViewerPanel(clientX: number): void {
  commandActions.resizePanel(clientX);
}

export function endViewerPanelResize(): void {
  commandActions.endPanelResize();
}

export function resizeViewerViewport(): void {
  commandActions.resizeViewport();
}

export function resetViewerZoom(): void {
  commandActions.resetZoom();
}

export function zoomViewerIn(): void {
  commandActions.zoomIn();
}

export function zoomViewerOut(): void {
  commandActions.zoomOut();
}

export function exportViewerPng(): void {
  commandActions.exportPng();
}

export function exportViewerApng(): void {
  commandActions.exportApng();
}

export function exportViewerWebp(): void {
  commandActions.exportWebp();
}

export function exportViewerFla(): void {
  commandActions.exportFla();
}

export function convertViewerJson(): void {
  commandActions.convertJson();
}

export function convertViewerYaml(): void {
  commandActions.convertYaml();
}

export function convertViewerToml(): void {
  commandActions.convertToml();
}

export function convertViewerPam(): void {
  commandActions.convertPam();
}

export function cancelViewerExport(): void {
  commandActions.cancelExport();
}

export function setViewerStageDragOver(stageDragOver: boolean): void {
  publishViewerChrome({ stageDragOver });
}

export function wheelViewerStage(clientX: number, clientY: number, deltaY: number): void {
  stageActions.wheel(clientX, clientY, deltaY);
}

export function pointerDownViewerStage(clientX: number, clientY: number, button: number): boolean {
  return stageActions.pointerDown(clientX, clientY, button);
}

export function pointerMoveViewerStage(clientX: number, clientY: number): void {
  stageActions.pointerMove(clientX, clientY);
}

export function pointerLeaveViewerStage(): void {
  stageActions.pointerLeave();
}

export function pointerUpViewerStage(): boolean {
  return stageActions.pointerUp();
}

export function selectViewerSprite(value: string): void {
  formActions.selectSprite(value);
}

export function selectViewerLabel(value: string): void {
  formActions.selectLabel(value);
}

export function selectViewerPlantLayer(value: string): void {
  formActions.selectPlantLayer(value);
}

export function selectViewerZombieState(value: string): void {
  formActions.selectZombieState(value);
}

export function setViewerGroundSwatch(checked: boolean): void {
  formActions.setGroundSwatch(checked);
}

export function setViewerSpeed(value: string): void {
  formActions.setSpeed(value);
}

export function selectViewerSpeedPreset(value: string): void {
  formActions.selectSpeedPreset(value);
}

export function setViewerSizeWidth(value: string): void {
  formActions.setSizeWidth(value);
}

export function setViewerSizeHeight(value: string): void {
  formActions.setSizeHeight(value);
}

export function selectViewerSizeScale(value: string): void {
  formActions.selectSizeScale(value);
}

export function setViewerLoop(checked: boolean): void {
  formActions.setLoop(checked);
}

export function setViewerReverse(checked: boolean): void {
  formActions.setReverse(checked);
}

export function setViewerAutoplay(checked: boolean): void {
  formActions.setAutoplay(checked);
}

export function setViewerKeepSpeed(checked: boolean): void {
  formActions.setKeepSpeed(checked);
}

export function setViewerBoundary(checked: boolean): void {
  formActions.setBoundary(checked);
}

export function selectViewerTheme(value: string): void {
  formActions.selectTheme(value);
}
