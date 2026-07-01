const assert = require('node:assert/strict')
const { assertCloudExportScenes } = require('../dist-electron/exportPolicy.js')

const scene = (index, start, end, patch = {}) => ({
  scene_index: index,
  start_time: start,
  end_time: end,
  image_url: `keyframe-${index}.png`,
  video_url: `cloud-${index}.mp4`,
  video_provider: 'runway',
  video_model: 'gen4_turbo',
  style_fingerprint: 'style-v3',
  quality_status: 'approved',
  ...patch,
})

const valid = [scene(0, 0, 8), scene(1, 8, 16)]
assert.doesNotThrow(() => assertCloudExportScenes(valid, 16, 30))
assert.throws(
  () => assertCloudExportScenes([scene(0, 0, 8, { video_url: 'local-motion://scene/0' })], 8, 30),
  /不是云端视频/
)
assert.throws(
  () => assertCloudExportScenes([scene(0, 0, 8, { quality_status: 'needs_review' })], 8, 30),
  /尚未通过质检/
)
assert.throws(
  () => assertCloudExportScenes([scene(0, 0, 8), scene(1, 8, 16, { video_model: 'another-model' })], 16, 30),
  /不同的视频模型/
)
assert.throws(
  () => assertCloudExportScenes([scene(0, 0, 8), scene(1, 8.2, 16.2)], 16.2, 30),
  /空档或重叠/
)
assert.throws(
  () => assertCloudExportScenes(valid, 17, 30),
  /镜头总时长与音乐总时长不一致/
)

console.log('export policy tests passed')
