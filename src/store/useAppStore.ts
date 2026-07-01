import { create } from 'zustand'

export type AppPage = 'home' | 'editor' | 'export'

export interface LyricLine {
  id: string
  time: number
  text: string
  skip?: boolean
  imageUrl?: string
  prompt?: string
  sceneIndex?: number  // 属于第几个场景
}


export interface Scene {
  scene_index: number
  title: string
  description: string
  summary?: string
  mood?: string
  imagery?: string[]
  character_id?: string
  visual?: string
  shot_type?: string
  camera_motion?: string
  transition?: string
  video_prompt?: string
  prompt: string
  image_prompt?: string
  start_time: number
  end_time: number
  lyric_ids: string[]
  image_url: string
  image_path?: string
  video_path?: string
  anchor_image?: string
  generation_status?: GenerationStatus
  error?: string
  reuse_from?: number | null
  video_url?: string
  image_status?: GenerationStatus
  video_status?: GenerationStatus
  generation_error?: string
  video_error?: string
}

export interface CharacterProfile {
  name: string
  description?: string
  wardrobe?: string
  anchor_prompt: string
  anchor_image?: string
}

export interface StoryAnalysis {
  total_scenes: number
  valid_lyrics: number
  style: string
  summary: string
  director_analysis?: Record<string, unknown>
  characters?: Record<string, CharacterProfile>
}

export type ImageProvider = 'tongyi' | 'pollinations' | 'openai' | 'custom' | 'placeholder'
export type VideoProvider = 'local_motion' | 'kling' | 'runway' | 'luma' | 'custom' | 'none'
export type GenerationStatus = 'idle' | 'queued' | 'generating' | 'done' | 'error'
export type GenerationLogType = 'storyboard' | 'image' | 'video' | 'export'
export type GenerationLogStatus = 'success' | 'error' | 'canceled'
export type ProjectAssetType = 'image' | 'video' | 'prompt'

export interface GenerationLog {
  id: string
  type: GenerationLogType
  status: GenerationLogStatus
  title: string
  provider?: string
  model?: string
  sceneIndex?: number
  sceneTitle?: string
  message?: string
  error?: string
  durationMs?: number
  createdAt: string
}

export interface ProjectAsset {
  id: string
  type: ProjectAssetType
  title: string
  url?: string
  prompt?: string
  videoPrompt?: string
  provider?: string
  model?: string
  sceneIndex?: number
  sceneTitle?: string
  source?: 'storyboard' | 'queue' | 'manual' | 'export'
  createdAt: string
}

export interface VisualLockSettings {
  enabled: boolean
  mainSubject?: string
  wardrobe?: string
  setting?: string
  palette?: string
  symbols?: string
  negativePrompt?: string
}

export interface ImageGenerationSettings {
  provider: ImageProvider
  model: string
  apiKey: string
  baseUrl: string
  size: string
  quality: string
}

export interface DirectorSettings {
  provider: 'deepseek' | 'rules'
  model: string
  apiKey: string
  baseUrl: string
}

export interface VideoGenerationSettings {
  provider: VideoProvider
  model: string
  apiKey: string
  baseUrl: string
  motionStrength: 'subtle' | 'standard' | 'dramatic'
  clipSeconds: number
}

export interface ModelTemplate {
  id: string
  name: string
  kind: 'image' | 'video'
  provider: ImageProvider | VideoProvider
  model: string
  baseUrl?: string
  requiresKey?: boolean
  description?: string
}

export interface Project {
  schemaVersion: 2
  id: string
  name: string
  projectFilePath?: string
  musicFile?: string
  musicFilePath?: string
  musicName?: string
  duration?: number
  lyrics: LyricLine[]

  scenes: Scene[]
  analysis?: StoryAnalysis
  generationLogs?: GenerationLog[]
  assets?: ProjectAsset[]
  visualLock?: VisualLockSettings
  style: string
  createdAt: Date
}

interface AppState {
  currentPage: AppPage
  project: Project
  directorSettings: DirectorSettings
  imageSettings: ImageGenerationSettings
  videoSettings: VideoGenerationSettings
  modelTemplates: ModelTemplate[]
  isGenerating: boolean
  backendStatus: 'connecting' | 'online' | 'offline'

  setCurrentPage: (page: AppPage) => void
  setProject: (project: Partial<Project>) => void
  loadProject: (project: Project) => void
  setLyrics: (lyrics: LyricLine[]) => void
  setScenes: (scenes: Scene[], analysis?: StoryAnalysis) => void
  setStyle: (style: string) => void
  setImageSettings: (settings: Partial<ImageGenerationSettings>) => void
  setDirectorSettings: (settings: Partial<DirectorSettings>) => void
  setVideoSettings: (settings: Partial<VideoGenerationSettings>) => void
  setModelTemplates: (templates: ModelTemplate[]) => void
  addModelTemplate: (template: Omit<ModelTemplate, 'id'> & { id?: string }) => void
  removeModelTemplate: (id: string) => void
  addGenerationLog: (log: Omit<GenerationLog, 'id' | 'createdAt'>) => void
  clearGenerationLogs: () => void
  addProjectAsset: (asset: Omit<ProjectAsset, 'id' | 'createdAt'>) => void
  clearProjectAssets: () => void
  setGenerating: (status: boolean) => void
  setBackendStatus: (status: 'connecting' | 'online' | 'offline') => void
  resetProject: () => void
}

const defaultProject: Project = {
  schemaVersion: 2,
  id: Date.now().toString(),
  name: '未命名项目',
  lyrics: [],
  scenes: [],
  generationLogs: [],
  assets: [],
  visualLock: { enabled: false },
  style: 'cinematic',
  createdAt: new Date(),
}

const defaultDirectorSettings: DirectorSettings = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
}

const defaultImageSettings: ImageGenerationSettings = {
  provider: 'tongyi',
  model: 'wan2.6-image',
  apiKey: '',
  baseUrl: '',
  size: '1280x720',
  quality: 'medium',
}

const defaultVideoSettings: VideoGenerationSettings = {
  provider: 'local_motion',
  model: 'ken-burns',
  apiKey: '',
  baseUrl: '',
  motionStrength: 'standard',
  clipSeconds: 6,
}

export const defaultModelTemplates: ModelTemplate[] = [
  {
    id: 'image-tongyi-wan26',
    name: '通义万相参考图',
    kind: 'image',
    provider: 'tongyi',
    model: 'wan2.6-image',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    requiresKey: true,
    description: '默认稳定图片通道，支持角色定妆照参考图。',
  },
  {
    id: 'image-pollinations-free',
    name: 'Pollinations 免费图片',
    kind: 'image',
    provider: 'pollinations',
    model: 'flux',
    requiresKey: false,
    description: '免费图片生成，适合低成本测试和草稿。',
  },
  {
    id: 'image-openai-compatible',
    name: 'OpenAI-compatible 图片接口',
    kind: 'image',
    provider: 'custom',
    model: 'gpt-image-2',
    baseUrl: 'https://api.example.com/v1',
    requiresKey: true,
    description: '兼容 /images/generations 的图片服务，可接 OpenAI 兼容代理、本地 SD/ComfyUI 包装服务。',
  },
  {
    id: 'image-placeholder',
    name: '占位图测试',
    kind: 'image',
    provider: 'placeholder',
    model: 'placeholder',
    requiresKey: false,
    description: '不调用模型，只验证歌词、分镜、导出流程。',
  },
  {
    id: 'video-local-motion',
    name: '本地 Ken Burns 动态',
    kind: 'video',
    provider: 'local_motion',
    model: 'ken-burns',
    requiresKey: false,
    description: '免费本地镜头运动，导出时用 ffmpeg 生成推拉横移效果。',
  },
  {
    id: 'video-runway',
    name: 'Runway 图生视频',
    kind: 'video',
    provider: 'runway',
    model: 'gen4_turbo',
    requiresKey: true,
    description: '已接入后端图生视频队列，适合电影感运动镜头。',
  },
  {
    id: 'video-luma',
    name: 'Luma 图生视频',
    kind: 'video',
    provider: 'luma',
    model: 'ray-2',
    requiresKey: true,
    description: '需要公网 HTTPS 关键帧图片，适合 Dream Machine 工作流。',
  },
  {
    id: 'video-kling',
    name: 'Kling 图生视频',
    kind: 'video',
    provider: 'kling',
    model: 'kling-v1-6',
    requiresKey: true,
    description: '支持 Token 或 AccessKey:SecretKey，适合中文古风画面。',
  },
  {
    id: 'video-custom',
    name: '自定义视频接口',
    kind: 'video',
    provider: 'custom',
    model: 'custom-video',
    baseUrl: 'https://api.example.com/generate-video',
    requiresKey: true,
    description: 'POST prompt/image_url/duration/camera_motion，返回 video_url。',
  },
]

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'home',
  project: defaultProject,
  directorSettings: defaultDirectorSettings,
  imageSettings: defaultImageSettings,
  videoSettings: defaultVideoSettings,
  modelTemplates: defaultModelTemplates,
  isGenerating: false,
  backendStatus: 'connecting',

  setCurrentPage: (page) => set({ currentPage: page }),
  setProject: (data) =>
    set((state) => ({ project: { ...state.project, ...data } })),
  loadProject: (project) => set({ project }),
  setLyrics: (lyrics) =>
    set((state) => ({ project: { ...state.project, lyrics } })),
  setScenes: (scenes, analysis) =>
    set((state) => ({
      project: { ...state.project, scenes, analysis },
    })),
  setStyle: (style) =>
    set((state) => ({ project: { ...state.project, style } })),
  setImageSettings: (settings) =>
    set((state) => ({ imageSettings: { ...state.imageSettings, ...settings } })),
  setDirectorSettings: (settings) =>
    set((state) => ({ directorSettings: { ...state.directorSettings, ...settings } })),
  setVideoSettings: (settings) =>
    set((state) => ({ videoSettings: { ...state.videoSettings, ...settings } })),
  setModelTemplates: (templates) => set({ modelTemplates: templates }),
  addModelTemplate: (template) =>
    set((state) => ({
      modelTemplates: [
        {
          ...template,
          id: template.id || `template-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        ...state.modelTemplates.filter((item) => item.id !== template.id),
      ],
    })),
  removeModelTemplate: (id) =>
    set((state) => ({
      modelTemplates: state.modelTemplates.filter((template) => template.id !== id),
    })),
  addGenerationLog: (log) =>
    set((state) => ({
      project: {
        ...state.project,
        generationLogs: [
          {
            ...log,
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            createdAt: new Date().toISOString(),
          },
          ...(state.project.generationLogs ?? []),
        ].slice(0, 200),
      },
    })),
  clearGenerationLogs: () =>
    set((state) => ({ project: { ...state.project, generationLogs: [] } })),
  addProjectAsset: (asset) =>
    set((state) => ({
      project: {
        ...state.project,
        assets: [
          {
            ...asset,
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            createdAt: new Date().toISOString(),
          },
          ...(state.project.assets ?? []),
        ].slice(0, 500),
      },
    })),
  clearProjectAssets: () =>
    set((state) => ({ project: { ...state.project, assets: [] } })),
  setGenerating: (status) => set({ isGenerating: status }),
  setBackendStatus: (status) => set({ backendStatus: status }),
  resetProject: () =>
    set({
      project: {
        ...defaultProject,
        id: Date.now().toString(),
        createdAt: new Date(),
      },
    }),
}))
