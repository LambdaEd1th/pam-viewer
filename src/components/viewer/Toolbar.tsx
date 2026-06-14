import {
  ConvertGroup,
  ExportGroup,
  FileGroup,
  LayerGroup,
  PlaybackGroup,
  PreferenceGroup,
  SelectorGroup,
  SizeGroup,
  SpeedGroup,
  ViewGroup,
} from './toolbar/index';

export function Toolbar() {
  return (
    <header id="toolbar">
      <div className="toolbar-row toolbar-row-primary">
        <FileGroup />
        <SelectorGroup />
        <PlaybackGroup />
      </div>
      <div className="toolbar-row toolbar-row-secondary">
        <SpeedGroup />
        <LayerGroup />
        <ViewGroup />
        <SizeGroup />
        <PreferenceGroup />
        <ExportGroup />
        <ConvertGroup />
      </div>
    </header>
  );
}
