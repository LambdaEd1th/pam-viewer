use dioxus::prelude::*;

use crate::state::{AppContext, Locale, Theme};

pub fn set_loop(mut context: AppContext, value: bool) {
    context.preferences.write().loop_playback = value;
    context.save_preferences();
}

pub fn set_reverse(mut context: AppContext, value: bool) {
    context.preferences.write().reverse = value;
    context.save_preferences();
}

pub fn set_autoplay(mut context: AppContext, value: bool) {
    context.preferences.write().autoplay = value;
    context.save_preferences();
}

pub fn set_keep_speed(mut context: AppContext, value: bool) {
    let current_speed = context.active_tab_snapshot().map(|tab| tab.speed_fps);
    {
        let mut preferences = context.preferences.write();
        preferences.keep_speed = value;
        preferences.speed_fps = value.then_some(current_speed).flatten();
    }
    context.save_preferences();
}

pub fn set_boundary(mut context: AppContext, value: bool) {
    context.preferences.write().boundary = value;
    context.save_preferences();
    context.sync_stage();
}

pub fn set_panel_open(mut context: AppContext, images: bool, value: bool) {
    let mut preferences = context.preferences.write();
    if images {
        preferences.images_panel_open = value;
    } else {
        preferences.sprites_panel_open = value;
    }
    drop(preferences);
    context.save_preferences();
}

pub fn set_locale(mut context: AppContext, locale: Locale) {
    context.preferences.write().locale = locale;
    context.save_preferences();
}

pub fn set_theme(mut context: AppContext, theme: Theme) {
    context.preferences.write().theme = theme;
    context.save_preferences();
    context.sync_stage();
}
