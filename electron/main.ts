import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import axios from 'axios'
import ffmpegPath from 'ffmpeg-static'

const ffmpegInstallerPath = (() => {
  try {
    return require('@ffmpeg-installer/ffmpeg').path as string
  } catch {
    return ''
  }
})()

const isDev = !app.isPackaged
let mainWindow: BrowserWindow | null = null
let backendProcess: ChildProcess | null = null

interface ExportScene {
  scene_index: number
  title: string
  start_time: number
  end_time: number
  image_url: string
  video_url?: string
  camera_motion?: string
}

interface ExportLyric {
  id: string
  time: number
  text: string
}

interface ExportRequest {
  audioPath: string
  outputPath: string
  duration?: number
  width?: number
  height?: number
  fps?: number
  motion?: 'none' | 'subtle' | 'standard' | 'dramatic'
  subtitles?: {
    enabled?: boolean
  }
  lyrics?: ExportLyric[]
  scenes: ExportScene[]
}

interface ExportProgressPayload {
  stage: 'prepare' | 'download' | 'render' | 'complete' | 'error'
  progress: number
  message: string
}

type PersistedModelSettings = {
  imageSettings?: Record<string, unknown>
  videoSettings?: Record<string, unknown>
  modelTemplates?: Array<Record<string, unknown>>
}

const encryptedApiKeyField = '__encryptedApiKey'

function sendExportProgress(payload: ExportProgressPayload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('video:exportProgress', payload)
  }
}

function getResolvedFfmpegPath() {
  if (ffmpegInstallerPath && existsSync(ffmpegInstallerPath)) {
    return ffmpegInstallerPath
  }

  return ffmpegPath
}

function getModelSettingsPath() {
  return path.join(app.getPath('userData'), 'model-settings.json')
}

function normalizeModelSettings(payload: unknown): PersistedModelSettings {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  const source = payload as PersistedModelSettings
  const nextSettings: PersistedModelSettings = {}

  if (source.imageSettings && typeof source.imageSettings === 'object') {
    nextSettings.imageSettings = source.imageSettings
  }

  if (source.videoSettings && typeof source.videoSettings === 'object') {
    nextSettings.videoSettings = source.videoSettings
  }

  if (Array.isArray(source.modelTemplates)) {
    nextSettings.modelTemplates = source.modelTemplates.filter((template) => template && typeof template === 'object')
  }

  return nextSettings
}

function encryptApiKey(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  if (!safeStorage.isEncryptionAvailable()) {
    return {
      algorithm: 'plain',
      value,
    }
  }

  return {
    algorithm: 'electron-safe-storage',
    value: safeStorage.encryptString(value).toString('base64'),
  }
}

function decryptApiKey(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const source = value as { algorithm?: unknown; value?: unknown }
  if (typeof source.value !== 'string') {
    return undefined
  }

  if (source.algorithm === 'plain') {
    return source.value
  }

  if (source.algorithm !== 'electron-safe-storage') {
    return undefined
  }

  try {
    return safeStorage.decryptString(Buffer.from(source.value, 'base64'))
  } catch {
    return undefined
  }
}

function protectProviderSettings(settings?: Record<string, unknown>) {
  if (!settings) {
    return undefined
  }

  const protectedSettings = { ...settings }
  const encryptedApiKey = encryptApiKey(protectedSettings.apiKey)
  delete protectedSettings.apiKey

  if (encryptedApiKey) {
    protectedSettings[encryptedApiKeyField] = encryptedApiKey
  }

  return protectedSettings
}

function revealProviderSettings(settings?: Record<string, unknown>) {
  if (!settings) {
    return undefined
  }

  const revealedSettings = { ...settings }
  const encryptedApiKey = revealedSettings[encryptedApiKeyField]
  delete revealedSettings[encryptedApiKeyField]

  const apiKey = decryptApiKey(encryptedApiKey)
  if (apiKey) {
    revealedSettings.apiKey = apiKey
  }

  return revealedSettings
}

function protectModelSettings(settings: PersistedModelSettings): PersistedModelSettings {
  return {
    imageSettings: protectProviderSettings(settings.imageSettings),
    videoSettings: protectProviderSettings(settings.videoSettings),
    modelTemplates: settings.modelTemplates,
  }
}

function revealModelSettings(settings: PersistedModelSettings): PersistedModelSettings {
  return {
    imageSettings: revealProviderSettings(settings.imageSettings),
    videoSettings: revealProviderSettings(settings.videoSettings),
    modelTemplates: settings.modelTemplates,
  }
}

function getDialogOwner() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
}

function getSafeDuration(scene: ExportScene) {
  return Math.max(0.2, Number((scene.end_time - scene.start_time).toFixed(3)))
}

function getTotalDuration(request: ExportRequest) {
  const sceneDuration = request.scenes.reduce((max, scene) => Math.max(max, scene.end_time), 0)
  return Math.max(request.duration ?? 0, sceneDuration, 1)
}

function getImageExtension(source: string) {
  try {
    if (source.startsWith('data:image/')) {
      const match = source.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,/)?.[1]
      return match ? `.${match.replace('jpeg', 'jpg')}` : '.jpg'
    }

    const filePath = source.startsWith('file://') ? new URL(source).pathname : source.split('?')[0]
    const ext = path.extname(filePath)
    return ext && ext.length <= 6 ? ext : '.jpg'
  } catch {
    return '.jpg'
  }
}

function getVideoExtension(source: string) {
  try {
    if (source.startsWith('data:video/')) {
      const match = source.match(/^data:video\/([a-zA-Z0-9.+-]+);base64,/)?.[1]
      return match ? `.${match.replace('quicktime', 'mov')}` : '.mp4'
    }

    const filePath = source.startsWith('file://') ? new URL(source).pathname : source.split('?')[0]
    const ext = path.extname(filePath)
    return ext && ext.length <= 6 ? ext : '.mp4'
  } catch {
    return '.mp4'
  }
}

function isExternalSceneVideo(source?: string) {
  return Boolean(source && !source.startsWith('local-motion://'))
}

function normalizeConcatPath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "'\\''")
}

function formatAssTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const secs = Math.floor(safeSeconds % 60)
  const centiseconds = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 100)
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`
}

function wrapSubtitleText(text: string) {
  const chars = Array.from(text.trim())
  if (chars.length <= 24) {
    return text.trim()
  }

  const lines: string[] = []
  for (let index = 0; index < chars.length; index += 24) {
    lines.push(chars.slice(index, index + 24).join(''))
  }
  return lines.slice(0, 2).join('\\N')
}

function escapeAssText(text: string) {
  return wrapSubtitleText(text)
    .replace(/[{}]/g, '')
    .replace(/\r?\n/g, '\\N')
}

function getSubtitleFilterPath(filePath: string) {
  return filePath
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
}

function appendSubtitleFilter(filter: string, subtitlePath?: string) {
  if (!subtitlePath) {
    return filter
  }

  return `${filter},subtitles='${getSubtitleFilterPath(subtitlePath)}'`
}

async function createSubtitleFile(tempDir: string, request: ExportRequest) {
  if (!request.subtitles?.enabled || !Array.isArray(request.lyrics) || request.lyrics.length === 0) {
    return undefined
  }

  const validLyrics = request.lyrics
    .filter((line) => line.text.trim())
    .sort((a, b) => a.time - b.time)

  if (validLyrics.length === 0) {
    return undefined
  }

  const totalDuration = getTotalDuration(request)
  const subtitlePath = path.join(tempDir, 'lyrics.ass')
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 1280',
    'PlayResY: 720',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Microsoft YaHei,38,&H00FFFFFF,&H00FFFFFF,&HAA000000,&H66000000,0,0,0,0,100,100,0,0,1,2,1,2,72,72,52,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]

  const events = validLyrics.map((line, index) => {
    const nextStart = validLyrics[index + 1]?.time
    const endTime = Math.max(line.time + 0.8, Math.min(nextStart ?? line.time + 4, totalDuration))
    return `Dialogue: 0,${formatAssTime(line.time)},${formatAssTime(endTime)},Default,,0,0,0,,${escapeAssText(line.text)}`
  })

  await fs.writeFile(subtitlePath, [...header, ...events].join('\n'), 'utf8')
  return subtitlePath
}

async function materializeSceneImage(source: string, tempDir: string, index: number) {
  const extension = getImageExtension(source)
  const targetPath = path.join(tempDir, `scene-${String(index + 1).padStart(4, '0')}${extension}`)

  if (/^https?:\/\//i.test(source)) {
    const response = await axios.get<ArrayBuffer>(source, { responseType: 'arraybuffer', timeout: 30000 })
    await fs.writeFile(targetPath, Buffer.from(response.data))
    return targetPath
  }

  if (source.startsWith('data:')) {
    const base64Payload = source.split(',')[1]
    if (!base64Payload) {
      throw new Error('场景图片数据无效')
    }
    await fs.writeFile(targetPath, Buffer.from(base64Payload, 'base64'))
    return targetPath
  }

  if (source.startsWith('file://')) {
    const sourcePath = decodeURIComponent(new URL(source).pathname)
    await fs.copyFile(sourcePath, targetPath)
    return targetPath
  }

  if (path.isAbsolute(source)) {
    await fs.copyFile(source, targetPath)
    return targetPath
  }

  throw new Error(`暂不支持的场景图片来源：${source}`)
}

async function materializeSceneVideo(source: string, tempDir: string, index: number) {
  const extension = getVideoExtension(source)
  const targetPath = path.join(tempDir, `source-video-${String(index + 1).padStart(4, '0')}${extension}`)

  if (/^https?:\/\//i.test(source)) {
    const response = await axios.get<ArrayBuffer>(source, { responseType: 'arraybuffer', timeout: 120000 })
    await fs.writeFile(targetPath, Buffer.from(response.data))
    return targetPath
  }

  if (source.startsWith('data:')) {
    const base64Payload = source.split(',')[1]
    if (!base64Payload) {
      throw new Error('瑙嗛鐗囨鏁版嵁鏃犳晥')
    }
    await fs.writeFile(targetPath, Buffer.from(base64Payload, 'base64'))
    return targetPath
  }

  if (source.startsWith('file://')) {
    const sourcePath = decodeURIComponent(new URL(source).pathname)
    await fs.copyFile(sourcePath, targetPath)
    return targetPath
  }

  if (path.isAbsolute(source)) {
    await fs.copyFile(source, targetPath)
    return targetPath
  }

  throw new Error(`鏆備笉鏀寔鐨勮棰戠墖娈垫潵婧愶細${source}`)
}

async function createConcatListFile(tempDir: string, scenes: ExportScene[], imagePaths: string[]) {
  const concatFilePath = path.join(tempDir, 'scenes.txt')
  const lines: string[] = []

  scenes.forEach((scene, index) => {
    lines.push(`file '${normalizeConcatPath(imagePaths[index])}'`)
    lines.push(`duration ${getSafeDuration(scene).toFixed(3)}`)
  })

  lines.push(`file '${normalizeConcatPath(imagePaths[imagePaths.length - 1])}'`)
  await fs.writeFile(concatFilePath, lines.join('\n'), 'utf8')
  return concatFilePath
}

async function createVideoConcatListFile(tempDir: string, clipPaths: string[]) {
  const concatFilePath = path.join(tempDir, 'clips.txt')
  const lines = clipPaths.map((clipPath) => `file '${normalizeConcatPath(clipPath)}'`)
  await fs.writeFile(concatFilePath, lines.join('\n'), 'utf8')
  return concatFilePath
}

function getMotionZoomStep(motion: ExportRequest['motion']) {
  if (motion === 'subtle') {
    return 0.00035
  }
  if (motion === 'dramatic') {
    return 0.0011
  }
  return 0.0007
}

function getSceneMotionFilter(scene: ExportScene, request: ExportRequest, width: number, height: number, fps: number) {
  const motion = request.motion ?? 'none'
  const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`

  if (motion === 'none') {
    return `fps=${fps},${base},format=yuv420p`
  }

  const duration = getSafeDuration(scene)
  const frames = Math.max(1, Math.round(duration * fps))
  const zoomStep = getMotionZoomStep(motion)
  const cameraMotion = (scene.camera_motion ?? '').toLowerCase()

  if (cameraMotion.includes('pull back')) {
    return `${base},zoompan=z='max(1.0,1.08-on*${zoomStep})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`
  }

  if (cameraMotion.includes('lateral') || cameraMotion.includes('tracking')) {
    return `${base},zoompan=z='1.06':x='(iw-iw/zoom)*(on/${frames})':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`
  }

  return `${base},zoompan=z='min(1.1,1+on*${zoomStep})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps},format=yuv420p`
}

function runFfmpeg(
  resolvedFfmpegPath: string,
  args: string[],
  onProgressLine?: (line: string) => void
) {
  return new Promise<void>((resolve, reject) => {
    const ffmpegProcess = spawn(resolvedFfmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] as const,
    })
    let stderrOutput = ''
    let stdoutBuffer = ''

    ffmpegProcess.stdout.on('data', (chunk: Buffer) => {
      if (!onProgressLine) {
        return
      }

      stdoutBuffer += chunk.toString()
      let newlineIndex = stdoutBuffer.indexOf('\n')
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim()
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        onProgressLine(line)
        newlineIndex = stdoutBuffer.indexOf('\n')
      }
    })

    ffmpegProcess.stderr.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString()
    })

    ffmpegProcess.on('error', (error: Error) => {
      reject(error)
    })

    ffmpegProcess.on('close', (code: number | null) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderrOutput.trim() || `ffmpeg 退出码异常：${code}`))
    })
  })
}

async function runFfmpegWithSubtitleFallback(
  resolvedFfmpegPath: string,
  subtitlePath: string | undefined,
  createArgs: (subtitlePath?: string) => string[],
  onProgressLine?: (line: string) => void
) {
  try {
    await runFfmpeg(resolvedFfmpegPath, createArgs(subtitlePath), onProgressLine)
  } catch (error) {
    if (!subtitlePath) {
      throw error
    }

    sendExportProgress({
      stage: 'render',
      progress: 85,
      message: '字幕烧录失败，正在无字幕重试...',
    })
    await runFfmpeg(resolvedFfmpegPath, createArgs(undefined), onProgressLine)
  }
}

async function createSceneImageVideoClip(
  resolvedFfmpegPath: string,
  tempDir: string,
  scene: ExportScene,
  imagePath: string,
  request: ExportRequest,
  width: number,
  height: number,
  fps: number,
  index: number
) {
  const clipPath = path.join(tempDir, `clip-${String(index + 1).padStart(4, '0')}.mp4`)
  const duration = getSafeDuration(scene)
  const frames = Math.max(1, Math.round(duration * fps))
  const filter = getSceneMotionFilter(scene, request, width, height, fps)

  await runFfmpeg(resolvedFfmpegPath, [
    '-y',
    '-loop',
    '1',
    '-t',
    duration.toFixed(3),
    '-i',
    imagePath,
    '-vf',
    filter,
    '-frames:v',
    String(frames),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    clipPath,
  ])

  return clipPath
}

async function createExternalSceneVideoClip(
  resolvedFfmpegPath: string,
  tempDir: string,
  scene: ExportScene,
  videoPath: string,
  width: number,
  height: number,
  fps: number,
  index: number
) {
  const clipPath = path.join(tempDir, `clip-${String(index + 1).padStart(4, '0')}.mp4`)
  const duration = getSafeDuration(scene)
  const filter = `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`

  await runFfmpeg(resolvedFfmpegPath, [
    '-y',
    '-i',
    videoPath,
    '-t',
    duration.toFixed(3),
    '-vf',
    filter,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    clipPath,
  ])

  return clipPath
}

async function createSceneVideoClips(
  resolvedFfmpegPath: string,
  tempDir: string,
  scenes: ExportScene[],
  imagePaths: string[],
  request: ExportRequest,
  width: number,
  height: number,
  fps: number
) {
  const clipPaths: string[] = []

  for (const [index, scene] of scenes.entries()) {
    const clipPath = await createSceneImageVideoClip(
      resolvedFfmpegPath,
      tempDir,
      scene,
      imagePaths[index],
      request,
      width,
      height,
      fps,
      index
    )
    clipPaths.push(clipPath)
    sendExportProgress({
      stage: 'render',
      progress: Math.min(79, 45 + Math.round(((index + 1) / scenes.length) * 34)),
      message: `正在生成镜头运动 ${index + 1}/${scenes.length}`,
    })
  }

  return clipPaths
}

async function createMixedSceneVideoClips(
  resolvedFfmpegPath: string,
  tempDir: string,
  scenes: ExportScene[],
  request: ExportRequest,
  width: number,
  height: number,
  fps: number
) {
  const clipPaths: string[] = []

  for (const [index, scene] of scenes.entries()) {
    let clipPath: string

    if (isExternalSceneVideo(scene.video_url)) {
      const sourceVideoPath = await materializeSceneVideo(scene.video_url as string, tempDir, index)
      clipPath = await createExternalSceneVideoClip(
        resolvedFfmpegPath,
        tempDir,
        scene,
        sourceVideoPath,
        width,
        height,
        fps,
        index
      )
    } else {
      const imagePath = await materializeSceneImage(scene.image_url, tempDir, index)
      clipPath = await createSceneImageVideoClip(
        resolvedFfmpegPath,
        tempDir,
        scene,
        imagePath,
        request,
        width,
        height,
        fps,
        index
      )
    }

    clipPaths.push(clipPath)
    sendExportProgress({
      stage: 'render',
      progress: Math.min(79, 8 + Math.round(((index + 1) / scenes.length) * 71)),
      message: `姝ｅ湪鍑嗗瑙嗛鐗囨 ${index + 1}/${scenes.length}`,
    })
  }

  return clipPaths
}

function createConcatVideoWithAudioArgs(
  concatFilePath: string,
  audioPath: string,
  outputPath: string,
  subtitlePath?: string
) {
  const baseArgs = [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatFilePath,
    '-i',
    audioPath,
    '-progress',
    'pipe:1',
    '-nostats',
  ]

  if (subtitlePath) {
    return [
      ...baseArgs,
      '-vf',
      appendSubtitleFilter('format=yuv420p', subtitlePath),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '22',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      '-shortest',
      outputPath,
    ]
  }

  return [
    ...baseArgs,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    '-shortest',
    outputPath,
  ]
}

async function exportVideo(request: ExportRequest) {
  if (!request.audioPath || !path.isAbsolute(request.audioPath)) {
    throw new Error('未获取到可用的本地音频路径，请重新导入音乐文件后再试')
  }

  if (/\.mgg1?$/i.test(request.audioPath)) {
    throw new Error('mgg / mgg1 仍无法直接导出，请先转换为 MP3 后再试')
  }

  if (!request.outputPath || !path.isAbsolute(request.outputPath)) {
    throw new Error('导出路径无效，请重新选择导出位置')
  }

  if (!Array.isArray(request.scenes) || request.scenes.length === 0) {
    throw new Error('当前没有可导出的分镜，请先生成段落分镜')
  }

  const invalidScene = request.scenes.find((scene) => !scene.image_url && !isExternalSceneVideo(scene.video_url))
  if (invalidScene) {
    throw new Error(`分镜 ${invalidScene.scene_index + 1} 缺少图片，无法导出`)
  }

  const resolvedFfmpegPath = getResolvedFfmpegPath()
  if (typeof resolvedFfmpegPath !== 'string' || !resolvedFfmpegPath) {
    throw new Error('未检测到 ffmpeg，请确认 ffmpeg-static 已正确安装')
  }

  await fs.access(request.audioPath)

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-video-export-'))
  const totalDuration = getTotalDuration(request)
  const width = request.width ?? 1280
  const height = request.height ?? 720
  const fps = request.fps ?? 30

  sendExportProgress({ stage: 'prepare', progress: 2, message: '正在准备导出素材...' })

  try {
    const subtitlePath = await createSubtitleFile(tempDir, request)

    if (request.scenes.some((scene) => isExternalSceneVideo(scene.video_url))) {
      const clipPaths = await createMixedSceneVideoClips(
        resolvedFfmpegPath,
        tempDir,
        request.scenes,
        request,
        width,
        height,
        fps
      )
      const clipConcatFilePath = await createVideoConcatListFile(tempDir, clipPaths)

      sendExportProgress({ stage: 'render', progress: 80, message: '姝ｅ湪鎷兼帴瑙嗛鐗囨骞跺悎鎴愰煶棰?..' })

      await runFfmpegWithSubtitleFallback(
        resolvedFfmpegPath,
        subtitlePath,
        (subtitlePath) => createConcatVideoWithAudioArgs(clipConcatFilePath, request.audioPath, request.outputPath, subtitlePath),
        (line) => {
          if (line === 'progress=end') {
            sendExportProgress({ stage: 'complete', progress: 100, message: '瑙嗛瀵煎嚭瀹屾垚' })
          }
        }
      )

      return { outputPath: request.outputPath }
    }

    const imagePaths: string[] = []

    for (const [index, scene] of request.scenes.entries()) {
      const imagePath = await materializeSceneImage(scene.image_url, tempDir, index)
      imagePaths.push(imagePath)
      sendExportProgress({
        stage: 'download',
        progress: Math.min(45, Math.round(((index + 1) / request.scenes.length) * 45)),
        message: `正在缓存分镜图片 ${index + 1}/${request.scenes.length}`,
      })
    }

    if (request.motion && request.motion !== 'none') {
      const clipPaths = await createSceneVideoClips(
        resolvedFfmpegPath,
        tempDir,
        request.scenes,
        imagePaths,
        request,
        width,
        height,
        fps
      )
      const clipConcatFilePath = await createVideoConcatListFile(tempDir, clipPaths)

      sendExportProgress({ stage: 'render', progress: 80, message: '正在拼接镜头并合成音频...' })

      await runFfmpegWithSubtitleFallback(
        resolvedFfmpegPath,
        subtitlePath,
        (subtitlePath) => createConcatVideoWithAudioArgs(clipConcatFilePath, request.audioPath, request.outputPath, subtitlePath),
        (line) => {
          if (!line) {
            return
          }

          if (line === 'progress=end') {
            sendExportProgress({ stage: 'complete', progress: 100, message: '视频导出完成' })
          }
        }
      )

      return { outputPath: request.outputPath }
    }

    const concatFilePath = await createConcatListFile(tempDir, request.scenes, imagePaths)
    const baseStaticFilter = `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`

    sendExportProgress({ stage: 'render', progress: 50, message: 'ffmpeg 正在合成视频...' })

    await runFfmpegWithSubtitleFallback(
      resolvedFfmpegPath,
      subtitlePath,
      (subtitlePath) => [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        concatFilePath,
        '-i',
        request.audioPath,
        '-progress',
        'pipe:1',
        '-nostats',
        '-vf',
        appendSubtitleFilter(baseStaticFilter, subtitlePath),
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '22',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-shortest',
        request.outputPath,
      ],
      (line) => {
        if (!line) {
          return
        }

        if (line === 'progress=end') {
          sendExportProgress({ stage: 'complete', progress: 100, message: '视频导出完成' })
          return
        }

        const [key, rawValue] = line.split('=')
        if (!key || !rawValue) {
          return
        }

        let outTimeSeconds: number | null = null

        if (key === 'out_time') {
          const parts = rawValue.split(':').map(Number)
          if (parts.length === 3 && parts.every((value) => Number.isFinite(value))) {
            outTimeSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
          }
        }

        if ((key === 'out_time_ms' || key === 'out_time_us') && Number.isFinite(Number(rawValue))) {
          outTimeSeconds = Number(rawValue) / 1000000
        }

        if (outTimeSeconds === null) {
          return
        }

        const renderRatio = Math.min(1, Math.max(0, outTimeSeconds / totalDuration))
        const progress = Math.min(99, 50 + Math.round(renderRatio * 49))
        sendExportProgress({
          stage: 'render',
          progress,
          message: `ffmpeg 正在渲染：${Math.round(renderRatio * 100)}%`,
        })
      }
    )

    return { outputPath: request.outputPath }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

function startBackend() {
  const backendExePath = isDev
    ? path.join(__dirname, '../backend_dist/music-video-backend.exe')
    : path.join(process.resourcesPath, 'backend-exe/music-video-backend.exe')
  const backendScriptPath = isDev
    ? path.join(__dirname, '../backend/main.py')
    : path.join(process.resourcesPath, 'backend/main.py')
  const useBackendExe = existsSync(backendExePath)
  const backendCommand = useBackendExe ? backendExePath : 'python'
  const backendArgs = useBackendExe ? [] : [backendScriptPath]

  backendProcess = spawn(backendCommand, backendArgs, {
    stdio: 'pipe',
    windowsHide: true,
    env: {
      ...process.env,
      MUSIC_VIDEO_DATA_DIR: path.join(app.getPath('userData'), 'backend-data'),
      MUSIC_VIDEO_RELOAD: '0',
    },
  })

  backendProcess.stdout?.on('data', (data) => {
    console.log(`Backend: ${data}`)
  })

  backendProcess.stderr?.on('data', (data) => {
    console.error(`Backend Error: ${data}`)
  })

  backendProcess.on('close', (code) => {
    console.log(`Backend exited with code ${code}`)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f1a',
    show: false,
    title: 'AI Music Video Generator',
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'))
    })
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  if (isDev) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

ipcMain.handle('dialog:openFile', async (_, options) => {
  const owner = getDialogOwner()
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options)
  return result
})

ipcMain.handle('file:readText', async (_, filePath: string) => {
  if (!filePath || !path.isAbsolute(filePath)) {
    throw new Error('文件路径无效')
  }

  const stat = await fs.stat(filePath)
  if (stat.size > 20 * 1024 * 1024) {
    throw new Error('项目文件过大，无法读取')
  }

  return fs.readFile(filePath, 'utf8')
})

ipcMain.handle('settings:load', async () => {
  try {
    const fileText = await fs.readFile(getModelSettingsPath(), 'utf8')
    return revealModelSettings(normalizeModelSettings(JSON.parse(fileText)))
  } catch {
    return {}
  }
})

ipcMain.handle('settings:save', async (_, payload: unknown) => {
  const settings = protectModelSettings(normalizeModelSettings(payload))
  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(getModelSettingsPath(), JSON.stringify(settings, null, 2), 'utf8')
  return true
})

ipcMain.handle('dialog:saveFile', async (_, options) => {
  const owner = getDialogOwner()
  const result = owner
    ? await dialog.showSaveDialog(owner, options)
    : await dialog.showSaveDialog(options)
  return result
})

ipcMain.handle('video:export', async (_, request: ExportRequest) => {
  try {
    return await exportVideo(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : '视频导出失败'
    sendExportProgress({ stage: 'error', progress: 0, message })
    throw error
  }
})

app.whenReady().then(() => {
  if (!isDev) {
    startBackend()
  }
  createWindow()
})

app.on('window-all-closed', () => {
  backendProcess?.kill()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
