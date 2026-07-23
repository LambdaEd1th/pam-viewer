return (async function () {
    window.pamResponsiveLayoutHost?.destroy();

    const media = window.matchMedia("(max-width: 900px)");
    const report = () => dioxus.send(media.matches);
    const host = {
        destroy() {
            media.removeEventListener("change", report);
            if (window.pamResponsiveLayoutHost === host) window.pamResponsiveLayoutHost = null;
        },
    };

    window.pamResponsiveLayoutHost = host;
    media.addEventListener("change", report);
    report();
    await new Promise(() => {});
})();
