export interface CloudExportScene {
  scene_index: number
  start_time: number
  end_time: number
  image_url?: string
  video_url?: string
  video_provider?: string
  video_model?: string
  style_fingerprint?: string
  quality_status?: string
}

const isCloudVideo = (value?: string) => Boolean(value && !value.startsWith('local-motion://'))

export function assertCloudExportScenes(
  scenes: CloudExportScene[],
  expectedDuration?: number,
  fps = 30
) {
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error('当前没有可导出的分镜，请先生成段落分镜')
  }

  const sorted = [...scenes].sort((a, b) => a.start_time - b.start_time)
  const frameTolerance = 1 / Math.max(1, fps) + 0.001
  for (const [index, scene] of sorted.entries()) {
    if (!scene.image_url) {
      throw new Error(`分镜 ${scene.scene_index + 1} 缺少关键帧，无法导出`)
    }
    if (!isCloudVideo(scene.video_url)) {
      throw new Error(`分镜 ${scene.scene_index + 1} 不是云端视频，无法正式导出`)
    }
    if (scene.quality_status !== 'approved') {
      throw new Error(`分镜 ${scene.scene_index + 1} 尚未通过质检，无法正式导出`)
    }
    if (!scene.video_provider || !scene.video_model || !scene.style_fingerprint) {
      throw new Error(`分镜 ${scene.scene_index + 1} 缺少模型或视觉圣经锁定信息`)
    }
    if (!(scene.end_time > scene.start_time)) {
      throw new Error(`分镜 ${scene.scene_index + 1} 的时间范围无效`)
    }
    const expectedStart = index === 0 ? 0 : sorted[index - 1].end_time
    if (Math.abs(scene.start_time - expectedStart) > frameTolerance) {
      throw new Error(`分镜 ${scene.scene_index + 1} 与前一镜存在空档或重叠`)
    }
  }

  const providerLocks = new Set(
    sorted.map((scene) => `${scene.video_provider}:${scene.video_model}:${scene.style_fingerprint}`)
  )
  if (providerLocks.size !== 1) {
    throw new Error('正式输出包含不同的视频模型或视觉圣经版本，已阻止混合导出')
  }

  const timelineEnd = sorted[sorted.length - 1].end_time
  const targetDuration = expectedDuration && expectedDuration > 0 ? expectedDuration : timelineEnd
  if (Math.abs(timelineEnd - targetDuration) > frameTolerance) {
    throw new Error('镜头总时长与音乐总时长不一致，已阻止导出')
  }
}
