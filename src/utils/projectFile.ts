import { Project } from '../store/useAppStore'

export const normalizeLoadedProject = (payload: unknown): Project => {
  const source = payload && typeof payload === 'object' ? payload as Partial<Project> : null

  if (!source || !Array.isArray(source.lyrics) || !Array.isArray(source.scenes)) {
    throw new Error('项目文件格式不正确')
  }

  const createdAt = source.createdAt ? new Date(source.createdAt) : new Date()

  return {
    id: typeof source.id === 'string' ? source.id : Date.now().toString(),
    name: typeof source.name === 'string' ? source.name : '已导入项目',
    musicName: typeof source.musicName === 'string' ? source.musicName : undefined,
    musicFile: undefined,
    musicFilePath: undefined,
    duration: typeof source.duration === 'number' ? source.duration : undefined,
    lyrics: source.lyrics,
    scenes: source.scenes,
    analysis: source.analysis,
    generationLogs: Array.isArray(source.generationLogs) ? source.generationLogs : [],
    assets: Array.isArray(source.assets) ? source.assets : [],
    visualLock: source.visualLock && typeof source.visualLock === 'object' ? source.visualLock : { enabled: false },
    style: typeof source.style === 'string' ? source.style : 'cinematic',
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
  }
}
