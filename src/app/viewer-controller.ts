import type { ViewerUnmount } from './controller';

let controllerPromise: Promise<ViewerUnmount> | null = null;

export function mountViewerController(): Promise<ViewerUnmount> {
  controllerPromise ??= import('./controller')
    .then(module => module.mountPamViewerController())
    .then((unmount) => {
      let mounted = true;
      return () => {
        if (!mounted) return;
        mounted = false;
        unmount();
        controllerPromise = null;
      };
    })
    .catch((error: unknown) => {
      controllerPromise = null;
      throw error;
    });
  return controllerPromise;
}
