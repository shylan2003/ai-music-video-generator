# AI Music Video Generator

一个本地运行的 AI 音乐视频生成工具。桌面端使用 Electron + React + TypeScript，后端使用 FastAPI，导出由 Electron 主进程调用 ffmpeg 完成。当前主流程已合并 `lyric-video-mvp` 的整曲导演分析、多角色定妆照和参考图生图能力。

## 技术栈

- Frontend: React 18, TypeScript, Vite, Ant Design, Zustand
- Desktop: Electron
- Backend: Python, FastAPI
- Export: ffmpeg-static + @ffmpeg-installer/ffmpeg fallback
- Package: electron-builder + PyInstaller

## 快速启动

安装前端依赖：

```bash
npm install
```

安装 Python 后端依赖：

```bash
cd backend
pip install -r requirements.txt
```

启动后端：

```bash
npm run backend
```

另开一个终端启动桌面开发环境：

```bash
npm run dev
```

Windows 下也可以运行 `start.bat`，它会尝试启动后端并进入前端开发流程。

后端默认监听 `8000`。如需临时换端口测试，可以设置：

```powershell
$env:MUSIC_VIDEO_BACKEND_PORT="8765"
npm run backend
```

## 模型配置

AI 导演默认使用 DeepSeek：只分析整首歌词、生成角色设定和 3～5 行一组的分镜，不会在分镜阶段调用图片接口。

图片默认使用通义万相 `wan2.6-image`：在用户确认关键帧队列后，先为每个角色生成定妆照，再用对应参考图生成场景图。DeepSeek 与通义 API Key 均通过 Electron `safeStorage` 加密保存；系统加密不可用时不持久化密钥。

软件左侧「风格 / 模型」区域可以选择图片模型、视频模型、运动方式和主视觉锁定。

图片模型支持：

- 通义万相：首选稳定通道，支持角色参考图。
- Pollinations 免费：默认不需要 Key，适合快速测试。
- OpenAI 付费：需要 OpenAI API Key，质量和稳定性通常更好。
- OpenAI-compatible / 自定义接口：适合第三方兼容接口、本地 SD、ComfyUI 网关等。
- 免费占位图：不调用 AI，只用于验证时间线、分镜和导出。

视频模型支持：

- 本地免费动态：用关键帧图片做推拉、横移、呼吸等镜头运动。
- 静态图片：最快的测试方式。
- Runway / Luma / Kling：已接入图生视频队列。
- 自定义视频接口：支持返回 `video_url` 的第三方服务。

付费模型的 API Key 可以在软件里输入，也可以使用环境变量：

```bash
set OPENAI_API_KEY=你的_openai_key
set RUNWAY_API_KEY=你的_runway_key
set LUMA_API_KEY=你的_luma_key
set KLING_ACCESS_KEY=你的_kling_access_key
set KLING_SECRET_KEY=你的_kling_secret_key
```

PowerShell 示例：

```powershell
$env:OPENAI_API_KEY="你的_openai_key"
```

## 常用脚本

```bash
npm run dev                  # 启动 Vite 和 Electron
npm run backend              # 启动 FastAPI 后端
npm run typecheck            # TypeScript 检查
npm run test:lyrics          # LRC / SRT / TXT 解析测试
npm run build                # 构建前端和 Electron 主进程
npm run check                # 类型检查 + 构建
npm run test:e2e-storyboard  # 验证歌词过滤、短句合并、智能分镜
npm run test:e2e-export      # 用真实 MP3/LRC 生成完整样片 MP4
npm run backend:exe          # 用 PyInstaller 打包后端 exe
npm run pack:full            # 后端 exe + 前端构建 + electron-builder 解包版
npm run dist:full            # 后端 exe + 前端构建 + 安装包
```

国内网络打包时建议设置镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run pack:full
```

## 当前工作流

1. 导入音乐文件和歌词文件。
2. 选择画面风格、图片模型、视频模型和主视觉设定。
3. 生成智能分镜：DeepSeek 理解整首歌词并建立角色定妆、色彩与叙事约束；此时不产生图片费用。
4. 用户确认分镜和费用提示后启动关键帧队列，角色场景自动引用对应定妆照。
5. 在素材库中统一管理生成过的图片、视频片段和提示词版本。
6. 预览时间线，歌词唱到哪里就显示对应画面。
7. 导出 1920×1080、30fps MP4，可选择本地动态镜头、歌词字幕和云端视频片段。

## 已验证结果

- 后端 exe：`backend_dist/music-video-backend.exe`
- 解包版桌面程序：`release/win-unpacked/AI Music Video Generator.exe`
- 真实样片测试：`artifacts/e2e/sample_mv.mp4`
- 样片来源：`琵琶行-奇然_沈谧仁 (2).mp3` + `琵琶行-奇然_沈谧仁.lrc`

## 注意事项

- `.mgg` / `.mgg1` 属于加密音乐格式，当前不能直接预览或导出，请先转换为 MP3。
- Luma 通常要求关键帧图片是公网可访问的 HTTPS URL。本地图片可优先使用 Runway、本地动态或公网隧道。
- 工程 V2 保存本地音频路径、分镜和生成状态；只要源文件没有移动，重新打开后可直接预览和导出。
- 选择付费模型时，API Key 只用于本地请求和本机安全存储，不写入导出的项目 JSON。
- 打包时如果 GitHub 下载超时，请使用上面的 Electron 和 Electron Builder 镜像变量。
