# PAM Viewer

一个面向 **PopCap PAM / PopAnim** 动画文件的浏览器工具，支持预览、筛选、导出与格式互转，适用于《植物大战僵尸 2》相关动画资源工作流。

- 在线体验：<https://lambdaed1th.github.io/pam-viewer/>
- 作者：[@LambdaEd1th](https://github.com/LambdaEd1th)

## 功能概览

- **多格式加载**：支持 `.pam`、`.pam.json`、`.yaml`、`.toml`，并可读取 `.fla` / XFL 目录
- **播放控制**：播放/暂停、逐帧、循环、反向、帧范围、FPS 速度预设
- **可视化筛选**：Sprite / Image 面板，支持正则过滤和快速全选/全不选
- **舞台交互**：缩放、平移、重置视图，支持边界显示
- **PvZ2 特化选项**：植物层、僵尸状态、地面色板
- **导出能力**：PNG（当前帧）、APNG、WebP、FLA
- **格式转换**：可导出为 JSON / YAML / TOML / PAM 二进制
- **多语言界面**：中文 / English

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 本地开发

```bash
npm run dev
```

### 3) 构建

```bash
npm run build
```

### 4) 预览构建产物

```bash
npm run preview
```

## 使用说明

1. 打开应用后点击 **📂 Load**，或直接拖拽动画资源文件夹到画布区域
2. 资源包中通常包含：
   - 一个动画定义文件（如 `.pam` / `.pam.json` / `.yaml` / `.toml` / `.fla`）
   - 若干 PNG 贴图资源
3. 在顶部工具栏中完成播放控制、筛选、导出与格式转换

## 技术栈

- TypeScript
- Vite
- HTML5 Canvas
- js-yaml / smol-toml

## License

本项目采用 **GNU Affero General Public License v3.0 (AGPL-3.0)** 许可发布。
详情请见 [LICENSE](LICENSE)。
