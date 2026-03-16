type MessageDict = Record<string, string>;

const messages: Record<string, MessageDict> = {
  'zh-CN': {
    'btn.load': '📂 加载',
    'btn.clear': '✕ 清除',
    'btn.load.title': '加载动画文件夹',
    'btn.clear.title': '清除动画',
    'anim.unloaded': '未加载',
    'label.sprite': 'Sprite:',
    'label.tag': '标签:',
    'btn.prev.title': '上一帧',
    'btn.play.title': '播放/暂停',
    'btn.next.title': '下一帧',
    'frame.slider.title': '拖动跳转帧',
    'label.range': '范围:',
    'range.begin.title': '起始帧',
    'range.end.title': '结束帧',
    'label.speed': '速度:',
    'speed.preset.title': '速度预设',
    'check.loop': '循环',
    'check.reverse': '反向',
    'check.autoplay': '自动播放',
    'check.keepSpeed': '保持速度',
    'check.boundary': '边界',
    'label.plantLayer': '植物层:',
    'label.zombieState': '僵尸状态:',
    'check.groundSwatch': '地面色板',
    'btn.toggleImages.title': 'Image 面板',
    'btn.toggleSprites.title': 'Sprite 面板',
    'btn.zoomReset.title': '重置视图',
    'label.size': '尺寸:',
    'size.scale.title': '导出倍率',
    'btn.exportPng.title': '导出当前帧为 PNG',
    'btn.exportApng.title': '导出动画为 APNG',
    'btn.exportWebp.title': '导出动画为 WebP',
    'btn.exportFla.title': '导出为 FLA (Adobe Animate)',
    'btn.convertJson.title': '转换为 JSON',
    'btn.convertYaml.title': '转换为 YAML',
    'btn.convertToml.title': '转换为 TOML',
    'btn.convertPam.title': '转换为 PAM 二进制',
    'export.title': '导出中…',
    'export.preparing': '准备中…',
    'export.cancel': '取消',
    'export.rendering': '渲染帧 {current} / {total}',
    'export.encoding': '编码 {format}…',
    'export.exporting': '导出 {format}…',
    'export.failed': '导出失败',
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
    'status.hint': '拖放包含 .pam.json 和 PNG 的文件夹到画布区域，或点击 📂 加载',
    'status.noFiles': '未检测到文件',
    'status.loading': '加载中…',
    'status.noPam': '未找到 .pam / .pam.json / .yaml / .toml / .fla 文件',
    'status.loaded': '已加载: {name} ({images} 图像, {loaded} 已加载, {sprites} sprite)',
    'status.error': '错误: {message}',
    'label.allFrames': '全部帧',
    'label.lang': '语言',
    'drop.hint': '拖放文件夹到此处加载动画',
    'drop.hintSub': '支持 .pam / .pam.json / .fla + PNG',
  },

  'en': {
    'btn.load': '📂 Load',
    'btn.clear': '✕ Clear',
    'btn.load.title': 'Load animation folder',
    'btn.clear.title': 'Clear animation',
    'anim.unloaded': 'No animation',
    'label.sprite': 'Sprite:',
    'label.tag': 'Label:',
    'btn.prev.title': 'Previous frame',
    'btn.play.title': 'Play / Pause',
    'btn.next.title': 'Next frame',
    'frame.slider.title': 'Drag to seek frame',
    'label.range': 'Range:',
    'range.begin.title': 'Start frame',
    'range.end.title': 'End frame',
    'label.speed': 'Speed:',
    'speed.preset.title': 'Speed presets',
    'check.loop': 'Loop',
    'check.reverse': 'Reverse',
    'check.autoplay': 'Autoplay',
    'check.keepSpeed': 'Keep speed',
    'check.boundary': 'Boundary',
    'label.plantLayer': 'Plant layer:',
    'label.zombieState': 'Zombie state:',
    'check.groundSwatch': 'Ground swatch',
    'btn.toggleImages.title': 'Image panel',
    'btn.toggleSprites.title': 'Sprite panel',
    'btn.zoomReset.title': 'Reset view',
    'label.size': 'Size:',
    'size.scale.title': 'Export scale',
    'btn.exportPng.title': 'Export current frame as PNG',
    'btn.exportApng.title': 'Export animation as APNG',
    'btn.exportWebp.title': 'Export animation as WebP',
    'btn.exportFla.title': 'Export as FLA (Adobe Animate)',
    'btn.convertJson.title': 'Convert to JSON',
    'btn.convertYaml.title': 'Convert to YAML',
    'btn.convertToml.title': 'Convert to TOML',
    'btn.convertPam.title': 'Convert to PAM binary',
    'export.title': 'Exporting…',
    'export.preparing': 'Preparing…',
    'export.cancel': 'Cancel',
    'export.rendering': 'Rendering frame {current} / {total}',
    'export.encoding': 'Encoding {format}…',
    'export.exporting': 'Exporting {format}…',
    'export.failed': 'Export failed',
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
    'status.hint': 'Drop a folder with .pam.json and PNGs onto the canvas, or click 📂 Load',
    'status.noFiles': 'No files detected',
    'status.loading': 'Loading…',
    'status.noPam': 'No .pam / .pam.json / .yaml / .toml / .fla file found',
    'status.loaded': 'Loaded: {name} ({images} images, {loaded} loaded, {sprites} sprites)',
    'status.error': 'Error: {message}',
    'label.allFrames': 'All frames',
    'label.lang': 'Lang',
    'drop.hint': 'Drop a folder here to load animation',
    'drop.hintSub': 'Supports .pam / .pam.json / .fla + PNG',
  },
};

const STORAGE_KEY = 'pam-viewer-lang';
let currentLang = localStorage.getItem(STORAGE_KEY) || detectLang();
const changeCallbacks: Array<(lang: string) => void> = [];

function detectLang(): string {
  const nav = navigator.language || 'en';
  return nav.startsWith('zh') ? 'zh-CN' : 'en';
}

export function t(key: string, params?: Record<string, string | number>): string {
  const dict = messages[currentLang] || messages['en'];
  let text = dict[key] ?? messages['en'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

export function getLang(): string {
  return currentLang;
}

export function setLang(lang: string): void {
  if (!messages[lang]) return;
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : 'en';
  for (const cb of changeCallbacks) cb(lang);
}

export function onLangChange(cb: (lang: string) => void): void {
  changeCallbacks.push(cb);
}

export function getAvailableLangs(): string[] {
  return Object.keys(messages);
}

export function getLangLabel(lang: string): string {
  return lang === 'zh-CN' ? '中文' : 'English';
}
