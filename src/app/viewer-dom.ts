export interface ViewerDomRefs {
  tabStrip: HTMLDivElement;
  stageContainer: HTMLDivElement;
  canvas: HTMLCanvasElement;
  panelImages: HTMLElement;
  panelSprites: HTMLElement;
}

type ViewerDomRefName = keyof ViewerDomRefs;

const domRefs: Partial<ViewerDomRefs> = {};
let readyResolver: ((refs: ViewerDomRefs) => void) | null = null;
let readyPromise: Promise<ViewerDomRefs> | null = null;

const requiredRefs: ViewerDomRefName[] = [
  'tabStrip',
  'stageContainer',
  'canvas',
  'panelImages',
  'panelSprites',
];

function hasAllRefs(): boolean {
  return requiredRefs.every(key => domRefs[key] !== undefined);
}

function toViewerDomRefs(): ViewerDomRefs {
  return domRefs as ViewerDomRefs;
}

function resolveIfReady(): void {
  if (!readyResolver || !hasAllRefs()) return;
  readyResolver(toViewerDomRefs());
  readyResolver = null;
}

export function registerViewerDomRef<K extends ViewerDomRefName>(
  key: K,
  element: ViewerDomRefs[K] | null,
): void {
  if (element) {
    domRefs[key] = element;
  } else {
    delete domRefs[key];
  }
  resolveIfReady();
}

export function waitForViewerDomRefs(): Promise<ViewerDomRefs> {
  if (hasAllRefs()) return Promise.resolve(toViewerDomRefs());
  readyPromise ??= new Promise<ViewerDomRefs>((resolve) => {
    readyResolver = resolve;
    resolveIfReady();
  });
  return readyPromise;
}
