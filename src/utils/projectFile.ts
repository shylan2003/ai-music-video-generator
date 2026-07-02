import { GenerationPolicy, Project, Scene, StoryAnalysis } from '../store/useAppStore'
import { normalizeGenerationStatus } from './generationStatus'

const defaultGenerationPolicy = (): GenerationPolicy => ({
  mode: 'cloud_all',
  target_scene_seconds: 8,
  min_scene_seconds: 6,
  max_scene_seconds: 10,
  require_test_batch: true,
  test_scene_indexes: [],
  test_approved: false,
  provider_locked: false,
  prompt_version: 1,
})

const migrateAnalysis = (analysis?: StoryAnalysis): StoryAnalysis | undefined => {
  if (!analysis) return undefined
  const characters = Object.fromEntries(
    Object.entries(analysis.characters ?? {}).map(([characterId, character]) => {
      if (character.stages && Object.keys(character.stages).length > 0) {
        return [characterId, character]
      }
      return [
        characterId,
        {
          ...character,
          identity_prompt: character.identity_prompt || character.anchor_prompt,
          identity_anchor_image: character.identity_anchor_image || character.anchor_image,
          stages: {
            default: {
              id: 'default',
              name: '默认阶段',
              wardrobe: character.wardrobe,
              anchor_prompt: character.anchor_prompt,
              anchor_image: character.anchor_image,
              version: 1,
            },
          },
        },
      ]
    })
  )
  return { ...analysis, characters }
}

const migrateScene = (scene: Scene): Scene => ({
  ...scene,
  lyric_ids: Array.isArray(scene.lyric_ids) ? scene.lyric_ids : [],
  hero_prop_ids: Array.isArray(scene.hero_prop_ids) ? scene.hero_prop_ids : [],
  image_status: normalizeGenerationStatus(scene.image_status || scene.generation_status),
  video_status: normalizeGenerationStatus(scene.video_status),
  generation_status: normalizeGenerationStatus(scene.generation_status || scene.image_status),
  character_stage_id: scene.character_stage_id || (scene.character_id ? 'default' : undefined),
  first_frame: scene.first_frame || scene.image_url,
  requested_duration: scene.requested_duration || Math.max(0.5, scene.end_time - scene.start_time),
  video_provider: scene.video_provider,
  video_model: scene.video_model,
  quality_status: scene.video_url?.startsWith('local-motion://')
    ? 'rejected'
    : scene.quality_status || (scene.video_url ? 'needs_review' : 'pending'),
  quality_errors: scene.video_url?.startsWith('local-motion://')
    ? ['旧工程本地动态不能作为全云端正式镜头']
    : Array.isArray(scene.quality_errors) ? scene.quality_errors : [],
})

export const normalizeLoadedProject = (payload: unknown): Project => {
  const source = payload && typeof payload === 'object' ? payload as Partial<Project> : null

  if (!source || !Array.isArray(source.lyrics) || !Array.isArray(source.scenes)) {
    throw new Error('项目文件格式不正确')
  }

  const createdAt = source.createdAt ? new Date(source.createdAt) : new Date()

  return {
    schemaVersion: 3,
    id: typeof source.id === 'string' ? source.id : Date.now().toString(),
    name: typeof source.name === 'string' ? source.name : '已导入项目',
    musicName: typeof source.musicName === 'string' ? source.musicName : undefined,
    musicFile: typeof source.musicFile === 'string' && !source.musicFile.startsWith('blob:') ? source.musicFile : undefined,
    musicFilePath: typeof source.musicFilePath === 'string' ? source.musicFilePath : undefined,
    projectFilePath: typeof source.projectFilePath === 'string' ? source.projectFilePath : undefined,
    duration: typeof source.duration === 'number' ? source.duration : undefined,
    lyrics: source.lyrics,
    scenes: source.scenes.map((scene) => migrateScene(scene)),
    analysis: migrateAnalysis(source.analysis),
    generationLogs: Array.isArray(source.generationLogs) ? source.generationLogs : [],
    assets: Array.isArray(source.assets) ? source.assets : [],
    visualLock: source.visualLock && typeof source.visualLock === 'object' ? source.visualLock : { enabled: false },
    visualBible: source.visualBible || source.analysis?.visual_bible,
    generationPolicy: source.generationPolicy && typeof source.generationPolicy === 'object'
      ? { ...defaultGenerationPolicy(), ...source.generationPolicy, mode: 'cloud_all' }
      : defaultGenerationPolicy(),
    styleMode: source.styleMode === 'manual' || (source.styleMode !== 'auto' && source.style !== 'auto')
      ? 'manual'
      : 'auto',
    resolvedStyle: typeof source.resolvedStyle === 'string' ? source.resolvedStyle : undefined,
    style: typeof source.style === 'string' ? source.style : 'auto',
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
  }
}
