mod actions;
mod components;
mod i18n;
mod platform;
mod state;

use dioxus::prelude::*;

use crate::components::Workbench;
use crate::state::AppContext;

fn main() {
    #[cfg(target_arch = "wasm32")]
    dioxus::launch(App);

    #[cfg(not(target_arch = "wasm32"))]
    {
        use dioxus::desktop::{Config, LogicalSize};

        let theme = crate::platform::load_preferences().theme;
        let window = crate::platform::native_renderer::window_builder(theme)
            .with_inner_size(LogicalSize::new(1280.0, 800.0))
            .with_min_inner_size(LogicalSize::new(760.0, 520.0));
        let config = Config::new()
            .with_window(window)
            .with_menu(None)
            .with_on_window(move |_window, _| {
                #[cfg(target_os = "macos")]
                pam_viewer_native_window::make_opaque(&_window);
            });
        dioxus::LaunchBuilder::desktop()
            .with_cfg(config)
            .launch(App);
    }
}

#[allow(non_snake_case)]
fn App() -> Element {
    let context = use_hook(AppContext::new);
    use_context_provider(|| context);
    #[cfg(not(target_arch = "wasm32"))]
    {
        let renderer =
            crate::platform::native_renderer::use_native_renderer(context.shared_stage());
        use_context_provider(|| renderer.clone());
        let theme_renderer = renderer.clone();
        use_effect(move || theme_renderer.set_theme(context.preferences.read().theme));
        use_effect(|| {
            document::eval("document.documentElement.classList.add('native-wgpu-host');");
        });
    }
    #[cfg(target_arch = "wasm32")]
    use_effect(|| {
        spawn(async {
            if let Err(error) = crate::platform::processing::warm_up().await {
                crate::platform::log_buffer::push(
                    "ERROR",
                    &format!("Processing Worker warm-up failed: {error}"),
                );
            }
        });
    });
    actions::use_playback_clock();
    rsx! { Workbench {} }
}
