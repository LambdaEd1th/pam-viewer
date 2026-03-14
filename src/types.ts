// ── Raw JSON types (snake_case, as stored in .pam.json files) ──

export interface RawPamJson {
  version: number;
  frame_rate: number;
  position: [number, number];
  size: [number, number];
  image: RawImage[];
  sprite: RawSprite[];
  main_sprite: RawSprite | null;
}

export interface RawImage {
  name: string;
  size?: [number, number] | null;
  transform: number[];
}

export interface RawSprite {
  name?: string | null;
  frame_rate?: number | null;
  work_area?: [number, number] | null;
  frame: RawFrame[];
}

export interface RawFrame {
  label?: string;
  stop?: boolean;
  command?: [string, string][];
  remove?: RawRemove[];
  append?: RawAppend[];
  change?: RawChange[];
}

export interface RawRemove {
  index: number;
}

export interface RawAppend {
  index: number;
  resource: number;
  sprite: boolean;
  additive?: boolean;
  preload_frame?: number;
  name?: string;
  time_scale?: number;
}

export interface RawChange {
  index: number;
  transform: number[];
  color?: [number, number, number, number];
  sprite_frame_number?: number;
  source_rectangle?: [number, number, number, number];
}

// ── Internal (camelCase) normalized types ──

export type Transform =
  | { type: 'translate'; x: number; y: number }
  | { type: 'rotate_translate'; angle: number; x: number; y: number }
  | { type: 'matrix_translate'; a: number; b: number; c: number; d: number; x: number; y: number };

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ImageDef {
  name: string;
  size: { width: number; height: number } | null;
  transform: Transform;
}

export interface Command {
  command: string;
  argument: string;
}

export interface Remove {
  index: number;
}

export interface Append {
  index: number;
  name: string | null;
  resource: number;
  sprite: boolean;
  additive: boolean;
  preloadFrame: number;
  timeScale: number;
}

export interface Change {
  index: number;
  transform: Transform;
  color: Color | null;
  spriteFrameNumber: number | null;
  sourceRectangle: [number, number, number, number] | null;
}

export interface Frame {
  label: string | null;
  stop: boolean;
  command: Command[];
  remove: Remove[];
  append: Append[];
  change: Change[];
}

export interface Sprite {
  name: string | null;
  frameRate: number | null;
  workArea: { start: number; duration: number } | null;
  frame: Frame[];
}

export interface Animation {
  version: number;
  frameRate: number;
  position: [number, number];
  size: [number, number];
  image: ImageDef[];
  sprite: Sprite[];
  mainSprite: Sprite | null;
}

export type Matrix6 = [number, number, number, number, number, number];

export interface FrameLabel {
  name: string;
  begin: number;
  end: number;
}

// ── Renderer types ──

export interface LayerSnapshot {
  index: number;
  resource: number;
  isSprite: boolean;
  additive: boolean;
  firstFrame: number;
  timeScale: number;
  preloadFrame: number;
  transform: Matrix6;
  color: Color;
}

export type SpriteTimeline = LayerSnapshot[][];

export type TimelinesMap = Record<string | number, SpriteTimeline>;
