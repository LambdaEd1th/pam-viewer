const runtimeVersion = "20260723-render-worker-2";
let handle = null;
let framePending = false;

const ready = (async () => {
    const runtime = await import(`./pkg/pam_viewer_renderer.js?v=${runtimeVersion}`);
    await runtime.default();
    return runtime;
})();

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

function scheduleFrame() {
    if (!handle || framePending) return;
    framePending = true;
    const callback = () => {
        framePending = false;
        if (!handle) return;
        try {
            handle.frame();
        } catch (error) {
            self.postMessage({ type: "error", message: errorMessage(error) });
        }
    };
    if (typeof self.requestAnimationFrame === "function") {
        self.requestAnimationFrame(callback);
    } else {
        self.setTimeout(callback, 0);
    }
}

self.onmessage = async (event) => {
    const message = event.data ?? {};
    try {
        switch (message.type) {
            case "probe":
                self.postMessage({
                    type: "probe",
                    supported:
                        typeof OffscreenCanvas !== "undefined" &&
                        typeof self.navigator?.gpu !== "undefined",
                });
                break;
            case "init": {
                const runtime = await ready;
                handle = new runtime.RendererHandle();
                await handle.start_offscreen(
                    message.canvas,
                    message.width,
                    message.height,
                );
                self.postMessage({ type: "ready" });
                scheduleFrame();
                break;
            }
            case "scene":
                handle?.set_scene(message.scene);
                scheduleFrame();
                break;
            case "view":
                handle?.set_view(message.view);
                scheduleFrame();
                break;
            case "resize":
                handle?.resize(message.width, message.height);
                scheduleFrame();
                break;
            case "destroy":
                handle?.destroy();
                handle = null;
                self.close();
                break;
            default:
                break;
        }
    } catch (error) {
        self.postMessage({ type: "error", message: errorMessage(error) });
    }
};
