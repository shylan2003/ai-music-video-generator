import type { DirectorSettings, ImageGenerationSettings, ModelTemplate, VideoGenerationSettings } from './store/useAppStore'

export {}

declare global {
  interface Window {
    electronAPI?: {
      openFile: (options: unknown) => Promise<any>
      readTextFile: (filePath: string) => Promise<string>
      writeTextFile: (filePath: string, content: string) => Promise<boolean>
      fileExists: (filePath: string) => Promise<boolean>
      fileToUrl: (filePath: string) => Promise<string>
      getBackendConfig: () => Promise<{ baseUrl: string; token: string }>
      loadModelSettings: () => Promise<{
        directorSettings?: Partial<DirectorSettings>
        imageSettings?: Partial<ImageGenerationSettings>
        videoSettings?: Partial<VideoGenerationSettings>
        modelTemplates?: ModelTemplate[]
      }>
      saveModelSettings: (payload: {
        directorSettings: DirectorSettings
        imageSettings: ImageGenerationSettings
        videoSettings: VideoGenerationSettings
        modelTemplates: ModelTemplate[]
      }) => Promise<boolean>
      saveFile: (options: unknown) => Promise<any>
      exportVideo: (payload: {
        audioPath: string
        outputPath: string
        duration?: number
        width?: number
        height?: number
        fps?: number
        outputMode?: 'final' | 'edit_bundle' | 'both'
        projectName?: string
        assets?: Array<{
          id: string
          type: 'image' | 'video' | 'prompt'
          title: string
          url?: string
          prompt?: string
        }>
        motion?: 'none' | 'subtle' | 'standard' | 'dramatic'
        subtitles?: {
          enabled?: boolean
        }
        lyrics?: Array<{
          id: string
          time: number
          text: string
        }>
        scenes: Array<{
          scene_index: number
          title: string
          start_time: number
          end_time: number
          image_url: string
          video_url?: string
          camera_motion?: string
          transition?: string
          video_provider?: string
          video_model?: string
          style_fingerprint?: string
          quality_status?: string
          rendered_duration?: number
        }>
      }) => Promise<{ outputPath: string; bundlePath?: string }>
      onExportProgress: (
        callback: (payload: {
          stage: 'prepare' | 'download' | 'render' | 'complete' | 'error'
          progress: number
          message: string
        }) => void
      ) => () => void
      platform: string
    }
  }
}
