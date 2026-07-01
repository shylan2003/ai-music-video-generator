# AI Music Video Generator

一个本地运行、云端生成镜头的二维动画 MV 工具。桌面端使用 Electron + React + TypeScript，后端使用 FastAPI，正式导出由 Electron 主进程调用 ffmpeg 完成。工程格式为 V3。

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

开发模式后端默认监听 `8000`；正式桌面版每次启动会自动申请空闲的本机端口，避免旧进程占用导致“后端未连接”。如需临时换端口测试，可以设置：

```powershell
$env:MUSIC_VIDEO_BACKEND_PORT="8765"
npm run backend
```

## 模型配置

AI 导演默认使用 DeepSeek：分析歌曲类型、段落、情绪曲线、人物关系、人生阶段、地点和关键道具。五分钟歌曲默认生成 30～50 个、每个 6～10 秒的镜头。智能分镜阶段不会调用收费图片或视频接口。

图片默认使用通义万相 `wan2.6-image`：用户确认费用后，依次生成身份母版、人生阶段定妆、地点和道具参考图，再生成场景关键帧。每个场景最多引用角色阶段、画风、地点和道具四类参考。DeepSeek 与通义 API Key 均通过 Electron `safeStorage` 加密保存；系统加密不可用时不持久化密钥。

软件左侧「风格 / 模型」区域可以选择图片模型、视频模型、运动方式和主视觉锁定。

图片模型支持：

- 通义万相：首选稳定通道，支持角色参考图。
- Pollinations 免费：默认不需要 Key，适合快速测试。
- OpenAI 付费：需要 OpenAI API Key，质量和稳定性通常更好。
- OpenAI-compatible / 自定义接口：适合第三方兼容接口、本地 SD、ComfyUI 网关等。
- 免费占位图：不调用 AI，只用于验证时间线、分镜和导出。

正式视频支持 Kling、Runway、Luma 和自定义云端接口。V3 全云端模式不允许用静态图、本地推拉或其他供应商自动顶替失败镜头；旧本地动态仅作为历史工程兼容入口，不能通过正式导出门禁。

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
    npm run test:cloud-storyboard # 6～10 秒镜头、完整覆盖和 30～50 镜头测试
    npm run test:director        # 五类歌曲识别、手动风格锁和人生阶段测试
    npm run test:video-resume    # 云端任务 ID 恢复与成功任务去重测试
    npm run test:export-policy   # 全云端导出门禁与时间线一致性测试
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

1. 导入音乐与 LRC/SRT；TXT 需要按音乐时长自动对齐。
2. 手选风格，或选“自动”并在收费前确认 AI 判断结果。
3. 生成并编辑智能分镜。此阶段只做整曲分析，不调用收费图片或视频接口。
4. 确认图片任务数，生成身份、阶段、地点、道具参考图和全部关键帧。
5. 先生成三镜测试（人物近景、全身动作、环境镜头），确认后锁定同一图片模型、视频供应商、视频模型、比例和风格指纹。
6. 确认视频数量、总秒数和费用后批量生成；队列支持取消、失败重试和基于云端任务 ID 的断点续查。
7. 检查每个镜头并确认质检。任一镜头失败、使用本地动态、模型不一致或质检未通过时，正式导出会被阻止。
8. 导出 1920×1080、30fps、H.264 CRF 20、AAC 192kbps 成片，并可同时输出剪映/Premiere/达芬奇通用素材包。

素材包包含逐镜 MP4、关键帧、参考图、音乐、SRT、ASS、时间表、提示词和转场清单，不写入剪映非公开工程格式。

## 已验证结果

- 后端 exe：`backend_dist/music-video-backend.exe`
- 解包版桌面程序：`release/win-unpacked/AI Music Video Generator.exe`
- 真实样片测试：`artifacts/e2e/sample_mv.mp4`
- 样片来源：`琵琶行-奇然_沈谧仁 (2).mp3` + `琵琶行-奇然_沈谧仁.lrc`

## 注意事项

- `.mgg` / `.mgg1` 属于加密音乐格式，当前不能直接预览或导出，请先转换为 MP3。
- Luma 通常要求关键帧图片是公网可访问的 HTTPS URL。本地图片可使用公网隧道，或在项目开始前改选 Kling/Runway；批量开始后不能跨平台回退。
- 工程 V3 保存本地音频路径、视觉圣经、阶段、云端任务 ID、质检与生成状态。V2 会自动迁移，但旧本地动态不会被标记为“全云端完成”。
- 正式安装内容仅携带后端 EXE 和运行依赖，不附带 Python 源码、依赖 `.env`、历史素材或任务缓存。
- 选择付费模型时，API Key 只用于本地请求和本机安全存储，不写入导出的项目 JSON。
- 打包时如果 GitHub 下载超时，请使用上面的 Electron 和 Electron Builder 镜像变量。
