import React, { useEffect, useRef, useState } from 'react'
import { Typography, Button, Drawer, Empty, Form, Input, Modal, Select, Space, Switch, Tabs, Tag, Tooltip, message } from 'antd'
import {
  ThunderboltOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
  EditOutlined,
  CompressOutlined,
  SplitCellsOutlined,
  VideoCameraOutlined,
  StopOutlined,
  HistoryOutlined,
  DeleteOutlined,
  AppstoreOutlined,
  CopyOutlined,
  EyeOutlined,
  LockOutlined,
  CheckOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import { apiClient } from '@/api/client'
import { useAppStore, type GenerationLog, type GenerationStatus, type ImageGenerationSettings, type LyricLine, type ProjectAsset, type Scene, type StoryAnalysis, type VisualLockSettings } from '@/store/useAppStore'
import { normalizeGenerationStatus } from '@/utils/generationStatus'
import { buildLyricTimingEnergy } from '@/utils/musicEnergy'
import { validateKlingCredential } from '@/utils/videoCredentials'


const { Text, Title } = Typography

const styleColors: Record<string, string> = {
  auto: '#a78bfa',
  cinematic: '#4fc3f7',
  ornate_gufeng: '#fbbf24',
  song_landscape: '#a7f3d0',
  tang_mural: '#fdba74',
  xianxia: '#c4b5fd',
  guofeng_cinematic: '#d1d5db',
  stage_opera: '#fca5a5',
  cyberpunk: '#ff0099',
  inkwash: '#e8d5b7',
  anime: '#ff9ecd',
  realistic: '#7eb8f7',
  abstract: '#c084fc',
  dark_fantasy: '#818cf8',
  retro_film: '#facc15',
  stage_lighting: '#5eead4',
}

const shotTypeOptions = [
  { label: '远景 / 建立镜头', value: 'wide establishing shot' },
  { label: '中景 / 叙事镜头', value: 'medium narrative shot' },
  { label: '近景 / 情绪特写', value: 'dramatic close-up or dynamic medium shot' },
  { label: '收束远景 / 剪影', value: 'wide closing shot with strong silhouette' },
]

const cameraMotionOptions = [
  { label: '慢慢推近', value: 'slow dolly in' },
  { label: '横向跟拍', value: 'gentle lateral tracking' },
  { label: '缓慢推近 + 视差', value: 'slow push-in with subtle parallax' },
  { label: '缓慢拉远', value: 'slow pull back' },
]

const transitionOptions = [
  { label: '柔和叠化', value: 'soft dissolve' },
  { label: '匹配剪辑', value: 'match cut' },
  { label: '节奏切换', value: 'rhythmic cut' },
  { label: '淡出', value: 'fade out' },
]

const reindexScenes = (scenes: Scene[]) =>
  scenes
    .sort((a, b) => a.start_time - b.start_time)
    .map((scene, index) => ({
      ...scene,
      scene_index: index,
    }))

const combineUnique = (left: string[], right: string[]) => Array.from(new Set([...left, ...right]))

const imageStatusMeta: Record<GenerationStatus, { color: string; label: string }> = {
  idle: { color: 'default', label: '待生成' },
  queued: { color: 'warning', label: '排队中' },
  generating: { color: 'processing', label: '生成中' },
  done: { color: 'success', label: '已完成' },
  error: { color: 'error', label: '失败' },
}

const videoStatusMeta: Record<GenerationStatus, { color: string; label: string }> = {
  idle: { color: 'default', label: '视频待生成' },
  queued: { color: 'warning', label: '视频排队' },
  generating: { color: 'processing', label: '视频生成中' },
  done: { color: 'success', label: '视频已就绪' },
  error: { color: 'error', label: '视频失败' },
}

const getStatusMeta = (
  statusMeta: Record<GenerationStatus, { color: string; label: string }>,
  status?: string
) => statusMeta[normalizeGenerationStatus(status)]

const getErrorMessage = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.detail || error.message || '生成失败'
  }

  return error instanceof Error ? error.message : '生成失败'
}

const formatDurationMs = (durationMs?: number) => {
  if (!durationMs || durationMs < 0) {
    return ''
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`
  }
  return `${(durationMs / 1000).toFixed(1)} s`
}

const formatLogTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

const logTypeLabel: Record<GenerationLog['type'], string> = {
  storyboard: '智能分镜',
  image: '关键帧',
  video: '视频片段',
  export: '导出',
}

const logStatusMeta: Record<GenerationLog['status'], { color: string; label: string }> = {
  success: { color: 'success', label: '成功' },
  error: { color: 'error', label: '失败' },
  canceled: { color: 'default', label: '已取消' },
}

const assetTypeLabel: Record<ProjectAsset['type'], string> = {
  image: '图片',
  video: '视频',
  prompt: 'Prompt',
}

const copyToClipboard = async (value?: string) => {
  if (!value) {
    message.warning('没有可复制的内容')
    return
  }

  try {
    await navigator.clipboard.writeText(value)
    message.success('已复制')
  } catch {
    message.error('复制失败，请手动选择文本复制')
  }
}

const getVisualLockText = (visualLock?: VisualLockSettings) => {
  if (!visualLock?.enabled) {
    return ''
  }

  const parts = [
    visualLock.mainSubject ? `main subject: ${visualLock.mainSubject}` : '',
    visualLock.wardrobe ? `identity signature and allowed life-stage changes: ${visualLock.wardrobe}` : '',
    visualLock.setting ? `fixed setting: ${visualLock.setting}` : '',
    visualLock.palette ? `locked palette and lighting: ${visualLock.palette}` : '',
    visualLock.symbols ? `recurring symbols: ${visualLock.symbols}` : '',
    visualLock.negativePrompt ? `avoid: ${visualLock.negativePrompt}` : '',
  ].filter(Boolean)

  return parts.length
    ? `User visual continuity lock, higher priority than automatic interpretation: ${parts.join('; ')}.`
    : ''
}

const appendVisualLock = (prompt: string, visualLock?: VisualLockSettings) => {
  const lockText = getVisualLockText(visualLock)
  return lockText ? `${prompt} ${lockText}` : prompt
}

const toBackendVisualLock = (visualLock?: VisualLockSettings) => ({
  enabled: Boolean(visualLock?.enabled),
  main_subject: visualLock?.mainSubject || '',
  wardrobe: visualLock?.wardrobe || '',
  setting: visualLock?.setting || '',
  palette: visualLock?.palette || '',
  symbols: visualLock?.symbols || '',
  negative_prompt: visualLock?.negativePrompt || '',
})

const toBackendImageProvider = (settings: ImageGenerationSettings) => ({
  provider: settings.provider,
  model: settings.model,
  api_key: settings.apiKey,
  base_url: settings.baseUrl,
  size: settings.size,
  quality: settings.quality,
})

const confirmPaidImageQueue = (sceneCount: number, referenceCount = 0) =>
  new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: '确认生成关键帧',
      content: `将提交 ${sceneCount} 张分镜关键帧${referenceCount > 0 ? `，并先生成 ${referenceCount} 张身份、阶段、地点或道具参考图` : ''}，合计约 ${sceneCount + referenceCount} 个图片任务。云端平台可能收费。`,
      okText: '确认生成',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })

const confirmPaidVideoQueue = (count: number, seconds: number, isTest: boolean) =>
  new Promise<boolean>((resolve) => {
    Modal.confirm({
      title: isTest ? '确认生成三镜测试' : '确认生成全部云端镜头',
      content: `将使用同一云端模型提交 ${count} 个视频任务，总请求时长约 ${Math.ceil(seconds)} 秒。平台可能产生较高费用。`,
      okText: isTest ? '生成测试片' : '确认批量生成',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })

const getTestSceneIndexes = (scenes: Scene[]) => {
  if (scenes.length <= 3) return scenes.map((scene) => scene.scene_index)
  const pick = (pattern: RegExp) => scenes.find((scene) => pattern.test(scene.shot_type || ''))?.scene_index
  const candidates = [
    pick(/close|detail/i),
    pick(/medium|full/i),
    pick(/wide|establish|environment/i),
    scenes[Math.floor(scenes.length / 2)]?.scene_index,
    scenes[scenes.length - 1]?.scene_index,
  ]
  return Array.from(new Set(candidates.filter((value): value is number => typeof value === 'number'))).slice(0, 3)
}

const getProviderLock = (
  imageSettings: ImageGenerationSettings,
  videoProvider: string,
  videoModel: string,
  styleFingerprint?: string
) => `${imageSettings.provider}:${imageSettings.model}|${videoProvider}:${videoModel}|${styleFingerprint || 'no-style'}`

interface Props {
  onSceneSelect: (scene: Scene) => void
  selectedSceneIndex: number | null
}

const stringHash = (value: string) =>
  Array.from(value).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0)

const MIN_SEGMENT_LINES = 3
const IDEAL_SEGMENT_LINES = 4
const MAX_SEGMENT_LINES = 5
const BASE_HARD_PAUSE = 2.2
const BASE_SOFT_PAUSE = 1.6
const MIN_VISUAL_TEXT_LENGTH = 8
const MAX_VISUAL_GROUP_LINES = 3
const MAX_VISUAL_GROUP_TEXT_LENGTH = 36

const styleKeywords: Record<string, string> = {
  cinematic: 'cinematic lighting, film grain, dramatic shadows, cohesive color script, movie quality',
  cyberpunk: 'neon lights, rain reflections, futuristic city, holographic displays, atmospheric depth',
  inkwash: 'Chinese ink wash painting, misty mountains, poetic negative space, traditional brushwork',
  anime: 'anime illustration, soft pastel colors, expressive characters, detailed scene composition',
  realistic: 'photorealistic, natural lighting, high detail photography, cinematic depth',
  abstract: 'abstract geometric shapes, vibrant colors, layered texture, modern art composition',
}

const arcTemplates = [
  { title: '序章', mood: 'calm cinematic opening' },
  { title: '铺垫', mood: 'gentle emotional build-up' },
  { title: '推进', mood: 'steady narrative progression' },
  { title: '转折', mood: 'subtle emotional turning point' },
  { title: '高潮', mood: 'intense and powerful emotional peak' },
  { title: '回响', mood: 'echoing chorus and recurring emotion' },
  { title: '余韵', mood: 'reflective lingering aftertaste' },
  { title: '尾声', mood: 'quiet closing resolution' },
]

const themeKeywords: Record<string, string[]> = {
  farewell: ['别', '离', '散', '送', '归', '走', '远方'],
  memory: ['回忆', '从前', '曾经', '昨日', '记得', '往事'],
  night: ['夜', '月', '星', '灯', '梦', '黑', '晚', '黎明'],
  journey: ['路', '风', '山', '海', '船', '远', '站', '旅行'],
  city: ['城', '街', '楼', '窗', '人海', '霓虹', '巷'],
  emotion: ['心', '泪', '爱', '想念', '孤独', '寂寞', '拥抱', '温柔'],
  nature: ['雨', '雪', '云', '花', '叶', '江', '河', '雾', '海'],
}

const normalizeLyricText = (text: string) =>
  text.trim().toLowerCase().replace(/[\s，。！？、；：“”‘’（）()《》【】…—,.!?;:·-]+/g, '')

const lineLooksComplete = (text: string) => /[。！？!?；;…]$/.test(text.trim()) || text.trim().length >= 10

const detectTheme = (text: string) => {
  const found = Object.entries(themeKeywords).find(([, keywords]) =>
    keywords.some((keyword) => text.includes(keyword))
  )
  return found?.[0] ?? 'neutral'
}

const medianGap = (lyrics: LyricLine[]) => {
  const gaps = lyrics
    .slice(1)
    .map((line, index) => Math.max(0, line.time - lyrics[index].time))
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b)

  if (gaps.length === 0) {
    return 4
  }

  const middle = Math.floor(gaps.length / 2)
  return gaps.length % 2 === 1 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2
}

const getPauseThresholds = (lyrics: LyricLine[]) => {
  const baseGap = medianGap(lyrics)
  return {
    hardPause: Math.max(BASE_HARD_PAUSE, baseGap * 1.8),
    softPause: Math.max(BASE_SOFT_PAUSE, baseGap * 1.25),
  }
}

const shouldSplitSegment = (
  currentSegment: LyricLine[],
  nextLine: LyricLine,
  seenCounts: Map<string, number>,
  hardPause: number,
  softPause: number
) => {
  if (currentSegment.length === 0) {
    return false
  }

  const previousLine = currentSegment[currentSegment.length - 1]
  const gap = Math.max(0, nextLine.time - previousLine.time)
  const nextKey = normalizeLyricText(nextLine.text)
  const repeatedLine = Boolean(nextKey) && (seenCounts.get(nextKey) ?? 0) > 0
  const currentTheme = detectTheme(currentSegment.slice(-2).map((line) => line.text).join(' '))
  const nextTheme = detectTheme(nextLine.text)
  const themeShift =
    currentSegment.length >= MIN_SEGMENT_LINES &&
    currentTheme !== 'neutral' &&
    nextTheme !== 'neutral' &&
    currentTheme !== nextTheme

  if (currentSegment.length >= MAX_SEGMENT_LINES) {
    return true
  }

  if (gap >= hardPause && currentSegment.length >= 2) {
    return true
  }

  if (repeatedLine && currentSegment.length >= 2) {
    return true
  }

  if (
    currentSegment.length >= IDEAL_SEGMENT_LINES &&
    (gap >= softPause || lineLooksComplete(previousLine.text) || themeShift)
  ) {
    return true
  }

  return false
}

const mergeShortSegments = (segments: LyricLine[][]) => {
  const merged: LyricLine[][] = []

  segments.forEach((segment) => {
    if (segment.length === 0) {
      return
    }

    if (
      merged.length > 0 &&
      segment.length < MIN_SEGMENT_LINES &&
      merged[merged.length - 1].length + segment.length <= MAX_SEGMENT_LINES + 1
    ) {
      merged[merged.length - 1] = [...merged[merged.length - 1], ...segment]
      return
    }

    if (merged.length > 0 && merged[merged.length - 1].length < MIN_SEGMENT_LINES) {
      merged[merged.length - 1] = [...merged[merged.length - 1], ...segment]
      return
    }

    merged.push([...segment])
  })

  if (merged.length >= 2 && merged[merged.length - 1].length < MIN_SEGMENT_LINES) {
    merged[merged.length - 2] = [...merged[merged.length - 2], ...merged[merged.length - 1]]
    merged.pop()
  }

  return merged
}

const buildLyricSegments = (validLyrics: LyricLine[]) => {
  if (validLyrics.length === 0) {
    return [] as LyricLine[][]
  }

  const { hardPause, softPause } = getPauseThresholds(validLyrics)
  const seenCounts = new Map<string, number>()
  const segments: LyricLine[][] = []
  let currentSegment: LyricLine[] = []

  validLyrics.forEach((line) => {
    if (shouldSplitSegment(currentSegment, line, seenCounts, hardPause, softPause)) {
      segments.push(currentSegment)
      currentSegment = []
    }

    currentSegment.push(line)

    const lineKey = normalizeLyricText(line.text)
    if (lineKey) {
      seenCounts.set(lineKey, (seenCounts.get(lineKey) ?? 0) + 1)
    }
  })

  if (currentSegment.length > 0) {
    segments.push(currentSegment)
  }

  return mergeShortSegments(segments)
}

const getArcTemplate = (index: number, total: number) => {
  if (total <= 1) {
    return arcTemplates[0]
  }

  const arcIndex = Math.round((index * (arcTemplates.length - 1)) / Math.max(total - 1, 1))
  return arcTemplates[Math.min(arcTemplates.length - 1, arcIndex)]
}

const buildGlobalSummary = (lyrics: LyricLine[]) => {
  const snippets: string[] = []

  lyrics.forEach((line) => {
    const text = line.text.trim()
    if (text && !snippets.includes(text) && snippets.length < 5) {
      snippets.push(text)
    }
  })

  return snippets.join('，').slice(0, 100)
}

const visualTextLength = (text: string) => normalizeLyricText(text).length

const isShortVisualLine = (line: LyricLine) => visualTextLength(line.text) < MIN_VISUAL_TEXT_LENGTH

const visualGroupTextLength = (group: LyricLine[]) =>
  group.reduce((total, line) => total + visualTextLength(line.text), 0)

const canMergeVisualGroup = (left: LyricLine[], right: LyricLine[]) =>
  left.length + right.length <= MAX_VISUAL_GROUP_LINES &&
  visualGroupTextLength(left) + visualGroupTextLength(right) <= MAX_VISUAL_GROUP_TEXT_LENGTH

const buildVisualGroups = (validLyrics: LyricLine[]) => {
  const groups: LyricLine[][] = []

  validLyrics.forEach((line) => {
    const lineGroup = [line]
    const previousGroup = groups[groups.length - 1]

    if (isShortVisualLine(line) && previousGroup && canMergeVisualGroup(previousGroup, lineGroup)) {
      previousGroup.push(line)
      return
    }

    groups.push(lineGroup)
  })

  const merged: LyricLine[][] = []
  let index = 0

  while (index < groups.length) {
    const group = groups[index]
    const isLonelyShortGroup = group.length === 1 && isShortVisualLine(group[0])

    if (isLonelyShortGroup && groups[index + 1] && canMergeVisualGroup(group, groups[index + 1])) {
      groups[index + 1] = [...group, ...groups[index + 1]]
      index += 1
      continue
    }

    if (isLonelyShortGroup && merged.length > 0 && canMergeVisualGroup(merged[merged.length - 1], group)) {
      merged[merged.length - 1] = [...merged[merged.length - 1], ...group]
    } else {
      merged.push([...group])
    }

    index += 1
  }

  return merged
}

const buildSegmentStoryboard = (
  lyrics: LyricLine[],
  style: string,
  duration: number
): { scenes: Scene[]; analysis: StoryAnalysis } => {
  const validLyrics = lyrics.filter((line) => !line.skip && line.text.trim())

  if (validLyrics.length === 0) {
    return {
      scenes: [],
      analysis: {
        total_scenes: 0,
        valid_lyrics: 0,
        style,
        summary: '没有有效歌词，请先导入歌词',
      },
    }
  }

  const styleKeyword = styleKeywords[style] || styleKeywords.cinematic
  const segments = buildLyricSegments(validLyrics)
  const globalSummary = buildGlobalSummary(validLyrics)
  const sceneKeyMap = new Map<string, number>()
  const effectiveDuration = duration || validLyrics[validLyrics.length - 1].time + 3

  const scenes = segments.map((segment, index) => {
    const arc = getArcTemplate(index, segments.length)
    const combinedText = segment.map((line) => line.text).join('，')
    const shortText = combinedText.slice(0, 90)
    const lastLineTime = segment[segment.length - 1].time
    const nextStart = segments[index + 1]?.[0]?.time ?? effectiveDuration
    const endTime = Math.max(lastLineTime + 0.4, nextStart - 0.12)
    const segmentKeys = segment
      .map((line) => normalizeLyricText(line.text))
      .filter(Boolean)
    const reuseFrom = segmentKeys.find((key) => sceneKeyMap.has(key))
    const variationPrompt = reuseFrom
      ? 'reuse the established chorus visual motif with a fresh camera angle, tighter continuity'
      : 'introduce a new but style-consistent composition'
    const seed = Math.abs(stringHash(`${combinedText}-${style}-${index}`)) % 1000

    segmentKeys.forEach((key) => {
      if (!sceneKeyMap.has(key)) {
        sceneKeyMap.set(key, index)
      }
    })

    return {
      scene_index: index,
      title: `分镜${index + 1} · ${arc.title}`,
      description: combinedText.slice(0, 72) + (combinedText.length > 72 ? '...' : ''),
      prompt: `${arc.mood}, song visual theme: '${globalSummary}', lyrics segment: '${shortText}', ${styleKeyword}, ${variationPrompt}, high quality, 4k, wide angle`,
      start_time: segment[0].time,
      end_time: endTime,
      lyric_ids: segment.map((line) => line.id),
      image_url: `https://picsum.photos/seed/${seed}/1280/720`,
    }
  })

  const averageLines = (validLyrics.length / Math.max(scenes.length, 1)).toFixed(1)

  return {
    scenes,
    analysis: {
      total_scenes: scenes.length,
      valid_lyrics: validLyrics.length,
      style,
      summary: `已按段落切分 ${validLyrics.length} 行歌词，生成 ${scenes.length} 个分镜，平均每镜 ${averageLines} 行歌词`,
    },
  }
}

const getProviderLabel = (provider: string) => {
  const labels: Record<string, string> = {
    placeholder: '占位图',
    pollinations: 'Pollinations 免费图片',
    openai: 'OpenAI 图片',
    custom: '自定义模型',
    none: '不生成视频',
    local_motion: '本地动态',
    runway: 'Runway',
    luma: 'Luma',
    kling: 'Kling',
  }
  return labels[provider] || provider
}

const formatMinutesRange = (minSeconds: number, maxSeconds: number) => {
  if (maxSeconds <= 0) {
    return '即时'
  }
  const minMinutes = Math.max(1, Math.ceil(minSeconds / 60))
  const maxMinutes = Math.max(minMinutes, Math.ceil(maxSeconds / 60))
  return minMinutes === maxMinutes ? `约 ${minMinutes} 分钟` : `约 ${minMinutes}-${maxMinutes} 分钟`
}

const getGenerationEstimate = (
  lyrics: LyricLine[],
  scenes: Scene[],
  style: string,
  duration: number | undefined,
  songName: string | undefined,
  imageProvider: string,
  videoProvider: string
) => {
  const validLyrics = lyrics.filter((line) => !line.skip && line.text.trim())
  const songDuration = Math.max(duration || validLyrics[validLyrics.length - 1]?.time || 240, 1)
  const cloudTarget = Math.max(
    Math.ceil(songDuration / 10),
    Math.min(Math.floor(songDuration / 5), songDuration >= 240
      ? Math.max(30, Math.min(50, Math.round(songDuration / 8)))
      : Math.max(1, Math.round(songDuration / 8)))
  )
  const estimatedSceneCount =
    scenes.length > 0
      ? scenes.length
      : cloudTarget
  const imageJobs = estimatedSceneCount
  const videoJobs = videoProvider === 'none' ? 0 : estimatedSceneCount
  const imagePaid = !['placeholder', 'pollinations'].includes(imageProvider)
  const videoPaid = !['none', 'local_motion'].includes(videoProvider)
  const imageSeconds =
    imageProvider === 'placeholder'
      ? [0, 0]
      : imageProvider === 'pollinations'
        ? [imageJobs * 12, imageJobs * 45]
        : [imageJobs * 20, imageJobs * 90]
  const videoSeconds =
    videoProvider === 'none'
      ? [0, 0]
      : videoProvider === 'local_motion'
        ? [videoJobs * 4, videoJobs * 12]
        : [videoJobs * 60, videoJobs * 300]
  const minSeconds = imageSeconds[0] + videoSeconds[0]
  const maxSeconds = imageSeconds[1] + videoSeconds[1]

  return {
    validLyrics: validLyrics.length,
    estimatedSceneCount,
    imageJobs,
    videoJobs,
    imageProviderLabel: getProviderLabel(imageProvider),
    videoProviderLabel: getProviderLabel(videoProvider),
    timeText: formatMinutesRange(minSeconds, maxSeconds),
    costText:
      imagePaid || videoPaid
        ? `可能产生平台费用：${imagePaid ? `${imageJobs} 张图片` : ''}${imagePaid && videoPaid ? ' + ' : ''}${videoPaid ? `${videoJobs} 段视频 / 约 ${Math.ceil(songDuration)} 秒` : ''}`
        : '免费 / 本地处理',
  }
}


const StoryboardPanel: React.FC<Props> = ({ onSceneSelect, selectedSceneIndex }) => {
  const {
    project,
    directorSettings,
    imageSettings,
    videoSettings,
    isGenerating,
    setProject,
    setGenerating,
    setScenes,
    setLyrics,
    addGenerationLog,
    clearGenerationLogs,
    addProjectAsset,
    clearProjectAssets,
  } = useAppStore()
  const accent = styleColors[project.style] || '#4fc3f7'
  const generationEstimate = getGenerationEstimate(
    project.lyrics,
    project.scenes,
    project.style,
    project.duration,
    project.musicName,
    imageSettings.provider,
    videoSettings.provider
  )
  const [editingSceneIndex, setEditingSceneIndex] = useState<number | null>(null)
  const [splitAfterLyricId, setSplitAfterLyricId] = useState<string | null>(null)
  const [isLogDrawerOpen, setLogDrawerOpen] = useState(false)
  const [isAssetDrawerOpen, setAssetDrawerOpen] = useState(false)
  const [assetDrawerTab, setAssetDrawerTab] = useState('contact-sheet')
  const [isVisualLockDrawerOpen, setVisualLockDrawerOpen] = useState(false)
  const [isImageQueueRunning, setImageQueueRunning] = useState(false)
  const [isVideoQueueRunning, setVideoQueueRunning] = useState(false)
  const [isRestoringKeyframes, setRestoringKeyframes] = useState(false)
  const imageQueueCancelRef = useRef(false)
  const videoQueueCancelRef = useRef(false)
  const imageQueueAbortRef = useRef<AbortController | null>(null)
  const videoQueueAbortRef = useRef<AbortController | null>(null)
  const [editForm] = Form.useForm<Partial<Scene>>()
  const [visualLockForm] = Form.useForm<VisualLockSettings>()
  const editingScene =
    editingSceneIndex === null
      ? null
      : project.scenes.find((scene) => scene.scene_index === editingSceneIndex) ?? null
  const projectAssets = project.assets ?? []
  const imageAssets = projectAssets.filter((asset) => asset.type === 'image')
  const videoAssets = projectAssets.filter((asset) => asset.type === 'video')
  const promptAssets = projectAssets.filter((asset) => asset.prompt || asset.videoPrompt)
  const testSceneIndexes = project.generationPolicy.test_scene_indexes ?? []
  const testSceneIndexSet = new Set(testSceneIndexes)
  const testScenes = project.scenes.filter((scene) => testSceneIndexSet.has(scene.scene_index))
  const areTestScenesReady = testSceneIndexes.length > 0
    && testScenes.length === testSceneIndexes.length
    && testScenes.every(
      (scene) => scene.video_status === 'done'
        && Boolean(scene.video_url)
        && scene.quality_status !== 'rejected'
    )

  const recordSceneAsset = (
    scene: Scene,
    type: ProjectAsset['type'],
    options: {
      url?: string
      provider?: string
      model?: string
      source?: ProjectAsset['source']
      title?: string
    } = {}
  ) => {
    addProjectAsset({
      type,
      title: options.title || `${type === 'video' ? '视频片段' : '关键帧'} ${scene.scene_index + 1}`,
      url: options.url,
      prompt: scene.prompt,
      videoPrompt: scene.video_prompt,
      provider: options.provider,
      model: options.model,
      sceneIndex: scene.scene_index,
      sceneTitle: scene.title,
      source: options.source,
    })
  }

  const handleFocusAssetScene = (asset: ProjectAsset) => {
    if (typeof asset.sceneIndex !== 'number') {
      return
    }
    const scene = project.scenes.find((item) => item.scene_index === asset.sceneIndex)
    if (!scene) {
      message.warning('对应镜头不存在')
      return
    }
    onSceneSelect(scene)
    setAssetDrawerOpen(false)
  }

  useEffect(() => {
    if (!editingScene) {
      editForm.resetFields()
      setSplitAfterLyricId(null)
      return
    }

    editForm.setFieldsValue(editingScene)
    setSplitAfterLyricId(editingScene.lyric_ids.length > 1 ? editingScene.lyric_ids[0] : null)
  }, [editForm, editingScene])

  useEffect(() => {
    if (isVisualLockDrawerOpen) {
      visualLockForm.setFieldsValue(project.visualLock ?? { enabled: false })
    }
  }, [isVisualLockDrawerOpen, project.visualLock, visualLockForm])

  const handleSaveVisualLock = async () => {
    const values = await visualLockForm.validateFields()
    setProject({
      visualLock: {
        enabled: Boolean(values.enabled),
        mainSubject: values.mainSubject?.trim(),
        wardrobe: values.wardrobe?.trim(),
        setting: values.setting?.trim(),
        palette: values.palette?.trim(),
        symbols: values.symbols?.trim(),
        negativePrompt: values.negativePrompt?.trim(),
      },
    })
    setVisualLockDrawerOpen(false)
    message.success('视觉设定已保存')
  }

  const applyStoryboardResult = (scenes: Scene[], analysis: StoryAnalysis) => {
    const normalizedScenes = scenes.map((scene) => ({
      ...scene,
      lyric_ids: Array.isArray(scene.lyric_ids) ? scene.lyric_ids : [],
      hero_prop_ids: Array.isArray(scene.hero_prop_ids) ? scene.hero_prop_ids : [],
      quality_errors: Array.isArray(scene.quality_errors) ? scene.quality_errors : [],
      image_status: normalizeGenerationStatus(scene.image_status || scene.generation_status),
      video_status: normalizeGenerationStatus(scene.video_status),
      generation_status: normalizeGenerationStatus(scene.generation_status || scene.image_status),
    }))
    const providerCompatibleScenes = videoSettings.provider === 'runway'
      ? normalizedScenes.map((scene) => ({ ...scene, transition: 'cut' }))
      : normalizedScenes
    const sceneMap: Record<string, number> = {}

    providerCompatibleScenes.forEach((scene) => {
      scene.lyric_ids.forEach((id) => {
        sceneMap[id] = scene.scene_index
      })
    })

    const updatedLyrics = project.lyrics.map((line) => ({
      ...line,
      sceneIndex: sceneMap[line.id] ?? undefined,
    }))

    setLyrics(updatedLyrics)
    setScenes(providerCompatibleScenes, analysis)
    setProject({
      visualBible: analysis.visual_bible,
      resolvedStyle: analysis.resolved_style || analysis.style,
      generationPolicy: {
        ...project.generationPolicy,
        min_scene_seconds: 6,
        max_scene_seconds: videoSettings.provider === 'luma' ? 9 : 10,
        test_scene_indexes: [],
        test_approved: false,
        provider_locked: false,
        image_provider: imageSettings.provider,
        image_model: imageSettings.model,
        video_provider: videoSettings.provider,
        video_model: videoSettings.model,
        style_fingerprint: analysis.visual_bible?.fingerprint,
      },
    })
    providerCompatibleScenes.forEach((scene) => {
      if (scene.image_url) {
        recordSceneAsset(scene, 'image', {
          url: scene.image_url,
          provider: imageSettings.provider,
          model: imageSettings.model,
          source: 'storyboard',
          title: `Storyboard keyframe ${scene.scene_index + 1}`,
        })
      }
    })
  }

  const formatTime = (s: number) => {

    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  }

  const handleOpenEdit = (scene: Scene, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSceneIndex(scene.scene_index)
  }

  const handleSaveSceneEdit = async () => {
    if (!editingScene) {
      return
    }

    const values = await editForm.validateFields()
    const updatedScenes = project.scenes.map((scene) =>
      scene.scene_index === editingScene.scene_index
        ? {
            ...scene,
            ...values,
            image_status: 'idle' as GenerationStatus,
            video_status: 'idle' as GenerationStatus,
            generation_error: undefined,
            video_url: undefined,
            video_provider: undefined,
            video_model: undefined,
            provider_task_id: undefined,
            quality_status: 'pending' as const,
            quality_errors: [],
            video_error: undefined,
          }
        : scene
    )

    setScenes(updatedScenes, project.analysis)
    setProject({
      generationPolicy: {
        ...project.generationPolicy,
        test_approved: false,
        provider_locked: false,
        test_scene_indexes: [],
      },
    })
    setEditingSceneIndex(null)
    message.success('镜头设置已保存')
  }

  const handleMergeScene = (scene: Scene, direction: 'previous' | 'next', e?: React.MouseEvent) => {
    e?.stopPropagation()

    const orderedScenes = reindexScenes([...project.scenes])
    const currentIndex = orderedScenes.findIndex((item) => item.scene_index === scene.scene_index)
    const targetIndex = direction === 'previous' ? currentIndex - 1 : currentIndex + 1
    const targetScene = orderedScenes[targetIndex]
    const currentScene = orderedScenes[currentIndex]

    if (!targetScene || !currentScene) {
      message.warning(direction === 'previous' ? '前面没有可合并的镜头' : '后面没有可合并的镜头')
      return
    }

    const mergedDuration = Math.max(targetScene.end_time, currentScene.end_time)
      - Math.min(targetScene.start_time, currentScene.start_time)
    if (mergedDuration > project.generationPolicy.max_scene_seconds) {
      message.warning(`全云端镜头最长 ${project.generationPolicy.max_scene_seconds} 秒，不能合并为 ${mergedDuration.toFixed(1)} 秒`)
      return
    }

    const firstScene = targetScene.start_time <= currentScene.start_time ? targetScene : currentScene
    const secondScene = firstScene === targetScene ? currentScene : targetScene
    const mergedScene: Scene = {
      ...firstScene,
      title: `${firstScene.title} + ${secondScene.title}`,
      description: [firstScene.description, secondScene.description].filter(Boolean).join('，'),
      summary: [firstScene.summary, secondScene.summary].filter(Boolean).join('，'),
      start_time: Math.min(firstScene.start_time, secondScene.start_time),
      end_time: Math.max(firstScene.end_time, secondScene.end_time),
      lyric_ids: combineUnique(firstScene.lyric_ids, secondScene.lyric_ids),
      video_prompt: [firstScene.video_prompt, secondScene.video_prompt].filter(Boolean).join(' '),
      image_status: 'idle' as GenerationStatus,
      video_status: 'idle' as GenerationStatus,
      generation_error: undefined,
      video_url: undefined,
      video_error: undefined,
    }

    const nextScenes = orderedScenes.filter(
      (item) => item.scene_index !== targetScene.scene_index && item.scene_index !== currentScene.scene_index
    )
    nextScenes.push(mergedScene)

    const reindexed = reindexScenes(nextScenes)
    const nextEditingScene = reindexed.find(
      (item) => item.start_time === mergedScene.start_time && item.end_time === mergedScene.end_time
    )
    setScenes(reindexed, project.analysis)
    setEditingSceneIndex(nextEditingScene?.scene_index ?? null)
    message.success('镜头已合并')
  }

  const handleSplitScene = () => {
    if (!editingScene || !splitAfterLyricId) {
      message.warning('请选择拆分位置')
      return
    }

    const splitIndex = editingScene.lyric_ids.indexOf(splitAfterLyricId)
    if (splitIndex < 0 || splitIndex >= editingScene.lyric_ids.length - 1) {
      message.warning('请选择镜头中间的歌词作为拆分位置')
      return
    }

    const firstLyricIds = editingScene.lyric_ids.slice(0, splitIndex + 1)
    const secondLyricIds = editingScene.lyric_ids.slice(splitIndex + 1)
    const firstEndLyric = project.lyrics.find((line) => line.id === splitAfterLyricId)
    const secondStartLyric = project.lyrics.find((line) => line.id === secondLyricIds[0])
    const splitTime = secondStartLyric?.time ?? firstEndLyric?.time ?? (editingScene.start_time + editingScene.end_time) / 2
    const firstText = project.lyrics
      .filter((line) => firstLyricIds.includes(line.id))
      .map((line) => line.text)
      .join('，')
    const secondText = project.lyrics
      .filter((line) => secondLyricIds.includes(line.id))
      .map((line) => line.text)
      .join('，')

    const firstScene: Scene = {
      ...editingScene,
      title: `${editingScene.title} A`,
      description: firstText || editingScene.description,
      summary: firstText || editingScene.summary,
      end_time: Math.max(editingScene.start_time + 0.4, splitTime),
      lyric_ids: firstLyricIds,
      image_status: 'idle' as GenerationStatus,
      video_status: 'idle' as GenerationStatus,
      generation_error: undefined,
      video_url: undefined,
      video_error: undefined,
    }

    const secondScene: Scene = {
      ...editingScene,
      title: `${editingScene.title} B`,
      description: secondText || editingScene.description,
      summary: secondText || editingScene.summary,
      start_time: Math.max(editingScene.start_time, splitTime),
      lyric_ids: secondLyricIds,
      image_status: 'idle' as GenerationStatus,
      video_status: 'idle' as GenerationStatus,
      generation_error: undefined,
      video_url: undefined,
      video_error: undefined,
    }

    const nextScenes = project.scenes.filter((scene) => scene.scene_index !== editingScene.scene_index)
    nextScenes.push(firstScene, secondScene)
    const reindexed = reindexScenes(nextScenes)
    const nextEditingScene = reindexed.find(
      (item) => item.start_time === firstScene.start_time && item.end_time === firstScene.end_time
    )
    setScenes(reindexed, project.analysis)
    setEditingSceneIndex(nextEditingScene?.scene_index ?? null)
    message.success('镜头已拆分')
  }

  // 生成智能分镜
  const handleGenerate = async () => {
    const validLyrics = project.lyrics.filter((line) => !line.skip)
    if (validLyrics.length === 0) {
      message.warning('请先导入歌词')
      return
    }

    const startedAt = Date.now()

    setGenerating(true)
    message.loading({ content: 'AI 导演正在分析歌词并生成智能分镜...', key: 'storyboard' })

    try {
      // Decoding a complete 5-minute song in the renderer expands compressed audio
      // into hundreds of MB of PCM and can terminate Electron's renderer. Lyric
      // timing still gives the director useful density/section peaks without loading
      // the whole audio file into memory.
      const musicEnergy = buildLyricTimingEnergy(project.lyrics, project.duration)
      const res = await apiClient.post('/api/generate/smart-storyboard', {
        lyrics: project.lyrics,
        style: project.style,
        duration: project.duration || 240,
        song_name: project.musicName || '',
        music_energy: musicEnergy,
        image_provider: toBackendImageProvider(imageSettings),
        video_provider: {
          provider: videoSettings.provider,
          model: videoSettings.model,
          api_key: '',
          base_url: '',
          motion_strength: videoSettings.motionStrength,
          clip_seconds: videoSettings.clipSeconds,
        },
        llm_provider: {
          provider: directorSettings.provider,
          model: directorSettings.model,
          api_key: directorSettings.apiKey,
          base_url: directorSettings.baseUrl,
        },
        visual_lock: toBackendVisualLock(project.visualLock),
        generation_policy: {
          ...project.generationPolicy,
          min_scene_seconds: 6,
          max_scene_seconds: videoSettings.provider === 'luma' ? 9 : 10,
        },
      })

      const { scenes, analysis } = res.data as {
        scenes?: Scene[]
        analysis?: StoryAnalysis
      }

      if (!Array.isArray(scenes) || !analysis) {
        throw new Error('invalid storyboard response')
      }

      if (scenes.length === 0) throw new Error(analysis.summary || '后端未返回全云端分镜')

      applyStoryboardResult(scenes, analysis)
      addGenerationLog({
        type: 'storyboard',
        status: 'success',
        title: 'AI 智能分镜',
        provider: imageSettings.provider,
        model: imageSettings.model,
        message: `生成 ${scenes.length} 个镜头，覆盖 ${analysis.valid_lyrics} 行歌词`,
        durationMs: Date.now() - startedAt,
      })
      message.success({
        content: `智能分镜生成完成！共 ${scenes.length} 个镜头`,
        key: 'storyboard',
      })
    } catch (error) {
      addGenerationLog({
        type: 'storyboard',
        status: 'error',
        title: 'AI 智能分镜失败',
        provider: imageSettings.provider,
        model: imageSettings.model,
        message: '全云端分镜生成失败，未使用低密度本地分镜替代',
        error: getErrorMessage(error),
        durationMs: Date.now() - startedAt,
      })

      message.error({
        content: `全云端分镜生成失败：${getErrorMessage(error)}`,
        key: 'storyboard',
      })
    } finally {
      setGenerating(false)
    }
  }



  // 重新生成单个场景图片
  const handleCancelImageQueue = () => {
    imageQueueCancelRef.current = true
    imageQueueAbortRef.current?.abort()
    message.info('正在取消关键帧队列...')
  }

  const handleCancelVideoQueue = () => {
    videoQueueCancelRef.current = true
    videoQueueAbortRef.current?.abort()
    message.info('正在取消视频队列...')
  }

  const handleGenerateKeyframeQueue = async (mode: 'all' | 'failed' = 'all') => {
    if (project.scenes.length === 0) {
      message.warning('请先生成智能分镜')
      return
    }

    setImageQueueRunning(true)
    let failedCount = 0
    let nextScenes: Scene[] = reindexScenes([...project.scenes]).map((scene) => ({
      ...scene,
      image_status: 'queued' as GenerationStatus,
      generation_error: undefined,
    }))

    setScenes(nextScenes, project.analysis)
    message.loading({ content: `关键帧队列已开始，共 ${nextScenes.length} 个镜头`, key: 'image-queue' })

    for (const scene of nextScenes) {
      nextScenes = nextScenes.map((item) =>
        item.scene_index === scene.scene_index
          ? { ...item, image_status: 'generating' as GenerationStatus, generation_error: undefined }
          : item
      )
      setScenes(nextScenes, project.analysis)

      try {
        const res = await apiClient.post('/api/generate/image', {
          prompt: scene.prompt,
          scene_index: scene.scene_index,
          image_provider: toBackendImageProvider(imageSettings),
          visual_lock: toBackendVisualLock(project.visualLock),
        })

        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? {
                ...item,
                image_url: res.data.image_url,
                image_status: 'done' as GenerationStatus,
                generation_error: undefined,
                video_url: undefined,
                video_status: 'idle' as GenerationStatus,
                video_error: undefined,
              }
            : item
        )
      } catch (error) {
        failedCount += 1
        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? {
                ...item,
                image_status: 'error' as GenerationStatus,
                generation_error: getErrorMessage(error),
              }
            : item
        )
      }

      setScenes(nextScenes, project.analysis)
    }

    setImageQueueRunning(false)
    if (failedCount > 0) {
      message.warning({ content: `关键帧队列完成，${failedCount} 个镜头生成失败，可单独重试`, key: 'image-queue' })
    } else {
      message.success({ content: '关键帧队列生成完成', key: 'image-queue' })
    }
  }

  const runKeyframeQueue = async (mode: 'all' | 'failed' = 'all') => {
    if (project.scenes.length === 0) {
      message.warning('请先生成智能分镜')
      return
    }

    const targetIndexes = new Set(
      project.scenes
        .filter((scene) => mode === 'all' || scene.image_status === 'error')
        .map((scene) => scene.scene_index)
    )

    if (targetIndexes.size === 0) {
      message.info(mode === 'failed' ? '没有失败的关键帧需要重试' : '没有可生成的关键帧')
      return
    }

    const targetedScenes = project.scenes.filter((scene) => targetIndexes.has(scene.scene_index))
    const requiredCharacterIdsForEstimate = Array.from(new Set(
      targetedScenes.map((scene) => scene.character_id).filter((value): value is string => Boolean(value))
    ))
    const characterReferenceJobs = requiredCharacterIdsForEstimate.reduce((total, characterId) => {
      const character = project.analysis?.characters?.[characterId]
      if (!character) return total
      const identityJobs = character.identity_anchor_image || character.anchor_image ? 0 : 1
      const stageIds = Array.from(new Set(
        targetedScenes
          .filter((scene) => scene.character_id === characterId)
          .map((scene) => scene.character_stage_id || 'default')
      ))
      const stageJobs = stageIds.filter((stageId) => !character.stages?.[stageId]?.anchor_image).length
      return total + identityJobs + stageJobs
    }, 0)
    const requiredLocationIds = Array.from(new Set(
      targetedScenes.map((scene) => scene.location_id).filter((value): value is string => Boolean(value))
    ))
    const requiredPropIds = Array.from(new Set(
      targetedScenes.flatMap((scene) => scene.hero_prop_ids ?? [])
    ))
    const environmentReferenceJobs = requiredLocationIds.filter(
      (id) => !project.visualBible?.locations?.[id]?.anchor_image
    ).length + requiredPropIds.filter(
      (id) => !project.visualBible?.hero_props?.[id]?.anchor_image
    ).length

    if (!['placeholder', 'pollinations'].includes(imageSettings.provider)) {
      const confirmed = await confirmPaidImageQueue(
        targetIndexes.size,
        characterReferenceJobs + environmentReferenceJobs
      )
      if (!confirmed) return
    }

    imageQueueCancelRef.current = false
    setProject({
      generationPolicy: {
        ...project.generationPolicy,
        test_approved: false,
        provider_locked: false,
        test_scene_indexes: [],
        image_provider: imageSettings.provider,
        image_model: imageSettings.model,
        video_provider: videoSettings.provider,
        video_model: videoSettings.model,
        style_fingerprint: project.visualBible?.fingerprint,
      },
    })
    setImageQueueRunning(true)
    let failedCount = 0
    let nextAnalysis = project.analysis
      ? { ...project.analysis, characters: { ...(project.analysis.characters ?? {}) } }
      : undefined
    let nextVisualBible = project.visualBible
      ? {
          ...project.visualBible,
          locations: { ...(project.visualBible.locations ?? {}) },
          hero_props: { ...(project.visualBible.hero_props ?? {}) },
        }
      : undefined
    let nextScenes: Scene[] = reindexScenes([...project.scenes]).map((scene) =>
      targetIndexes.has(scene.scene_index)
        ? { ...scene, image_status: 'queued' as GenerationStatus, generation_error: undefined }
        : scene
    )

    const requiredCharacterIds = Array.from(new Set(
      nextScenes
        .filter((scene) => targetIndexes.has(scene.scene_index) && scene.character_id)
        .map((scene) => scene.character_id as string)
    ))
    for (const characterId of requiredCharacterIds) {
      let character = nextAnalysis?.characters?.[characterId]
      if (!character) continue
      try {
        let identityAnchor = character.identity_anchor_image || character.anchor_image || ''
        if (!identityAnchor) {
          const identityResponse = await apiClient.post('/api/generate/image', {
            prompt: character.identity_prompt || character.anchor_prompt,
            scene_index: -1000,
            character_id: characterId,
            reference_images: (nextVisualBible?.reference_images ?? []).slice(0, 1),
            image_provider: toBackendImageProvider(imageSettings),
            visual_lock: toBackendVisualLock(project.visualLock),
          })
          identityAnchor = identityResponse.data.image_url
          character = {
            ...character,
            identity_anchor_image: identityAnchor,
            anchor_image: identityAnchor,
          }
          addProjectAsset({
            type: 'image',
            title: `身份母版 · ${character.name || characterId}`,
            url: identityAnchor,
            prompt: character.identity_prompt || character.anchor_prompt,
            provider: imageSettings.provider,
            model: imageSettings.model,
            source: 'queue',
          })
        }

        const requiredStageIds = Array.from(new Set(
          nextScenes
            .filter((scene) => scene.character_id === characterId && targetIndexes.has(scene.scene_index))
            .map((scene) => scene.character_stage_id || 'default')
        ))
        const stages = { ...(character.stages ?? {}) }
        for (const stageId of requiredStageIds) {
          const stage = stages[stageId] || {
            id: stageId,
            name: stageId === 'default' ? '默认阶段' : stageId,
            anchor_prompt: character.anchor_prompt,
            version: 1,
          }
          if (stage.anchor_image) continue
          const stageResponse = await apiClient.post('/api/generate/image', {
            prompt: `${stage.anchor_prompt}. Preserve the exact identity and facial construction from the identity reference.`,
            scene_index: -1100 - requiredStageIds.indexOf(stageId),
            character_id: `${characterId}:${stageId}`,
            anchor_image: identityAnchor,
            reference_images: [identityAnchor, ...(nextVisualBible?.reference_images ?? []).slice(0, 1)],
            image_provider: toBackendImageProvider(imageSettings),
            visual_lock: toBackendVisualLock(project.visualLock),
          })
          stages[stageId] = { ...stage, anchor_image: stageResponse.data.image_url }
          addProjectAsset({
            type: 'image',
            title: `阶段定妆 · ${character.name || characterId} · ${stage.name}`,
            url: stageResponse.data.image_url,
            prompt: stage.anchor_prompt,
            provider: imageSettings.provider,
            model: imageSettings.model,
            source: 'queue',
          })
        }
        character = { ...character, stages }
        nextAnalysis = {
          ...nextAnalysis!,
          characters: {
            ...nextAnalysis!.characters,
            [characterId]: character,
          },
        }
      } catch (error) {
        setImageQueueRunning(false)
        message.error(`角色身份或阶段定妆生成失败：${getErrorMessage(error)}`)
        return
      }
    }

    const visualReferenceImages = nextVisualBible?.reference_images ?? []
    try {
      for (const locationId of requiredLocationIds) {
        const location = nextVisualBible?.locations?.[locationId]
        if (!location || location.anchor_image) continue
        const response = await apiClient.post('/api/generate/image', {
          prompt: `Environment reference sheet for ${location.name}. ${location.description}. No people, no text. Preserve the project visual bible, architecture, geography, palette and lighting for later scene consistency.`,
          scene_index: -2000 - requiredLocationIds.indexOf(locationId),
          reference_images: visualReferenceImages.slice(0, 1),
          image_provider: toBackendImageProvider(imageSettings),
          visual_lock: toBackendVisualLock(project.visualLock),
        })
        nextVisualBible = {
          ...nextVisualBible!,
          locations: {
            ...nextVisualBible!.locations,
            [locationId]: { ...location, anchor_image: response.data.image_url },
          },
        }
        addProjectAsset({
          type: 'image',
          title: `地点参考 · ${location.name}`,
          url: response.data.image_url,
          prompt: location.description,
          provider: imageSettings.provider,
          model: imageSettings.model,
          source: 'queue',
        })
      }

      for (const propId of requiredPropIds) {
        const prop = nextVisualBible?.hero_props?.[propId]
        if (!prop || prop.anchor_image) continue
        const response = await apiClient.post('/api/generate/image', {
          prompt: `Hero prop reference sheet for ${prop.name}. ${prop.description}. Isolated object, consistent structure and recognizable construction, no people, no text. Preserve the project visual bible and allow only story-appropriate age or wear changes.`,
          scene_index: -3000 - requiredPropIds.indexOf(propId),
          reference_images: visualReferenceImages.slice(0, 1),
          image_provider: toBackendImageProvider(imageSettings),
          visual_lock: toBackendVisualLock(project.visualLock),
        })
        nextVisualBible = {
          ...nextVisualBible!,
          hero_props: {
            ...nextVisualBible!.hero_props,
            [propId]: { ...prop, anchor_image: response.data.image_url },
          },
        }
        addProjectAsset({
          type: 'image',
          title: `道具参考 · ${prop.name}`,
          url: response.data.image_url,
          prompt: prop.description,
          provider: imageSettings.provider,
          model: imageSettings.model,
          source: 'queue',
        })
      }
    } catch (error) {
      setImageQueueRunning(false)
      message.error(`地点或道具参考图生成失败：${getErrorMessage(error)}`)
      return
    }

    if (nextVisualBible) {
      nextAnalysis = nextAnalysis ? { ...nextAnalysis, visual_bible: nextVisualBible } : nextAnalysis
      setProject({ visualBible: nextVisualBible })
    }

    setScenes(nextScenes, nextAnalysis)
    message.loading({ content: `关键帧队列已开始，共 ${targetIndexes.size} 个镜头`, key: 'image-queue' })

    for (const scene of nextScenes.filter((item) => targetIndexes.has(item.scene_index))) {
      if (imageQueueCancelRef.current) {
        break
      }
      const sceneStartedAt = Date.now()

      nextScenes = nextScenes.map((item) =>
        item.scene_index === scene.scene_index
          ? { ...item, image_status: 'generating' as GenerationStatus, generation_error: undefined }
          : item
      )
      setScenes(nextScenes, nextAnalysis)

      try {
        const controller = new AbortController()
        imageQueueAbortRef.current = controller
        const character = scene.character_id ? nextAnalysis?.characters?.[scene.character_id] : undefined
        const stageAnchor = scene.character_stage_id
          ? character?.stages?.[scene.character_stage_id]?.anchor_image
          : character?.anchor_image
        const locationAnchor = scene.location_id
          ? nextVisualBible?.locations?.[scene.location_id]?.anchor_image
          : undefined
        const propAnchors = (scene.hero_prop_ids ?? [])
          .map((propId) => nextVisualBible?.hero_props?.[propId]?.anchor_image)
          .filter((value): value is string => Boolean(value))
        const styleReference = nextVisualBible?.reference_images?.[0]
        const referenceImages = [stageAnchor, styleReference, locationAnchor, ...propAnchors]
          .filter((value): value is string => Boolean(value))
          .slice(0, 4)
        const res = await apiClient.post('/api/generate/image', {
          prompt: scene.prompt,
          scene_index: scene.scene_index,
          character_id: scene.character_id || '',
          anchor_image: stageAnchor || '',
          reference_images: referenceImages,
          image_provider: toBackendImageProvider(imageSettings),
          visual_lock: toBackendVisualLock(project.visualLock),
        }, { signal: controller.signal })
        imageQueueAbortRef.current = null
        addGenerationLog({
          type: 'image',
          status: 'success',
          title: `关键帧 ${scene.scene_index + 1}`,
          provider: imageSettings.provider,
          model: imageSettings.model,
          sceneIndex: scene.scene_index,
          sceneTitle: scene.title,
          message: res.data.image_url ? '图片已生成并写入镜头' : '图片接口返回为空',
          durationMs: Date.now() - sceneStartedAt,
        })
        if (res.data.image_url) {
          recordSceneAsset(scene, 'image', {
            url: res.data.image_url,
            provider: imageSettings.provider,
            model: imageSettings.model,
            source: 'queue',
            title: `Generated keyframe ${scene.scene_index + 1}`,
          })
        }

        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? {
                ...item,
                image_url: res.data.image_url,
                first_frame: res.data.image_url,
                image_status: 'done' as GenerationStatus,
                generation_error: undefined,
                video_url: undefined,
                video_status: 'idle' as GenerationStatus,
                video_provider: undefined,
                video_model: undefined,
                provider_task_id: undefined,
                quality_status: 'pending',
                quality_errors: [],
                video_error: undefined,
              }
            : item
        )
      } catch (error) {
        imageQueueAbortRef.current = null

        if (imageQueueCancelRef.current) {
          addGenerationLog({
            type: 'image',
            status: 'canceled',
            title: `关键帧 ${scene.scene_index + 1}`,
            provider: imageSettings.provider,
            model: imageSettings.model,
            sceneIndex: scene.scene_index,
            sceneTitle: scene.title,
            message: '关键帧生成已取消',
            durationMs: Date.now() - sceneStartedAt,
          })
          nextScenes = nextScenes.map((item) =>
            item.scene_index === scene.scene_index || item.image_status === 'queued'
              ? { ...item, image_status: 'idle' as GenerationStatus, generation_error: undefined }
              : item
          )
          setScenes(nextScenes, nextAnalysis)
          break
        }

        failedCount += 1
        const errorMessage = getErrorMessage(error)
        addGenerationLog({
          type: 'image',
          status: 'error',
          title: `关键帧 ${scene.scene_index + 1}`,
          provider: imageSettings.provider,
          model: imageSettings.model,
          sceneIndex: scene.scene_index,
          sceneTitle: scene.title,
          error: errorMessage,
          durationMs: Date.now() - sceneStartedAt,
        })
        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? { ...item, image_status: 'error' as GenerationStatus, generation_error: errorMessage }
            : item
        )
      }

      setScenes(nextScenes, nextAnalysis)
    }

    nextScenes = nextScenes.map((scene, index) => {
      const following = nextScenes[index + 1]
      const continuityMatch = Boolean(
        following
        && (scene.transition || '').toLowerCase().includes('match')
        && scene.character_id === following.character_id
        && scene.character_stage_id === following.character_stage_id
        && scene.location_id === following.location_id
        && following.first_frame
      )
      return continuityMatch ? { ...scene, last_frame: following.first_frame } : scene
    })
    setScenes(nextScenes, nextAnalysis)

    const wasCanceled = imageQueueCancelRef.current
    imageQueueCancelRef.current = false
    imageQueueAbortRef.current = null

    if (wasCanceled) {
      nextScenes = nextScenes.map((item) =>
        item.image_status === 'queued'
          ? { ...item, image_status: 'idle' as GenerationStatus, generation_error: undefined }
          : item
      )
      setScenes(nextScenes, nextAnalysis)
    }

    setImageQueueRunning(false)
    if (wasCanceled) {
      message.info({ content: '关键帧队列已取消', key: 'image-queue' })
    } else if (failedCount > 0) {
      message.warning({ content: `关键帧队列完成，${failedCount} 个镜头失败，可重试失败项`, key: 'image-queue' })
    } else {
      message.success({ content: '关键帧队列生成完成', key: 'image-queue' })
    }
  }

  const handleRestoreCachedKeyframes = async () => {
    const missingScenes = project.scenes.filter((scene) => !scene.image_url)
    if (missingScenes.length === 0) {
      message.info('当前分镜没有缺失关键帧')
      return
    }

    setRestoringKeyframes(true)
    try {
      const response = await apiClient.post('/api/images/cache/restore', {
        scenes: missingScenes.map((scene) => {
          const character = scene.character_id ? project.analysis?.characters?.[scene.character_id] : undefined
          const stageAnchor = scene.character_stage_id
            ? character?.stages?.[scene.character_stage_id]?.anchor_image
            : character?.anchor_image
          const locationAnchor = scene.location_id
            ? project.visualBible?.locations?.[scene.location_id]?.anchor_image
            : undefined
          const propAnchors = (scene.hero_prop_ids ?? [])
            .map((propId) => project.visualBible?.hero_props?.[propId]?.anchor_image)
            .filter((value): value is string => Boolean(value))
          const styleReference = project.visualBible?.reference_images?.[0]
          const referenceImages = [stageAnchor, styleReference, locationAnchor, ...propAnchors]
            .filter((value): value is string => Boolean(value))
            .slice(0, 4)
          return {
            scene_index: scene.scene_index,
            prompt: scene.prompt,
            character_id: scene.character_id || '',
            anchor_image: stageAnchor || '',
            reference_images: referenceImages,
          }
        }),
        visual_lock: toBackendVisualLock(project.visualLock),
        allow_ordered_fallback: true,
      })

      const recoveredItems = Array.isArray(response.data.recovered) ? response.data.recovered : []
      const recoveredByIndex = new Map<number, string>(
        recoveredItems
          .filter((item: { scene_index?: unknown; image_url?: unknown }) =>
            typeof item.scene_index === 'number' && typeof item.image_url === 'string'
          )
          .map((item: { scene_index: number; image_url: string }) => [item.scene_index, item.image_url])
      )
      const nextScenes = project.scenes.map((scene) => {
        const imageUrl = recoveredByIndex.get(scene.scene_index)
        return imageUrl
          ? {
              ...scene,
              image_url: imageUrl,
              first_frame: imageUrl,
              image_status: 'done' as GenerationStatus,
              generation_status: 'done' as GenerationStatus,
              generation_error: undefined,
            }
          : scene
      })
      setScenes(nextScenes, project.analysis)

      const unmatchedCount = Array.isArray(response.data.unmatched_scene_indexes)
        ? response.data.unmatched_scene_indexes.length
        : Math.max(0, missingScenes.length - recoveredByIndex.size)
      if (recoveredByIndex.size === 0) {
        message.warning(`本地缓存有 ${response.data.cache_file_count || 0} 张图片，但没有找到可安全恢复的对应关系`)
      } else if (response.data.ordered_fallback_used) {
        message.warning(`已按原生成顺序恢复 ${recoveredByIndex.size} 张关键帧，请快速检查画面顺序后保存工程`)
      } else if (unmatchedCount > 0) {
        message.warning(`已精确恢复 ${recoveredByIndex.size} 张关键帧，仍有 ${unmatchedCount} 个镜头未匹配`)
      } else {
        message.success(`已从本地缓存精确恢复 ${recoveredByIndex.size} 张关键帧，请立即保存工程`)
      }
    } catch (error) {
      message.error(`恢复本地关键帧失败：${getErrorMessage(error)}`)
    } finally {
      setRestoringKeyframes(false)
    }
  }

  const handleGenerateVideoQueue = async () => {
    if (project.scenes.length === 0) {
      message.warning('请先生成智能分镜')
      return
    }

    if (videoSettings.provider === 'none') {
      message.warning('当前已关闭视频模型')
      return
    }

    setVideoQueueRunning(true)
    let failedCount = 0
    let nextScenes: Scene[] = reindexScenes([...project.scenes]).map((scene) => ({
      ...scene,
      video_status: 'queued' as GenerationStatus,
      video_error: undefined,
    }))

    setScenes(nextScenes, project.analysis)
    message.loading({ content: `视频队列已开始，共 ${nextScenes.length} 个镜头`, key: 'video-queue' })

    for (const scene of nextScenes) {
      nextScenes = nextScenes.map((item) =>
        item.scene_index === scene.scene_index
          ? { ...item, video_status: 'generating' as GenerationStatus, video_error: undefined }
          : item
      )
      setScenes(nextScenes, project.analysis)

      if (!scene.image_url) {
        failedCount += 1
        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? {
                ...item,
                video_status: 'error' as GenerationStatus,
                video_error: '缺少关键帧图片，请先生成关键帧',
              }
            : item
        )
        setScenes(nextScenes, project.analysis)
        continue
      }

      try {
        const res = await apiClient.post('/api/generate/video', {
          prompt: scene.video_prompt || scene.prompt,
          image_url: scene.image_url,
          scene_index: scene.scene_index,
          duration: Math.max(0.5, scene.end_time - scene.start_time),
          camera_motion: scene.camera_motion || '',
          video_provider: {
            provider: videoSettings.provider,
            model: videoSettings.model,
            api_key: videoSettings.apiKey,
            base_url: videoSettings.baseUrl,
            motion_strength: videoSettings.motionStrength,
            clip_seconds: videoSettings.clipSeconds,
          },
        })

        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? {
                ...item,
                video_url: res.data.video_url,
                video_status: 'done' as GenerationStatus,
                video_error: undefined,
              }
            : item
        )
      } catch (error) {
        failedCount += 1
        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? {
                ...item,
                video_status: 'error' as GenerationStatus,
                video_error: getErrorMessage(error),
              }
            : item
        )
      }

      setScenes(nextScenes, project.analysis)
    }

    setVideoQueueRunning(false)
    if (failedCount > 0) {
      message.warning({ content: `视频队列完成，${failedCount} 个镜头失败`, key: 'video-queue' })
    } else {
      message.success({ content: '视频队列已完成', key: 'video-queue' })
    }
  }

  const openTestApprovalModal = (
    sceneIndexes: number[] = project.generationPolicy.test_scene_indexes,
    sourceScenes: Scene[] = project.scenes
  ) => {
    const uniqueIndexes = Array.from(new Set(sceneIndexes))
    if (uniqueIndexes.length === 0) {
      message.warning('请先生成三镜测试')
      return
    }

    const indexSet = new Set(uniqueIndexes)
    const scenesToReview = sourceScenes.filter((scene) => indexSet.has(scene.scene_index))
    const failedScenes = scenesToReview.filter((scene) => scene.quality_status === 'rejected')
    const incompleteScenes = scenesToReview.filter(
      (scene) => scene.video_status !== 'done' || !scene.video_url
    )

    if (scenesToReview.length !== uniqueIndexes.length || incompleteScenes.length > 0) {
      message.warning('三镜测试尚未全部生成完成，请等待完成或重试失败视频')
      return
    }
    if (failedScenes.length > 0) {
      message.warning('三镜测试中有质检失败的视频，请先重试失败视频')
      return
    }

    Modal.confirm({
      title: '确认三镜测试',
      content: '请确认你已依次点击三个测试镜头并在右侧完整播放，人物近景、全身动作、环境镜头、画风和关键道具均可接受。确认后将锁定当前图片模型、视频模型和视觉圣经。',
      okText: '测试通过并锁定',
      cancelText: '继续检查',
      onOk: () => {
        setScenes(
          sourceScenes.map((scene) => indexSet.has(scene.scene_index)
            ? { ...scene, quality_status: 'approved' as const, quality_errors: [] }
            : scene
          ),
          project.analysis
        )
        setProject({
          generationPolicy: {
            ...project.generationPolicy,
            test_scene_indexes: uniqueIndexes,
            test_approved: true,
            provider_locked: true,
            image_provider: imageSettings.provider,
            image_model: imageSettings.model,
            video_provider: videoSettings.provider,
            video_model: videoSettings.model,
            style_fingerprint: project.visualBible?.fingerprint || project.analysis?.visual_bible?.fingerprint || '',
          },
        })
        message.success('三镜测试已确认并锁定，可以生成全部云端镜头')
      },
    })
  }

  const runVideoQueue = async (
    mode: 'all' | 'failed' = 'all',
    explicitIndexes?: number[],
    isTestBatch = false
  ) => {
    if (project.scenes.length === 0) {
      message.warning('请先生成智能分镜')
      return
    }

    if (['none', 'local_motion'].includes(videoSettings.provider)) {
      message.warning('全云端模式必须选择 Kling、Runway、Luma 或自定义云端视频模型')
      return
    }

    if (videoSettings.provider === 'kling') {
      const credentialError = validateKlingCredential(videoSettings.apiKey)
      if (credentialError) {
        message.error(credentialError)
        return
      }
    }

    const styleFingerprint = project.visualBible?.fingerprint || project.analysis?.visual_bible?.fingerprint || ''
    const currentLock = getProviderLock(
      imageSettings,
      videoSettings.provider,
      videoSettings.model,
      styleFingerprint
    )
    const policy = project.generationPolicy
    const savedLock = getProviderLock(
      {
        ...imageSettings,
        provider: (policy.image_provider || imageSettings.provider) as ImageGenerationSettings['provider'],
        model: policy.image_model || imageSettings.model,
      },
      policy.video_provider || videoSettings.provider,
      policy.video_model || videoSettings.model,
      policy.style_fingerprint
    )
    if (policy.provider_locked && savedLock !== currentLock) {
      message.error('项目已锁定生成模型或视觉圣经。请恢复原模型，或重新分镜建立新版本。')
      return
    }
    if (!isTestBatch && mode === 'all' && policy.require_test_batch && !policy.test_approved) {
      message.warning('请先生成并确认三镜测试，再批量生成全部云端镜头')
      return
    }

    const requestedTestIndexes = isTestBatch
      ? Array.from(new Set(explicitIndexes ?? getTestSceneIndexes(project.scenes)))
      : []
    const explicitIndexSet = explicitIndexes ? new Set(explicitIndexes) : null
    const targetIndexes = new Set(
      project.scenes
        .filter((scene) => !explicitIndexSet || explicitIndexSet.has(scene.scene_index))
        .filter((scene) => {
          if (mode === 'failed') return scene.video_status === 'error' || scene.quality_status === 'rejected'
          return !(
            scene.video_status === 'done'
            && scene.video_provider === videoSettings.provider
            && scene.video_model === videoSettings.model
            && scene.style_fingerprint === styleFingerprint
          )
        })
        .map((scene) => scene.scene_index)
    )

    if (targetIndexes.size === 0) {
      if (isTestBatch) {
        openTestApprovalModal(requestedTestIndexes)
      } else {
        message.info(mode === 'failed' ? '没有失败的视频片段需要重试' : '没有可生成的视频片段')
      }
      return
    }

    const targetSeconds = project.scenes
      .filter((scene) => targetIndexes.has(scene.scene_index))
      .reduce((total, scene) => total + Math.max(0.5, scene.end_time - scene.start_time), 0)
    const confirmed = await confirmPaidVideoQueue(targetIndexes.size, targetSeconds, isTestBatch)
    if (!confirmed) return

    videoQueueCancelRef.current = false
    setVideoQueueRunning(true)
    let failedCount = 0
    let nextScenes: Scene[] = reindexScenes([...project.scenes]).map((scene) =>
      targetIndexes.has(scene.scene_index)
        ? {
            ...scene,
            video_status: 'queued' as GenerationStatus,
            video_error: undefined,
            quality_status: 'pending' as const,
            quality_errors: [],
          }
        : scene
    )

    setProject({
      generationPolicy: {
        ...policy,
        test_scene_indexes: isTestBatch ? requestedTestIndexes : policy.test_scene_indexes,
        provider_locked: true,
        image_provider: imageSettings.provider,
        image_model: imageSettings.model,
        video_provider: videoSettings.provider,
        video_model: videoSettings.model,
        style_fingerprint: styleFingerprint,
      },
    })
    setScenes(nextScenes, project.analysis)
    message.loading({ content: `视频队列已开始，共 ${targetIndexes.size} 个镜头`, key: 'video-queue' })

    for (const scene of nextScenes.filter((item) => targetIndexes.has(item.scene_index))) {
      if (videoQueueCancelRef.current) {
        break
      }
      const sceneStartedAt = Date.now()

      nextScenes = nextScenes.map((item) =>
        item.scene_index === scene.scene_index
          ? { ...item, video_status: 'generating' as GenerationStatus, video_error: undefined }
          : item
      )
      setScenes(nextScenes, project.analysis)

      if (!scene.image_url) {
        failedCount += 1
        addGenerationLog({
          type: 'video',
          status: 'error',
          title: `视频片段 ${scene.scene_index + 1}`,
          provider: videoSettings.provider,
          model: videoSettings.model,
          sceneIndex: scene.scene_index,
          sceneTitle: scene.title,
          error: '缺少关键帧图片，请先生成关键帧',
          durationMs: Date.now() - sceneStartedAt,
        })
        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? { ...item, video_status: 'error' as GenerationStatus, video_error: '缺少关键帧图片，请先生成关键帧' }
            : item
        )
        setScenes(nextScenes, project.analysis)
        continue
      }

      try {
        const controller = new AbortController()
        videoQueueAbortRef.current = controller
        const res = await apiClient.post('/api/generate/video', {
          prompt: scene.video_prompt || scene.prompt,
          image_url: scene.image_url,
          scene_index: scene.scene_index,
          duration: Math.max(0.5, scene.end_time - scene.start_time),
          camera_motion: scene.camera_motion || '',
          last_frame_url: scene.last_frame || '',
          style_fingerprint: styleFingerprint,
          video_provider: {
            provider: videoSettings.provider,
            model: videoSettings.model,
            api_key: videoSettings.apiKey,
            base_url: videoSettings.baseUrl,
            motion_strength: videoSettings.motionStrength,
            clip_seconds: videoSettings.clipSeconds,
          },
        }, { signal: controller.signal })
        videoQueueAbortRef.current = null
        addGenerationLog({
          type: 'video',
          status: 'success',
          title: `视频片段 ${scene.scene_index + 1}`,
          provider: videoSettings.provider,
          model: videoSettings.model,
          sceneIndex: scene.scene_index,
          sceneTitle: scene.title,
          message: res.data.video_url ? '视频片段已生成' : '视频接口返回为空',
          durationMs: Date.now() - sceneStartedAt,
        })
        if (res.data.video_url) {
          recordSceneAsset(scene, 'video', {
            url: res.data.video_url,
            provider: videoSettings.provider,
            model: videoSettings.model,
            source: 'queue',
            title: `Generated video ${scene.scene_index + 1}`,
          })
        }

        if (res.data.quality_status === 'rejected') {
          failedCount += 1
          addGenerationLog({
            type: 'video',
            status: 'error',
            title: `自动质检 ${scene.scene_index + 1}`,
            provider: videoSettings.provider,
            model: videoSettings.model,
            sceneIndex: scene.scene_index,
            sceneTitle: scene.title,
            error: Array.isArray(res.data.quality_errors)
              ? res.data.quality_errors.join('；')
              : '自动质检未通过',
            durationMs: Date.now() - sceneStartedAt,
          })
        }

        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? {
                ...item,
                video_url: res.data.video_url,
                video_status: 'done' as GenerationStatus,
                rendered_duration: Number(res.data.rendered_duration || scene.end_time - scene.start_time),
                video_provider: videoSettings.provider,
                video_model: videoSettings.model,
                provider_task_id: res.data.task_id || '',
                style_fingerprint: styleFingerprint,
                quality_status: (res.data.quality_status || 'needs_review') as Scene['quality_status'],
                quality_errors: Array.isArray(res.data.quality_errors) ? res.data.quality_errors : [],
                video_error: undefined,
              }
            : item
        )
      } catch (error) {
        videoQueueAbortRef.current = null

        if (videoQueueCancelRef.current) {
          addGenerationLog({
            type: 'video',
            status: 'canceled',
            title: `视频片段 ${scene.scene_index + 1}`,
            provider: videoSettings.provider,
            model: videoSettings.model,
            sceneIndex: scene.scene_index,
            sceneTitle: scene.title,
            message: '视频片段生成已取消',
            durationMs: Date.now() - sceneStartedAt,
          })
          nextScenes = nextScenes.map((item) =>
            item.scene_index === scene.scene_index || item.video_status === 'queued'
              ? { ...item, video_status: 'idle' as GenerationStatus, video_error: undefined }
              : item
          )
          setScenes(nextScenes, project.analysis)
          break
        }

        failedCount += 1
        const errorMessage = getErrorMessage(error)
        addGenerationLog({
          type: 'video',
          status: 'error',
          title: `视频片段 ${scene.scene_index + 1}`,
          provider: videoSettings.provider,
          model: videoSettings.model,
          sceneIndex: scene.scene_index,
          sceneTitle: scene.title,
          error: errorMessage,
          durationMs: Date.now() - sceneStartedAt,
        })
        nextScenes = nextScenes.map((item) =>
          item.scene_index === scene.scene_index
            ? { ...item, video_status: 'error' as GenerationStatus, video_error: errorMessage }
            : item
        )
      }

      setScenes(nextScenes, project.analysis)
    }

    const wasCanceled = videoQueueCancelRef.current
    videoQueueCancelRef.current = false
    videoQueueAbortRef.current = null

    if (wasCanceled) {
      nextScenes = nextScenes.map((item) =>
        item.video_status === 'queued'
          ? { ...item, video_status: 'idle' as GenerationStatus, video_error: undefined }
          : item
      )
      setScenes(nextScenes, project.analysis)
    }

    setVideoQueueRunning(false)
    if (wasCanceled) {
      message.info({ content: '视频队列已取消', key: 'video-queue' })
    } else if (failedCount > 0) {
      message.warning({ content: `视频队列完成，${failedCount} 个镜头失败，可重试失败项`, key: 'video-queue' })
    } else if (isTestBatch) {
      const firstTestScene = nextScenes.find((scene) => requestedTestIndexes.includes(scene.scene_index))
      if (firstTestScene) {
        onSceneSelect(firstTestScene)
      }
      message.success({
        content: '三镜视频已就绪，请逐个播放检查后点击“确认三镜测试”',
        key: 'video-queue',
      })
    } else {
      message.success({ content: '视频队列已完成', key: 'video-queue' })
    }
  }

  const regenerateScene = async (scene: Scene, e: React.MouseEvent) => {
    e.stopPropagation()
    const sceneStartedAt = Date.now()
    const markScene = (patch: Partial<Scene>) => {
      const updated = project.scenes.map((s) =>
        s.scene_index === scene.scene_index
          ? { ...s, ...patch }
          : s
      )
      setScenes(updated, project.analysis)
    }

    markScene({ image_status: 'generating', generation_error: undefined })

    try {
      const res = await apiClient.post('/api/generate/image', {
          prompt: scene.prompt,
          scene_index: scene.scene_index,
          image_provider: toBackendImageProvider(imageSettings),
          visual_lock: toBackendVisualLock(project.visualLock),
        })
      addGenerationLog({
        type: 'image',
        status: 'success',
        title: `重新生成关键帧 ${scene.scene_index + 1}`,
        provider: imageSettings.provider,
        model: imageSettings.model,
        sceneIndex: scene.scene_index,
        sceneTitle: scene.title,
        message: res.data.image_url ? '场景图片已更新' : '图片接口返回为空',
        durationMs: Date.now() - sceneStartedAt,
      })
      if (res.data.image_url) {
        recordSceneAsset(scene, 'image', {
          url: res.data.image_url,
          provider: imageSettings.provider,
          model: imageSettings.model,
          source: 'manual',
          title: `Regenerated keyframe ${scene.scene_index + 1}`,
        })
      }
      const updated = project.scenes.map((s) =>
        s.scene_index === scene.scene_index
          ? {
              ...s,
              image_url: res.data.image_url,
              first_frame: res.data.image_url,
              image_status: 'done' as GenerationStatus,
              generation_error: undefined,
              video_url: undefined,
              video_status: 'idle' as GenerationStatus,
              video_provider: undefined,
              video_model: undefined,
              provider_task_id: undefined,
              quality_status: 'pending' as const,
              quality_errors: [],
              video_error: undefined,
            }
          : s
      )
      setScenes(updated, project.analysis)
      setProject({
        generationPolicy: {
          ...project.generationPolicy,
          test_approved: false,
          provider_locked: false,
          test_scene_indexes: [],
        },
      })
      message.success('场景图片已更新')
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      addGenerationLog({
        type: 'image',
        status: 'error',
        title: `重新生成关键帧 ${scene.scene_index + 1}`,
        provider: imageSettings.provider,
        model: imageSettings.model,
        sceneIndex: scene.scene_index,
        sceneTitle: scene.title,
        error: errorMessage,
        durationMs: Date.now() - sceneStartedAt,
      })
      markScene({
        image_status: 'error',
        generation_error: errorMessage,
      })
      message.error('重新生成失败')
    }
  }

  const approveAllVideoQuality = () => {
    const incomplete = project.scenes.filter(
      (scene) => scene.video_status !== 'done' || !scene.video_url || scene.quality_status === 'rejected'
    )
    if (incomplete.length > 0) {
      message.warning(`仍有 ${incomplete.length} 个镜头未完成或质检失败，不能整体确认`)
      return
    }
    Modal.confirm({
      title: '确认一致性接触表',
      content: `请确认已检查 ${project.scenes.length} 个镜头中的人物身份与人生阶段、服装、地点、关键道具、肢体和画风连续性。确认后这些镜头将允许进入正式导出。`,
      okText: '接触表确认通过',
      cancelText: '继续检查',
      onOk: () => {
        setScenes(
          project.scenes.map((scene) => ({
            ...scene,
            quality_status: 'approved' as const,
            quality_errors: [],
          })),
          project.analysis
        )
        message.success('全部云端镜头已人工确认通过，可以正式导出')
      },
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 头部 */}
      <div
        style={{
          padding: '12px 18px',
          borderBottom: '1px solid var(--app-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'var(--app-bg)',
        }}
      >
        <Space>
          <Title level={5} className="section-title">
            智能分镜
          </Title>
          {project.scenes.length > 0 && (
            <Tag style={{ background: `${accent}22`, border: `1px solid ${accent}55`, color: accent, fontSize: 11 }}>
              {project.scenes.length} 个镜头
            </Tag>
          )}
        </Space>

        <Space size={8}>
        <Button
          size="small"
          icon={<LockOutlined />}
          onClick={() => setVisualLockDrawerOpen(true)}
          type={project.visualLock?.enabled ? 'primary' : 'default'}
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          视觉设定{project.visualLock?.enabled ? ' 已锁定' : ''}
        </Button>
        <Button
          size="small"
          icon={<AppstoreOutlined />}
          onClick={() => {
            setAssetDrawerTab('contact-sheet')
            setAssetDrawerOpen(true)
          }}
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          一致性接触表
        </Button>
        <Button
          size="small"
          icon={<HistoryOutlined />}
          onClick={() => setLogDrawerOpen(true)}
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          任务历史{project.generationLogs?.length ? ` ${project.generationLogs.length}` : ''}
        </Button>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={handleRestoreCachedKeyframes}
          loading={isRestoringKeyframes}
          disabled={project.scenes.length === 0 || isGenerating || isImageQueueRunning || isVideoQueueRunning}
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          恢复本地关键帧
        </Button>
        <Button
          size="small"
          icon={isImageQueueRunning ? <StopOutlined /> : <ReloadOutlined />}
          danger={isImageQueueRunning}
          onClick={isImageQueueRunning ? handleCancelImageQueue : () => runKeyframeQueue('all')}
          disabled={project.scenes.length === 0 || isGenerating || isVideoQueueRunning}
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          {isImageQueueRunning ? '取消关键帧' : '生成全部关键帧'}
        </Button>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => runKeyframeQueue('failed')}
          disabled={project.scenes.length === 0 || isGenerating || isImageQueueRunning || isVideoQueueRunning}
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          重试失败关键帧
        </Button>
        <Button
          size="small"
          icon={<EyeOutlined />}
          onClick={() => runVideoQueue('all', getTestSceneIndexes(project.scenes), true)}
          disabled={
            project.scenes.length === 0
            || isGenerating
            || isImageQueueRunning
            || isVideoQueueRunning
            || project.generationPolicy.test_approved
            || areTestScenesReady
          }
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          {project.generationPolicy.test_approved
            ? '三镜测试已通过'
            : areTestScenesReady
              ? '三镜视频已就绪'
              : '生成三镜测试'}
        </Button>
        <Button
          size="small"
          icon={<CheckOutlined />}
          onClick={() => openTestApprovalModal()}
          disabled={
            project.generationPolicy.test_approved
            || !areTestScenesReady
            || isGenerating
            || isImageQueueRunning
            || isVideoQueueRunning
          }
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          {project.generationPolicy.test_approved ? '三镜测试已确认' : '确认三镜测试'}
        </Button>
        <Button
          size="small"
          icon={isVideoQueueRunning ? <StopOutlined /> : <VideoCameraOutlined />}
          danger={isVideoQueueRunning}
          onClick={isVideoQueueRunning ? handleCancelVideoQueue : () => runVideoQueue('all')}
          disabled={project.scenes.length === 0 || isGenerating || isImageQueueRunning}
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          {isVideoQueueRunning ? '取消视频' : '生成全部云端镜头'}
        </Button>
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => runVideoQueue('failed')}
          disabled={project.scenes.length === 0 || isGenerating || isImageQueueRunning || isVideoQueueRunning}
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          重试失败视频
        </Button>
        <Button
          size="small"
          icon={<CheckOutlined />}
          onClick={approveAllVideoQuality}
          disabled={project.scenes.length === 0 || isVideoQueueRunning || isImageQueueRunning}
          style={{ borderRadius: 6, fontSize: 12 }}
        >
          确认全部质检
        </Button>
        <Button
          type="primary"
          size="small"
          icon={<ThunderboltOutlined />}
          loading={isGenerating}
          onClick={handleGenerate}
          disabled={project.lyrics.filter((l) => !l.skip).length === 0 || isImageQueueRunning || isVideoQueueRunning}
          style={{
            background: isGenerating ? undefined : `linear-gradient(135deg, #7c3aed, #9d5ff5)`,
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {project.scenes.length > 0 ? '重新分镜' : '智能分镜'}
        </Button>
        </Space>
      </div>

      {/* 分析摘要 */}
      {generationEstimate.validLyrics > 0 && (
        <div
          style={{
            margin: '12px 12px 0',
            padding: '10px 14px',
            background: 'var(--app-surface)',
            border: '1px solid var(--app-border)',
            borderRadius: 8,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: 'var(--app-text-muted)', fontSize: 12 }}>
            生成预估
          </Text>
          <Tag style={{ margin: 0, borderRadius: 5 }}>
            {generationEstimate.validLyrics} 行有效歌词
          </Tag>
          <Tag color="blue" style={{ margin: 0, borderRadius: 5 }}>
            约 {generationEstimate.estimatedSceneCount} 个镜头
          </Tag>
          <Tag color="purple" style={{ margin: 0, borderRadius: 5 }}>
            {generationEstimate.imageProviderLabel} · {generationEstimate.imageJobs} 张图
          </Tag>
          <Tag color={videoSettings.provider === 'none' ? 'default' : 'cyan'} style={{ margin: 0, borderRadius: 5 }}>
            {generationEstimate.videoProviderLabel} · {generationEstimate.videoJobs} 段视频
          </Tag>
          <Tag color="gold" style={{ margin: 0, borderRadius: 5 }}>
            {generationEstimate.timeText}
          </Tag>
          <Tooltip title="这是按当前模型和镜头数量给出的保守估算；付费平台的实际价格以供应商账单为准。">
            <Tag color={generationEstimate.costText.includes('可能') ? 'orange' : 'green'} style={{ margin: 0, borderRadius: 5 }}>
              {generationEstimate.costText}
            </Tag>
          </Tooltip>
        </div>
      )}

      {project.analysis && (
        <div
          style={{
            margin: '12px 12px 0',
            padding: '10px 14px',
            background: 'var(--app-surface)',
            border: `1px solid ${accent}33`,
            borderRadius: 8,
          }}
        >
          <Text style={{ color: accent, fontSize: 12 }}>
            <InfoCircleOutlined style={{ marginRight: 6 }} />
            {project.analysis.summary}
          </Text>
        </div>
      )}

      {/* 场景列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {project.scenes.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <div style={{ textAlign: 'center' }}>
                  <Text style={{ color: '#475569', display: 'block', marginBottom: 8 }}>
                    点击「智能分镜」
                  </Text>
                  <Text style={{ color: '#374151', fontSize: 12 }}>
                    AI 会先理解全曲主题，再自动拆分镜头和生成画面
                  </Text>
                </div>
              }
            />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {project.scenes.map((scene) => (
              <div
                key={scene.scene_index}
                onClick={() => onSceneSelect(scene)}
                style={{
                  borderRadius: 10,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: selectedSceneIndex === scene.scene_index
                    ? `1px solid ${accent}88`
                    : '1px solid var(--app-border)',
                  transition: 'all 0.2s',
                  background: selectedSceneIndex === scene.scene_index
                    ? `${accent}11`
                    : 'var(--app-surface)',
                }}
              >
                {/* 场景图片 */}
                <div style={{ position: 'relative', aspectRatio: '16/9' }}>
                  {scene.image_url ? (
                    <img
                      src={scene.image_url}
                      alt={scene.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      background: 'var(--app-surface-raised)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ color: 'var(--app-text-subtle)', fontSize: 12 }}>等待生成</Text>
                    </div>
                  )}

                  {/* 时间标签 */}
                  <div style={{
                    position: 'absolute', top: 6, left: 6,
                    background: 'rgba(0,0,0,0.6)',
                    padding: '2px 8px', borderRadius: 6,
                    backdropFilter: 'blur(4px)',
                  }}>
                    <Text style={{ color: '#fff', fontSize: 10 }}>
                      {formatTime(scene.start_time)} → {formatTime(scene.end_time)}
                    </Text>
                  </div>

                  {/* 重新生成按钮 */}
                  <Tooltip title="重新生成此分镜">
                    <div
                      onClick={(e) => regenerateScene(scene, e)}
                      style={{
                        position: 'absolute', top: 6, right: 6,
                        width: 26, height: 26, borderRadius: 6,
                        background: 'rgba(0,0,0,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                        backdropFilter: 'blur(4px)',
                      }}
                    >
                      <ReloadOutlined style={{ fontSize: 11, color: '#fff' }} />
                    </div>
                  </Tooltip>

                  <Tooltip title="编辑镜头">
                    <div
                      onClick={(e) => handleOpenEdit(scene, e)}
                      style={{
                        position: 'absolute', top: 6, right: 38,
                        width: 26, height: 26, borderRadius: 6,
                        background: 'rgba(0,0,0,0.6)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                        backdropFilter: 'blur(4px)',
                      }}
                    >
                      <EditOutlined style={{ fontSize: 11, color: '#fff' }} />
                    </div>
                  </Tooltip>

                  {scene.scene_index < project.scenes.length - 1 && (
                    <Tooltip title="与下一镜头合并">
                      <div
                        onClick={(e) => handleMergeScene(scene, 'next', e)}
                        style={{
                          position: 'absolute', top: 6, right: 70,
                          width: 26, height: 26, borderRadius: 6,
                          background: 'rgba(0,0,0,0.6)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer',
                          backdropFilter: 'blur(4px)',
                        }}
                      >
                        <CompressOutlined style={{ fontSize: 11, color: '#fff' }} />
                      </div>
                    </Tooltip>
                  )}
                </div>

                {/* 场景信息 */}
                <div style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <Text style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>
                      {scene.title}
                    </Text>
                    <Tooltip title={scene.generation_error || '关键帧图片状态'}>
                      <Tag color={getStatusMeta(imageStatusMeta, scene.image_status).color} style={{ fontSize: 10, margin: 0 }}>
                        {getStatusMeta(imageStatusMeta, scene.image_status).label}
                      </Tag>
                    </Tooltip>
                    <Tooltip title={scene.video_error || '视频片段状态'}>
                      <Tag color={getStatusMeta(videoStatusMeta, scene.video_status).color} style={{ fontSize: 10, margin: 0 }}>
                        {getStatusMeta(videoStatusMeta, scene.video_status).label}
                      </Tag>
                    </Tooltip>
                    {scene.video_status === 'done' && (
                      <Tooltip title={(scene.quality_errors ?? []).join('；') || '视频质检状态'}>
                        <Tag
                          color={scene.quality_status === 'approved' ? 'success' : scene.quality_status === 'rejected' ? 'error' : 'warning'}
                          style={{ fontSize: 10, margin: 0 }}
                        >
                          {scene.quality_status === 'approved' ? '质检通过' : scene.quality_status === 'rejected' ? '质检失败' : '待人工确认'}
                        </Tag>
                      </Tooltip>
                    )}
                    <Tag style={{
                      fontSize: 10, margin: 0,
                      background: `${accent}22`,
                      border: `1px solid ${accent}44`,
                      color: accent,
                    }}>
                      {scene.lyric_ids.length} 行歌词
                    </Tag>
                  </div>
                  <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }} ellipsis>
                    {scene.description}
                  </Text>
                  {scene.character_id && (
                    <Text style={{ color: '#a78bfa', fontSize: 10, display: 'block', marginTop: 4 }} ellipsis>
                      {project.analysis?.characters?.[scene.character_id]?.name || scene.character_id}
                      {scene.character_stage_id
                        ? ` · ${project.analysis?.characters?.[scene.character_id]?.stages?.[scene.character_stage_id]?.name || scene.character_stage_id}`
                        : ''}
                    </Text>
                  )}
                  {scene.camera_motion && (
                    <Text style={{ color: '#6f7785', fontSize: 10, display: 'block', marginTop: 6 }} ellipsis>
                      {scene.shot_type} · {scene.camera_motion}
                    </Text>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Drawer
        title="视觉设定锁定"
        open={isVisualLockDrawerOpen}
        width={520}
        onClose={() => setVisualLockDrawerOpen(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setVisualLockDrawerOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleSaveVisualLock}>保存设定</Button>
          </div>
        }
      >
        <Form layout="vertical" form={visualLockForm} initialValues={{ enabled: false }}>
          <Form.Item
            label="启用视觉锁定"
            name="enabled"
            valuePropName="checked"
            extra="开启后，智能分镜和后续关键帧生成都会优先遵守这套设定。"
          >
            <Switch />
          </Form.Item>

          <Form.Item label="主角 / 核心主体" name="mainSubject">
            <Input.TextArea rows={2} placeholder="例如：一位白衣琵琶女子，清冷、克制，始终作为画面核心" />
          </Form.Item>

          <Form.Item label="跨阶段身份特征 / 服装变化规则" name="wardrobe">
            <Input.TextArea rows={2} placeholder="例如：固定凤眼、左眼下小痣和同一把花纹琵琶；年龄、发式和服装可随人生阶段变化" />
          </Form.Item>

          <Form.Item label="固定世界 / 场景" name="setting">
            <Input.TextArea rows={2} placeholder="例如：秋夜江面、古船、月光、远山薄雾，保持唐风古典世界" />
          </Form.Item>

          <Form.Item label="色调 / 光线" name="palette">
            <Input.TextArea rows={2} placeholder="例如：冷月白、墨青、暗金点缀，柔和低饱和电影光" />
          </Form.Item>

          <Form.Item label="反复出现的视觉意象" name="symbols">
            <Input.TextArea rows={2} placeholder="例如：琵琶、江月、枫叶、灯火、细雨、水纹" />
          </Form.Item>

          <Form.Item label="禁止项" name="negativePrompt">
            <Input.TextArea rows={3} placeholder="例如：现代服饰、赛博城市、文字、水印、卡通低幼、角色频繁变脸" />
          </Form.Item>
        </Form>
      </Drawer>

      <Drawer
        title="一致性接触表与项目素材"
        open={isAssetDrawerOpen}
        width={760}
        onClose={() => setAssetDrawerOpen(false)}
        extra={
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={projectAssets.length === 0}
            onClick={clearProjectAssets}
          >
            清空
          </Button>
        }
      >
        <Tabs
          activeKey={assetDrawerTab}
          onChange={setAssetDrawerTab}
          items={[
            {
              key: 'contact-sheet',
              label: `接触表 ${project.scenes.length}`,
              children: project.scenes.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                  {project.scenes.map((scene) => (
                    <div
                      key={`contact-${scene.scene_index}`}
                      onClick={() => {
                        onSceneSelect(scene)
                        setAssetDrawerOpen(false)
                      }}
                      style={{
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: 'var(--app-surface)',
                        border: scene.quality_status === 'rejected'
                          ? '1px solid #ff4d4f'
                          : '1px solid var(--app-border)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ aspectRatio: '16/9', background: 'var(--app-surface-raised)' }}>
                        {scene.image_url ? (
                          <img
                            src={scene.image_url}
                            alt={scene.title}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        ) : (
                          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Text type="secondary">无关键帧</Text>
                          </div>
                        )}
                      </div>
                      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <Text style={{ color: 'var(--app-text)', fontSize: 13, fontWeight: 600 }} ellipsis>
                          镜头 {scene.scene_index + 1} · {scene.title}
                        </Text>
                        <Space size={4} wrap>
                          <Tag style={{ margin: 0 }}>{scene.character_id || '无人物'}</Tag>
                          {scene.character_stage_id && <Tag color="purple" style={{ margin: 0 }}>{scene.character_stage_id}</Tag>}
                          {scene.location_id && <Tag color="blue" style={{ margin: 0 }}>{scene.location_id}</Tag>}
                          {(scene.hero_prop_ids ?? []).map((propId) => (
                            <Tag color="gold" key={propId} style={{ margin: 0 }}>{propId}</Tag>
                          ))}
                        </Space>
                        <Tag
                          color={scene.quality_status === 'approved' ? 'green' : scene.quality_status === 'rejected' ? 'red' : 'orange'}
                          style={{ margin: 0, width: 'fit-content' }}
                        >
                          {scene.quality_status || 'pending'}
                        </Tag>
                        {scene.quality_errors?.length ? (
                          <Text type="danger" style={{ fontSize: 11 }}>{scene.quality_errors.join('；')}</Text>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无镜头" />
              ),
            },
            {
              key: 'images',
              label: `图片 ${imageAssets.length}`,
              children: imageAssets.length ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                  {imageAssets.map((asset) => (
                    <div
                      key={asset.id}
                      style={{
                        borderRadius: 8,
                        overflow: 'hidden',
                        background: 'var(--app-surface)',
                        border: '1px solid var(--app-border)',
                      }}
                    >
                      {asset.url && (
                        <div style={{ aspectRatio: '16/9', background: 'var(--app-surface-raised)' }}>
                          <img
                            src={asset.url}
                            alt={asset.title}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          />
                        </div>
                      )}
                      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Text style={{ color: 'var(--app-text)', fontSize: 13, fontWeight: 600 }} ellipsis>
                          {asset.title}
                        </Text>
                        <Space size={6} wrap>
                          <Tag style={{ margin: 0 }}>{assetTypeLabel[asset.type]}</Tag>
                          {typeof asset.sceneIndex === 'number' && <Tag style={{ margin: 0 }}>镜头 {asset.sceneIndex + 1}</Tag>}
                          {asset.provider && <Tag style={{ margin: 0 }}>{asset.provider}</Tag>}
                        </Space>
                        <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
                          {formatLogTime(asset.createdAt)}
                        </Text>
                        <Space size={6} wrap>
                          <Button size="small" icon={<EyeOutlined />} onClick={() => handleFocusAssetScene(asset)}>
                            定位
                          </Button>
                          <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(asset.prompt)}>
                            Prompt
                          </Button>
                          <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(asset.url)}>
                            URL
                          </Button>
                        </Space>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无图片素材" />
              ),
            },
            {
              key: 'videos',
              label: `视频 ${videoAssets.length}`,
              children: videoAssets.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {videoAssets.map((asset) => (
                    <div
                      key={asset.id}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'var(--app-surface)',
                        border: '1px solid var(--app-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <Text style={{ color: 'var(--app-text)', fontSize: 13, fontWeight: 600 }}>
                          {asset.title}
                        </Text>
                        <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
                          {formatLogTime(asset.createdAt)}
                        </Text>
                      </div>
                      <Space size={6} wrap>
                        {typeof asset.sceneIndex === 'number' && <Tag style={{ margin: 0 }}>镜头 {asset.sceneIndex + 1}</Tag>}
                        {asset.provider && <Tag style={{ margin: 0 }}>{asset.provider}</Tag>}
                        {asset.model && <Tag style={{ margin: 0 }}>{asset.model}</Tag>}
                      </Space>
                      {asset.url && (
                        <Text style={{ color: 'var(--app-text-subtle)', fontSize: 12 }} ellipsis>
                          {asset.url}
                        </Text>
                      )}
                      <Space size={6} wrap>
                        <Button size="small" icon={<EyeOutlined />} onClick={() => handleFocusAssetScene(asset)}>
                          定位
                        </Button>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(asset.videoPrompt || asset.prompt)}>
                          Prompt
                        </Button>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(asset.url)}>
                          URL
                        </Button>
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无视频素材" />
              ),
            },
            {
              key: 'prompts',
              label: `Prompt ${promptAssets.length}`,
              children: promptAssets.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {promptAssets.map((asset) => (
                    <div
                      key={`prompt-${asset.id}`}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        background: 'var(--app-surface)',
                        border: '1px solid var(--app-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <Space size={6} wrap>
                        <Tag style={{ margin: 0 }}>{asset.sceneTitle || asset.title}</Tag>
                        {typeof asset.sceneIndex === 'number' && <Tag style={{ margin: 0 }}>镜头 {asset.sceneIndex + 1}</Tag>}
                        {asset.provider && <Tag style={{ margin: 0 }}>{asset.provider}</Tag>}
                      </Space>
                      {asset.prompt && (
                        <Input.TextArea value={asset.prompt} rows={4} readOnly />
                      )}
                      {asset.videoPrompt && (
                        <Input.TextArea value={asset.videoPrompt} rows={3} readOnly />
                      )}
                      <Space size={6} wrap>
                        <Button size="small" icon={<EyeOutlined />} onClick={() => handleFocusAssetScene(asset)}>
                          定位
                        </Button>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(asset.prompt)}>
                          复制图片 Prompt
                        </Button>
                        <Button size="small" icon={<CopyOutlined />} onClick={() => copyToClipboard(asset.videoPrompt)}>
                          复制视频 Prompt
                        </Button>
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Prompt 版本" />
              ),
            },
          ]}
        />
      </Drawer>

      <Drawer
        title="任务历史"
        open={isLogDrawerOpen}
        width={560}
        onClose={() => setLogDrawerOpen(false)}
        extra={
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!project.generationLogs?.length}
            onClick={clearGenerationLogs}
          >
            清空
          </Button>
        }
      >
        {project.generationLogs?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {project.generationLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: 'var(--app-surface)',
                  border: '1px solid var(--app-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <Space size={6} wrap>
                    <Tag color={logStatusMeta[log.status].color} style={{ margin: 0 }}>
                      {logStatusMeta[log.status].label}
                    </Tag>
                    <Tag style={{ margin: 0 }}>{logTypeLabel[log.type]}</Tag>
                    {typeof log.sceneIndex === 'number' && (
                      <Tag style={{ margin: 0 }}>镜头 {log.sceneIndex + 1}</Tag>
                    )}
                  </Space>
                  <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
                    {formatLogTime(log.createdAt)}
                  </Text>
                </div>

                <div>
                  <Text style={{ color: 'var(--app-text)', fontSize: 13, fontWeight: 600 }}>
                    {log.title}
                  </Text>
                  {log.sceneTitle && (
                    <Text style={{ color: 'var(--app-text-subtle)', fontSize: 12, display: 'block', marginTop: 2 }}>
                      {log.sceneTitle}
                    </Text>
                  )}
                </div>

                <Space size={8} wrap>
                  {log.provider && (
                    <Text style={{ color: 'var(--app-text-muted)', fontSize: 12 }}>
                      模型：{log.provider}{log.model ? ` / ${log.model}` : ''}
                    </Text>
                  )}
                  {log.durationMs !== undefined && (
                    <Text style={{ color: 'var(--app-text-muted)', fontSize: 12 }}>
                      耗时：{formatDurationMs(log.durationMs)}
                    </Text>
                  )}
                </Space>

                {log.message && (
                  <Text style={{ color: 'var(--app-text-muted)', fontSize: 12, lineHeight: 1.6 }}>
                    {log.message}
                  </Text>
                )}
                {log.error && (
                  <Text style={{ color: '#fca5a5', fontSize: 12, lineHeight: 1.6 }}>
                    {log.error}
                  </Text>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无生成记录" />
        )}
      </Drawer>

      <Drawer
        title="编辑镜头"
        open={Boolean(editingScene)}
        width={520}
        onClose={() => setEditingSceneIndex(null)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setEditingSceneIndex(null)}>取消</Button>
            <Button type="primary" onClick={handleSaveSceneEdit}>保存镜头</Button>
          </div>
        }
      >
        {editingScene && (
          <Form layout="vertical" form={editForm}>
            <Form.Item label="镜头标题" name="title" rules={[{ required: true, message: '请输入镜头标题' }]}>
              <Input />
            </Form.Item>

            <Form.Item label="歌词 / 镜头描述" name="description" rules={[{ required: true, message: '请输入镜头描述' }]}>
              <Input.TextArea rows={3} />
            </Form.Item>

            <Space size={10} style={{ width: '100%' }} align="start">
              <Form.Item label="情绪" name="mood" style={{ flex: 1 }}>
                <Input placeholder="calm cinematic opening" />
              </Form.Item>
              <Form.Item label="转场" name="transition" style={{ flex: 1 }}>
                <Select options={transitionOptions} />
              </Form.Item>
            </Space>

            <Space size={10} style={{ width: '100%' }} align="start">
              <Form.Item label="主要角色" name="character_id" style={{ flex: 1 }}>
                <Select
                  allowClear
                  options={Object.entries(project.analysis?.characters ?? {}).map(([id, character]) => ({
                    value: id,
                    label: character.name || id,
                  }))}
                  onChange={(characterId) => {
                    const firstStageId = Object.keys(project.analysis?.characters?.[characterId]?.stages ?? {})[0]
                    editForm.setFieldValue('character_stage_id', firstStageId)
                  }}
                />
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(prev, next) => prev.character_id !== next.character_id}>
                {({ getFieldValue }) => {
                  const characterId = getFieldValue('character_id') as string | undefined
                  return (
                    <Form.Item label="人生阶段" name="character_stage_id" style={{ minWidth: 180 }}>
                      <Select
                        allowClear
                        options={Object.entries(project.analysis?.characters?.[characterId || '']?.stages ?? {}).map(([id, stage]) => ({
                          value: id,
                          label: `${stage.name || id}${stage.age_range ? ` · ${stage.age_range}` : ''}`,
                        }))}
                      />
                    </Form.Item>
                  )
                }}
              </Form.Item>
            </Space>

            <Form.Item label="视觉母题" name="visual">
              <Input.TextArea rows={2} placeholder="例如：月下江面、琵琶弦、飞花、孤舟" />
            </Form.Item>

            <Space size={10} style={{ width: '100%' }} align="start">
              <Form.Item label="镜头类型" name="shot_type" style={{ flex: 1 }}>
                <Select options={shotTypeOptions} />
              </Form.Item>
              <Form.Item label="镜头运动" name="camera_motion" style={{ flex: 1 }}>
                <Select options={cameraMotionOptions} />
              </Form.Item>
            </Space>

            <Form.Item
              label="图片 Prompt"
              name="prompt"
              rules={[{ required: true, message: '请输入图片 Prompt' }]}
              extra="用于重新生成关键帧图片。"
            >
              <Input.TextArea rows={6} />
            </Form.Item>

            <Form.Item
              label="视频 Prompt"
              name="video_prompt"
              extra="后续接入 Kling / Runway / Luma 时使用；本地动态导出也会参考镜头运动。"
            >
              <Input.TextArea rows={4} />
            </Form.Item>

            <Form.Item label="图片 URL" name="image_url">
              <Input />
            </Form.Item>

            <div
              className="glass-card"
              style={{
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <Text style={{ color: 'var(--app-text-muted)', fontSize: 12 }}>
                时间段：{formatTime(editingScene.start_time)} → {formatTime(editingScene.end_time)}
              </Text>
              <Text style={{ color: 'var(--app-text-muted)', fontSize: 12 }}>
                包含歌词：{editingScene.lyric_ids.length} 行
              </Text>
              <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
                合并或拆分后会自动重排镜头序号，并同步歌词映射。
              </Text>
            </div>

            <div
              className="glass-card"
              style={{
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                marginTop: 12,
              }}
            >
              <Text style={{ color: 'var(--app-text)', fontSize: 13, fontWeight: 600 }}>
                镜头结构
              </Text>

              <Space size={8}>
                <Button
                  icon={<CompressOutlined />}
                  onClick={() => handleMergeScene(editingScene, 'previous')}
                  disabled={editingScene.scene_index === 0}
                >
                  合并上一镜头
                </Button>
                <Button
                  icon={<CompressOutlined />}
                  onClick={() => handleMergeScene(editingScene, 'next')}
                  disabled={editingScene.scene_index >= project.scenes.length - 1}
                >
                  合并下一镜头
                </Button>
              </Space>

              <div>
                <Text style={{ color: 'var(--app-text-muted)', fontSize: 12, display: 'block', marginBottom: 6 }}>
                  拆分位置
                </Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    value={splitAfterLyricId}
                    onChange={setSplitAfterLyricId}
                    disabled={editingScene.lyric_ids.length <= 1}
                    options={editingScene.lyric_ids.slice(0, -1).map((id, index) => {
                      const lyric = project.lyrics.find((line) => line.id === id)
                      return {
                        value: id,
                        label: `第 ${index + 1} 行后：${lyric?.text ?? id}`,
                      }
                    })}
                    style={{ width: 'calc(100% - 104px)' }}
                  />
                  <Button
                    icon={<SplitCellsOutlined />}
                    onClick={handleSplitScene}
                    disabled={editingScene.lyric_ids.length <= 1}
                  >
                    拆分
                  </Button>
                </Space.Compact>
              </div>
            </div>
          </Form>
        )}
      </Drawer>
    </div>
  )
}

export default StoryboardPanel
