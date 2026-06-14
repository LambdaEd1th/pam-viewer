import { useEffect } from 'react';
import { mountViewerController } from './app/viewer-controller';
import { ViewerShell } from './components/viewer/ViewerShell';

export function App() {
  useEffect(() => {
    let unmount: (() => void) | null = null;
    let cancelled = false;

    void mountViewerController().then((dispose) => {
      if (cancelled) {
        dispose();
      } else {
        unmount = dispose;
      }
    });

    return () => {
      cancelled = true;
      unmount?.();
    };
  }, []);

  return <ViewerShell />;
}
