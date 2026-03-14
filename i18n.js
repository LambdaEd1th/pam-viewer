const messages = {
  'zh-CN': {
    // Toolbar buttons
    'btn.load': '📂 加载',
    'btn.clear': '✕ 清除',
    'btn.load.title': '加载动画文件夹',
    'btn.clear.title': '清除动画',
    'anim.unloaded': '未加载',

    // Sprite / Label
    'label.sprite': 'Sprite:',
    'label.tag': '标签:',

    // Playback
    'btn.prev.title': '上一帧',
    'btn.play.title': '播放/暂停',
    'btn.next.title': '下一帧',
    'frame.slider.title': '拖动跳转帧',
    'label.range': '范围:',
    'range.begin.title': '起始帧',
    'range.end.title': '结束帧',

    // Speed
    'label.speed': '速度:',
    'speed.preset.title': '速度预设',

    // Checkboxes
    'check.loop': '循环',
    'check.reverse': '反向',
    'check.autoplay': '自动播放',
    'check.keepSpeed': '保持速度',
    'check.boundary': '边界',

    // PvZ2 layers
    'label.plantLayer': '植物层:',
    'label.zombieState': '僵尸状态:',
    'check.groundSwatch': '地面色板',

    // Panel toggles
    'btn.toggleImages.title': 'Image 面板',
    'btn.toggleSprites.title': 'Sprite 面板',
    'btn.zoomReset.title': '重置视图',

    // Size
    'label.size': '尺寸:',
    'size.scale.title': '导出倍率',

    // Export buttons
    'btn.exportPng.title': '导出当前帧为 PNG',
    'btn.exportApng.title': '导出动画为 APNG',
    'btn.exportWebp.title': '导出动画为 WebP',
    'btn.exportFla.title': '导出为 FLA (Adobe Animate)',

    // Convert buttons
    'btn.convertJson.title': '转换为 JSON',
    'btn.convertYaml.title': '转换为 YAML',
    'btn.convertToml.title': '转换为 TOML',
    'btn.convertPam.title': '转换为 PAM 二进制',

    // Export overlay
    'export.title': '导出中…',
    'export.preparing': '准备中…',
    'export.cancel': '取消',
    'export.rendering': '渲染帧 {current} / {total}',
    'export.encoding': '编码 {format}…',
    'export.exporting': '导出 {format}…',
    'export.failed': '导出失败',

    // Panels
    'panel.images': 'Images',
    'panel.sprites': 'Sprites',
    'btn.selectAll': '全选',
    'btn.selectAll.title': '全选',
    'btn.selectNone': '全不选',
    'btn.selectNone.title': '全不选',
    'filter.image.placeholder': '正则过滤…',
    'filter.image.title': '输入正则表达式过滤 Image',
    'filter.sprite.placeholder': '正则过滤…',
    'filter.sprite.title': '输入正则表达式过滤 Sprite',
    'sprite.activate.title': '激活此 Sprite',
    'sprite.activateMain.title': '激活 MainSprite',

    // Statusbar
    'status.hint': '拖放包含 .pam.json 和 PNG 的文件夹到画布区域，或点击 📂 加载',
    'status.noFiles': '未检测到文件',
    'status.loading': '加载中…',
    'status.noPam': '未找到 .pam / .pam.json / .yaml / .toml 文件',
    'status.loaded': '已加载: {name} ({images} 图像, {loaded} 已加载, {sprites} sprite)',
    'status.error': '错误: {message}',

    // Labels
    'label.allFrames': '全部帧',

    // Language
    'label.lang': '语言',

    // Drop hint
    'drop.hint': '拖放文件夹到此处加载动画',
    'drop.hintSub': '支持 .pam / .pam.json + PNG',
  },

  'en': {
    // Toolbar buttons
    'btn.load': '📂 Load',
    'btn.clear': '✕ Clear',
    'btn.load.title': 'Load animation folder',
    'btn.clear.title': 'Clear animation',
    'anim.unloaded': 'No animation',

    // Sprite / Label
    'label.sprite': 'Sprite:',
    'label.tag': 'Label:',

    // Playback
    'btn.prev.title': 'Previous frame',
    'btn.play.title': 'Play / Pause',
    'btn.next.title': 'Next frame',
    'frame.slider.title': 'Drag to seek frame',
    'label.range': 'Range:',
    'range.begin.title': 'Start frame',
    'range.end.title': 'End frame',

    // Speed
    'label.speed': 'Speed:',
    'speed.preset.title': 'Speed presets',

    // Checkboxes
    'check.loop': 'Loop',
    'check.reverse': 'Reverse',
    'check.autoplay': 'Autoplay',
    'check.keepSpeed': 'Keep speed',
    'check.boundary': 'Boundary',

    // PvZ2 layers
    'label.plantLayer': 'Plant layer:',
    'label.zombieState': 'Zombie state:',
    'check.groundSwatch': 'Ground swatch',

    // Panel toggles
    'btn.toggleImages.title': 'Image panel',
    'btn.toggleSprites.title': 'Sprite panel',
    'btn.zoomReset.title': 'Reset view',

    // Size
    'label.size': 'Size:',
    'size.scale.title': 'Export scale',

    // Export buttons
    'btn.exportPng.title': 'Export current frame as PNG',
    'btn.exportApng.title': 'Export animation as APNG',
    'btn.exportWebp.title': 'Export animation as WebP',
    'btn.exportFla.title': 'Export as FLA (Adobe Animate)',

    // Convert buttons
    'btn.convertJson.title': 'Convert to JSON',
    'btn.convertYaml.title': 'Convert to YAML',
    'btn.convertToml.title': 'Convert to TOML',
    'btn.convertPam.title': 'Convert to PAM binary',

    // Export overlay
    'export.title': 'Exporting…',
    'export.preparing': 'Preparing…',
    'export.cancel': 'Cancel',
    'export.rendering': 'Rendering frame {current} / {total}',
    'export.encoding': 'Encoding {format}…',
    'export.exporting': 'Exporting {format}…',
    'export.failed': 'Export failed',

    // Panels
    'panel.images': 'Images',
    'panel.sprites': 'Sprites',
    'btn.selectAll': 'All',
    'btn.selectAll.title': 'Select all',
    'btn.selectNone': 'None',
    'btn.selectNone.title': 'Select none',
    'filter.image.placeholder': 'Regex filter…',
    'filter.image.title': 'Regex filter for images',
    'filter.sprite.placeholder': 'Regex filter…',
    'filter.sprite.title': 'Regex filter for sprites',
    'sprite.activate.title': 'Activate this sprite',
    'sprite.activateMain.title': 'Activate MainSprite',

    // Statusbar
    'status.hint': 'Drop a folder with .pam.json and PNGs onto the canvas, or click 📂 Load',
    'status.noFiles': 'No files detected',
    'status.loading': 'Loading…',
    'status.noPam': 'No .pam / .pam.json / .yaml / .toml file found',
    'status.loaded': 'Loaded: {name} ({images} images, {loaded} loaded, {sprites} sprites)',
    'status.error': 'Error: {message}',

    // Labels
    'label.allFrames': 'All frames',

    // Language
    'label.lang': 'Lang',

    // Drop hint
    'drop.hint': 'Drop a folder here to load animation',
    'drop.hintSub': 'Supports .pam / .pam.json + PNG',
  },
};

const STORAGE_KEY = 'pam-viewer-lang';
let currentLang = localStorage.getItem(STORAGE_KEY) || detectLang();
let changeCallbacks = [];

function detectLang() {
  const nav = navigator.language || 'en';
  return nav.startsWith('zh') ? 'zh-CN' : 'en';
}

export function t(key, params) {
  const dict = messages[currentLang] || messages['en'];
  let text = dict[key] ?? messages['en'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (!messages[lang]) return;
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en';
  for (const cb of changeCallbacks) cb(lang);
}

export function onLangChange(cb) {
  changeCallbacks.push(cb);
}

export function getAvailableLangs() {
  return Object.keys(messages);
}

export function getLangLabel(lang) {
  return lang === 'zh-CN' ? '中文' : 'English';
}
