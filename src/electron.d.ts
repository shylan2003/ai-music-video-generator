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
        }>
      }) => Promise<{ outputPath: string }>
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
