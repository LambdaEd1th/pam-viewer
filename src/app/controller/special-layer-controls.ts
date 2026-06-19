interface SpecialLayerControlsOptions {
  getPlantLayers: () => number[];
  getZombieStateLayers: () => number[];
  getGroundSwatchLayers: () => number[];
  getSpriteFilter: () => boolean[];
  setSpriteVisible: (index: number, visible: boolean) => void;
  setPlantLayerValue: (value: string) => void;
  setZombieStateValue: (value: string) => void;
  setGroundSwatchChecked: (checked: boolean) => void;
  publishForm: () => void;
  publishPanels: () => void;
  drawCurrentFrame: () => void;
}

export interface SpecialLayerControls {
  renderControls: () => void;
  syncUI: () => void;
  selectPlantLayer: (value: string) => void;
  selectZombieState: (value: string) => void;
  setGroundSwatch: (show: boolean) => void;
}

export function createSpecialLayerControls(options: SpecialLayerControlsOptions): SpecialLayerControls {
  function applyExclusiveLayer(layerIndices: number[], selectedIdx: number): void {
    for (const idx of layerIndices) {
      options.setSpriteVisible(idx, idx === selectedIdx);
    }
    options.publishPanels();
    options.drawCurrentFrame();
  }

  function syncUI(): void {
    const spriteFilter = options.getSpriteFilter();
    const plantLayers = options.getPlantLayers();
    const zombieLayers = options.getZombieStateLayers();
    const groundLayers = options.getGroundSwatchLayers();

    if (plantLayers.length > 0) {
      const visible = plantLayers.filter(i => spriteFilter[i]);
      if (visible.length === 0) options.setPlantLayerValue('none');
      else if (visible.length === 1) options.setPlantLayerValue(String(visible[0]));
    }
    if (zombieLayers.length > 0) {
      const visible = zombieLayers.filter(i => spriteFilter[i]);
      if (visible.length === 0) options.setZombieStateValue('none');
      else if (visible.length === 1) options.setZombieStateValue(String(visible[0]));
    }
    if (groundLayers.length > 0) {
      options.setGroundSwatchChecked(groundLayers.some(i => spriteFilter[i]));
    }
    options.publishForm();
  }

  function renderControls(): void {
    const plantLayers = options.getPlantLayers();
    const zombieLayers = options.getZombieStateLayers();
    const groundLayers = options.getGroundSwatchLayers();
    const spriteFilter = options.getSpriteFilter();

    options.setPlantLayerValue(plantLayers.length > 0 ? 'none' : '');
    options.setZombieStateValue(zombieLayers.length > 0 ? 'none' : '');
    options.setGroundSwatchChecked(
      groundLayers.length > 0
        ? groundLayers.some(idx => spriteFilter[idx])
        : false,
    );
    syncUI();
    options.publishForm();
  }

  function selectPlantLayer(value: string): void {
    options.setPlantLayerValue(value);
    const selectedIdx = value === 'none' ? -1 : parseInt(value, 10);
    applyExclusiveLayer(options.getPlantLayers(), selectedIdx);
  }

  function selectZombieState(value: string): void {
    options.setZombieStateValue(value);
    const selectedIdx = value === 'none' ? -1 : parseInt(value, 10);
    applyExclusiveLayer(options.getZombieStateLayers(), selectedIdx);
  }

  function setGroundSwatch(show: boolean): void {
    options.setGroundSwatchChecked(show);
    for (const idx of options.getGroundSwatchLayers()) {
      options.setSpriteVisible(idx, show);
    }
    options.publishPanels();
    options.drawCurrentFrame();
    syncUI();
  }

  return {
    renderControls,
    syncUI,
    selectPlantLayer,
    selectZombieState,
    setGroundSwatch,
  };
}
