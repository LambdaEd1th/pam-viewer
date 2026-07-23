use std::sync::Arc;

use dioxus::prelude::*;
#[cfg(target_arch = "wasm32")]
use pam_viewer_core::RenderViewPayload;
use pam_viewer_core::{
    FrameLabel, LoadedPamPayload, PamDocument, SpecialLayerIndices, SpriteInfo, SpriteKey,
};
#[cfg(not(target_arch = "wasm32"))]
use pam_viewer_renderer::{SharedStage, StageScene};
use serde::{Deserialize, Serialize};

pub const DEFAULT_TOOLBAR_ORDER: &[&str] = &[
    "file",
    "selectors",
    "playback",
    "speed",
    "layers",
    "view",
    "size",
    "export",
    "convert",
];

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Locale {
    #[default]
    ZhCn,
    En,
}

impl Locale {
    pub fn code(self) -> &'static str {
        match self {
            Self::ZhCn => "zh-CN",
            Self::En => "en",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Preferences {
    pub locale: Locale,
    pub theme: Theme,
    pub loop_playback: bool,
    pub reverse: bool,
    pub autoplay: bool,
    pub keep_speed: bool,
    pub boundary: bool,
    pub speed_fps: Option<u32>,
    pub images_panel_open: bool,
    pub sprites_panel_open: bool,
    pub image_panel_width: u32,
    pub sprite_panel_width: u32,
    pub toolbar_order: Vec<String>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            locale: Locale::ZhCn,
            theme: Theme::System,
            loop_playback: true,
            reverse: false,
            autoplay: false,
            keep_speed: false,
            boundary: true,
            speed_fps: None,
            images_panel_open: true,
            sprites_panel_open: true,
            image_panel_width: 250,
            sprite_panel_width: 270,
            toolbar_order: DEFAULT_TOOLBAR_ORDER
                .iter()
                .map(|group| (*group).to_string())
                .collect(),
        }
    }
}

impl Preferences {
    pub fn normalized(mut self) -> Self {
        self.image_panel_width = self.image_panel_width.clamp(180, 500);
        self.sprite_panel_width = self.sprite_panel_width.clamp(180, 500);
        let mut order = Vec::new();
        for id in &self.toolbar_order {
            if DEFAULT_TOOLBAR_ORDER.contains(&id.as_str()) && !order.contains(id) {
                order.push(id.clone());
            }
        }
        for id in DEFAULT_TOOLBAR_ORDER {
            if !order.iter().any(|value| value == id) {
                order.push((*id).into());
            }
        }
        self.toolbar_order = order;
        self
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Tone {
    #[default]
    Neutral,
    Ok,
    Warning,
    Error,
}

#[derive(Clone, Debug, Default)]
pub struct Status {
    pub message: String,
    pub tone: Tone,
}

impl Status {
    pub fn new(message: impl Into<String>, tone: Tone) -> Self {
        Self {
            message: message.into(),
            tone,
        }
    }
}

#[derive(Clone, Debug)]
pub struct ExportProgress {
    pub operation_id: u64,
    pub document_id: u64,
    pub title: String,
    pub detail: String,
    pub progress: f32,
    pub cancel_requested: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FrameRange {
    pub begin: usize,
    pub end: usize,
}

#[derive(Clone, Debug)]
pub struct ViewerTab {
    pub id: u64,
    pub processing_id: u64,
    pub document: Arc<PamDocument>,
    pub active_sprite: SpriteKey,
    pub frame_range: FrameRange,
    pub current_frame: usize,
    pub zoom: f32,
    pub pan: [f32; 2],
    pub image_filter: Vec<bool>,
    pub sprite_filter: Vec<bool>,
    pub special_layers: SpecialLayerIndices,
    pub speed_fps: u32,
    pub export_size: [u32; 2],
    pub export_scale: Option<u32>,
    pub image_regex: String,
    pub sprite_regex: String,
    pub selected_label: Option<usize>,
    pub loaded_images: usize,
    pub image_thumbnails: Vec<Option<String>>,
}

fn apply_default_sprite_visibility(
    sprite_filter: &mut [bool],
    special_layers: &SpecialLayerIndices,
) {
    sprite_filter.fill(true);
    for index in special_layers
        .default_hidden_layers
        .iter()
        .chain(&special_layers.zombie_state_layers)
    {
        if let Some(visible) = sprite_filter.get_mut(*index) {
            *visible = false;
        }
    }
}

impl ViewerTab {
    pub fn new(
        id: u64,
        loaded: LoadedPamPayload,
        preferences: &Preferences,
    ) -> Result<Self, String> {
        let document = Arc::new(
            loaded
                .document
                .into_document()
                .map_err(|error| error.to_string())?,
        );
        let active_sprite = if document.pam.main_sprite.is_some() {
            SpriteKey::Main
        } else {
            SpriteKey::Sprite(0)
        };
        let frame_count = sprite_for_document(&document, active_sprite)
            .map(|sprite| sprite.frame.len())
            .unwrap_or(0);
        let special_layers =
            pam_viewer_core::special_layer_indices(&document.pam, &document.source_name);
        let mut sprite_filter = vec![true; document.pam.sprite.len()];
        apply_default_sprite_visibility(&mut sprite_filter, &special_layers);
        let bounds = document.stage_bounds();
        let native_fps = sprite_for_document(&document, active_sprite)
            .and_then(|sprite| sprite.frame_rate)
            .unwrap_or(document.pam.frame_rate as f64)
            .round()
            .clamp(1.0, 120.0) as u32;
        let speed_fps = if preferences.keep_speed {
            preferences.speed_fps.unwrap_or(native_fps)
        } else {
            native_fps
        };
        let export_size = [
            document.pam.size[0].round().max(1.0) as u32,
            document.pam.size[1].round().max(1.0) as u32,
        ];
        let image_count = document.pam.image.len();
        let image_thumbnails = document
            .images
            .iter()
            .map(|asset| {
                asset
                    .as_ref()
                    .and_then(|asset| crate::platform::thumbnail_url(&asset.encoded))
            })
            .collect();
        let range = FrameRange {
            begin: 0,
            end: frame_count.saturating_sub(1),
        };
        Ok(Self {
            id,
            processing_id: id,
            document,
            active_sprite,
            frame_range: range,
            current_frame: if preferences.reverse {
                range.end
            } else {
                range.begin
            },
            zoom: 1.0,
            pan: [
                -bounds.x - bounds.width / 2.0,
                -bounds.y - bounds.height / 2.0,
            ],
            image_filter: vec![true; image_count],
            sprite_filter,
            special_layers,
            speed_fps,
            export_size,
            export_scale: Some(1),
            image_regex: String::new(),
            sprite_regex: String::new(),
            selected_label: None,
            loaded_images: loaded.loaded_images,
            image_thumbnails,
        })
    }

    pub fn restore_default_sprite_visibility(&mut self) {
        apply_default_sprite_visibility(&mut self.sprite_filter, &self.special_layers);
    }

    pub fn display_name(&self) -> String {
        self.document
            .source_name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(&self.document.source_name)
            .to_string()
    }

    pub fn active_sprite_info(&self) -> Option<&SpriteInfo> {
        sprite_for_document(&self.document, self.active_sprite)
    }

    pub fn labels(&self) -> Vec<FrameLabel> {
        self.active_sprite_info()
            .map(pam_viewer_core::parse_frame_labels)
            .unwrap_or_default()
    }

    pub fn frame_count(&self) -> usize {
        self.active_sprite_info()
            .map(|sprite| sprite.frame.len())
            .unwrap_or(0)
    }

    #[cfg(target_arch = "wasm32")]
    pub fn render_view(&self, boundary: bool, dark_background: bool) -> RenderViewPayload {
        RenderViewPayload {
            sprite: self.active_sprite,
            frame: self.current_frame,
            image_filter: self.image_filter.clone(),
            sprite_filter: self.sprite_filter.clone(),
            zoom: self.zoom,
            pan: self.pan,
            boundary,
            dark_background,
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn stage_scene(&self, boundary: bool, dark_background: bool) -> StageScene {
        StageScene {
            document: Some(self.document.clone()),
            document_revision: 0,
            sprite: self.active_sprite,
            frame: self.current_frame,
            image_filter: self.image_filter.clone(),
            sprite_filter: self.sprite_filter.clone(),
            zoom: self.zoom,
            pan: self.pan,
            boundary,
            dark_background,
        }
    }
}

pub fn sprite_for_document(document: &PamDocument, key: SpriteKey) -> Option<&SpriteInfo> {
    match key {
        SpriteKey::Main => document.pam.main_sprite.as_ref(),
        SpriteKey::Sprite(index) => document.pam.sprite.get(index),
    }
}

#[derive(Clone, Copy)]
pub struct AppContext {
    pub tabs: Signal<Vec<ViewerTab>>,
    pub active_tab: Signal<Option<u64>>,
    pub next_tab_id: Signal<u64>,
    pub preferences: Signal<Preferences>,
    pub status: Signal<Status>,
    pub playing: Signal<bool>,
    pub export: Signal<Option<ExportProgress>>,
    pub dragged_tab: Signal<Option<u64>>,
    pub dragged_toolbar_group: Signal<Option<String>>,
    pub panel_resize: Signal<Option<PanelResize>>,
    pub compact_layout: Signal<bool>,
    pub stage_drag: Signal<Option<StageDrag>>,
    pub stage_size: Signal<[f64; 2]>,
    pub pointer_coord: Signal<Option<[f32; 2]>>,
    #[cfg(not(target_arch = "wasm32"))]
    pub stage: Signal<SharedStage>,
}

impl AppContext {
    pub fn new() -> Self {
        crate::platform::log_buffer::initialize();
        let preferences = crate::platform::load_preferences().normalized();
        #[cfg(not(target_arch = "wasm32"))]
        let stage = {
            let stage = SharedStage::default();
            stage.update(|scene| {
                scene.dark_background = match preferences.theme {
                    Theme::Dark => true,
                    Theme::Light => false,
                    Theme::System => crate::platform::system_is_dark(),
                };
            });
            stage
        };
        Self {
            tabs: Signal::new(Vec::new()),
            active_tab: Signal::new(None),
            next_tab_id: Signal::new(1),
            preferences: Signal::new(preferences),
            status: Signal::new(Status::default()),
            playing: Signal::new(false),
            export: Signal::new(None),
            dragged_tab: Signal::new(None),
            dragged_toolbar_group: Signal::new(None),
            panel_resize: Signal::new(None),
            compact_layout: Signal::new(false),
            stage_drag: Signal::new(None),
            stage_size: Signal::new([1.0, 1.0]),
            pointer_coord: Signal::new(None),
            #[cfg(not(target_arch = "wasm32"))]
            stage: Signal::new(stage),
        }
    }

    pub fn active_tab_index(&self) -> Option<usize> {
        let id = *self.active_tab.read();
        self.tabs.read().iter().position(|tab| Some(tab.id) == id)
    }

    pub fn set_status(mut self, status: Status) {
        let level = match status.tone {
            Tone::Neutral => "INFO",
            Tone::Ok => "OK",
            Tone::Warning => "WARN",
            Tone::Error => "ERROR",
        };
        crate::platform::log_buffer::push(level, &status.message);
        self.status.set(status);
    }

    pub fn active_tab_snapshot(&self) -> Option<ViewerTab> {
        self.active_tab_index()
            .and_then(|index| self.tabs.read().get(index).cloned())
    }

    pub fn update_active_tab(&self, update: impl FnOnce(&mut ViewerTab)) {
        let Some(index) = self.active_tab_index() else {
            return;
        };
        let mut tabs = self.tabs;
        update(&mut tabs.write()[index]);
        self.sync_stage();
    }

    pub fn sync_stage(&self) {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let preferences = self.preferences.read();
            let boundary = preferences.boundary;
            let dark_background = match preferences.theme {
                Theme::Dark => true,
                Theme::Light => false,
                Theme::System => crate::platform::system_is_dark(),
            };
            drop(preferences);
            if let Some(tab) = self.active_tab_snapshot() {
                let next = tab.stage_scene(boundary, dark_background);
                self.stage.read().update(|scene| scene.replace(next));
            } else {
                self.stage.read().update(|scene| {
                    scene.set_document(None);
                    scene.boundary = boundary;
                    scene.dark_background = dark_background;
                });
            }
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn shared_stage(&self) -> SharedStage {
        self.stage.read().clone()
    }

    pub fn save_preferences(&self) {
        crate::platform::save_preferences(&self.preferences.read());
    }
}

#[derive(Clone, Copy, Debug)]
pub struct PanelResize {
    pub side: PanelSide,
    pub start_x: f64,
    pub start_width: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PanelSide {
    Images,
    Sprites,
}

#[derive(Clone, Copy, Debug)]
pub enum StageDrag {
    Pan {
        start: [f64; 2],
        pan: [f32; 2],
    },
    Boundary {
        edge: BoundaryEdge,
        start: [f64; 2],
        size: [f64; 2],
        position: [f64; 2],
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryEdge {
    North,
    South,
    East,
    West,
    NorthEast,
    NorthWest,
    SouthEast,
    SouthWest,
}
