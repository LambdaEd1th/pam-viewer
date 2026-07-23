(() => {
    const assetRoot = __PAM_ASSET_ROOT__;
    const version = "20260723-render-worker-2";
    let canvas = document.getElementById("pam-stage-canvas");
    let backend = null;
    let worker = null;
    let handle = null;
    let resizeObserver = null;
    let mainFramePending = false;
    let pendingScene = null;
    let pendingView = null;
    let destroyed = false;
    let fallingBack = false;

    window.pamStage?.destroy?.();

    const absoluteAsset = (relative) => {
        const root = new URL(`${assetRoot.replace(/\/$/, "")}/`, document.baseURI);
        return new URL(relative, root).href;
    };

    const send = (message) => {
        try {
            dioxus.send(message);
        } catch (_) {
            // The component may already be unmounted.
        }
    };

    const errorMessage = (error) =>
        error instanceof Error ? error.message : String(error);

    const canvasSize = () => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        return {
            width: Math.max(1, Math.round(canvas.clientWidth * ratio)),
            height: Math.max(1, Math.round(canvas.clientHeight * ratio)),
        };
    };

    const transferList = (value) => {
        const transfer = [];
        const seen = new Set();
        const visit = (item) => {
            if (!item || typeof item !== "object") return;
            if (item instanceof Uint8Array) {
                if (!seen.has(item.buffer)) {
                    seen.add(item.buffer);
                    transfer.push(item.buffer);
                }
                return;
            }
            if (Array.isArray(item)) {
                for (const nested of item) visit(nested);
                return;
            }
            for (const nested of Object.values(item)) visit(nested);
        };
        visit(value);
        return transfer;
    };

    const renderMainFrame = () => {
        mainFramePending = false;
        if (!handle) return;
        try {
            handle.frame();
        } catch (error) {
            send({ type: "error", message: errorMessage(error) });
        }
    };

    const scheduleMainFrame = () => {
        if (!handle || mainFramePending) return;
        mainFramePending = true;
        requestAnimationFrame(renderMainFrame);
    };

    const postWorker = (message, transfer = []) => {
        if (!worker) return;
        if (transfer.length > 0) worker.postMessage(message, transfer);
        else worker.postMessage(message);
    };

    const flushPending = () => {
        if (!backend) return;
        if (pendingScene) {
            const scene = pendingScene;
            pendingScene = null;
            if (backend === "worker") {
                postWorker({ type: "scene", scene }, transferList(scene));
            } else if (backend === "main") {
                handle.set_scene(scene);
                scheduleMainFrame();
            }
        }
        if (pendingView) {
            const view = pendingView;
            pendingView = null;
            if (backend === "worker") {
                postWorker({ type: "view", view });
            } else if (backend === "main") {
                handle.set_view(view);
                scheduleMainFrame();
            }
        }
    };

    const installResize = () => {
        resizeObserver?.disconnect();
        const resize = () => {
            const size = canvasSize();
            if (backend === "worker") {
                postWorker({ type: "resize", ...size });
            } else if (backend === "main" && handle) {
                handle.resize(size.width, size.height);
                scheduleMainFrame();
            }
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
        resize();
    };

    const replaceTransferredCanvas = () => {
        const replacement = canvas.cloneNode(false);
        replacement.removeAttribute("width");
        replacement.removeAttribute("height");
        canvas.replaceWith(replacement);
        canvas = replacement;
    };

    const startMain = async () => {
        const runtime = await import(
            `${absoluteAsset("renderer/pkg/pam_viewer_renderer.js")}?v=${version}`
        );
        await runtime.default();
        handle = new runtime.RendererHandle();
        const size = canvasSize();
        await handle.start(canvas, size.width, size.height);
        backend = "main";
        canvas.dataset.rendererBackend = "main";
        document.documentElement.dataset.renderWorkerBackend = "main";
        installResize();
        flushPending();
        scheduleMainFrame();
        send({ type: "ready", backend: "main" });
    };

    const probeWorker = (candidate) =>
        new Promise((resolve) => {
            const timeout = window.setTimeout(() => resolve(false), 2500);
            const listener = (event) => {
                if (event.data?.type !== "probe") return;
                window.clearTimeout(timeout);
                candidate.removeEventListener("message", listener);
                resolve(Boolean(event.data.supported));
            };
            candidate.addEventListener("message", listener);
            candidate.postMessage({ type: "probe" });
        });

    const fallbackToMain = async (reason) => {
        if (destroyed || fallingBack || backend === "main") return;
        fallingBack = true;
        worker?.terminate();
        worker = null;
        backend = null;
        replaceTransferredCanvas();
        try {
            await startMain();
            document.documentElement.dataset.renderWorkerFallback = reason;
        } catch (error) {
            send({ type: "error", message: errorMessage(error) });
        } finally {
            fallingBack = false;
        }
    };

    const startWorker = async (candidate) => {
        const ready = new Promise((resolve, reject) => {
            const timeout = window.setTimeout(
                () => reject(new Error("Render Worker startup timed out")),
                10000,
            );
            candidate.onmessage = (event) => {
                const message = event.data ?? {};
                if (message.type === "ready") {
                    window.clearTimeout(timeout);
                    resolve();
                } else if (message.type === "error") {
                    window.clearTimeout(timeout);
                    if (backend === "worker") {
                        void fallbackToMain(message.message || "runtime-error");
                    } else {
                        reject(new Error(message.message || "Render Worker failed"));
                    }
                }
            };
            candidate.onerror = (event) => {
                window.clearTimeout(timeout);
                const message = event.message || "Render Worker failed";
                if (backend === "worker") void fallbackToMain(message);
                else reject(new Error(message));
            };
        });
        const size = canvasSize();
        const offscreen = canvas.transferControlToOffscreen();
        worker = candidate;
        postWorker(
            { type: "init", canvas: offscreen, ...size },
            [offscreen],
        );
        await ready;
        backend = "worker";
        canvas.dataset.rendererBackend = "worker";
        document.documentElement.dataset.renderWorkerBackend = "offscreen-wgpu";
        installResize();
        flushPending();
        send({ type: "ready", backend: "worker" });
    };

    const api = {
        render(scene) {
            pendingScene = scene;
            pendingView = null;
            flushPending();
        },
        renderView(view) {
            pendingView = view;
            flushPending();
        },
        destroy() {
            destroyed = true;
            resizeObserver?.disconnect();
            if (worker) {
                postWorker({ type: "destroy" });
                worker.terminate();
            }
            handle?.destroy();
            worker = null;
            handle = null;
            backend = null;
        },
    };
    window.pamStage = api;

    const attach = async () => {
        if (!canvas) throw new Error("PAM stage canvas is unavailable");
        const canTransfer = typeof canvas.transferControlToOffscreen === "function";
        if (canTransfer && typeof Worker !== "undefined" && navigator.gpu) {
            const candidate = new Worker(
                `${absoluteAsset("renderer/pam-render-worker.js")}?v=${version}`,
                { type: "module" },
            );
            if (await probeWorker(candidate)) {
                try {
                    await startWorker(candidate);
                    return;
                } catch (error) {
                    candidate.terminate();
                    worker = null;
                    replaceTransferredCanvas();
                    document.documentElement.dataset.renderWorkerFallback = errorMessage(error);
                }
            } else {
                candidate.terminate();
            }
        }
        await startMain();
    };

    attach().catch((error) => {
        send({ type: "error", message: errorMessage(error) });
    });
})();
