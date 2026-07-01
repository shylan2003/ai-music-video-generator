import React, { useState } from 'react'
import { Upload, Typography, Space, Progress, Button, message } from 'antd'
import {
  SoundOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { useAppStore, type LyricLine } from '@/store/useAppStore'
import { mergeShortLyricLines } from '@/utils/lyrics'
import { apiClient } from '@/api/client'

const { Text, Title } = Typography

const stripBom = (content: string) => content.replace(/^\uFEFF/, '')

const decodeWithEncoding = (buffer: ArrayBuffer, encoding: string) => {
  try {
    return stripBom(new TextDecoder(encoding).decode(buffer))
  } catch {
    return ''
  }
}

const getTextScore = (content: string) => {
  const replacementCount = (content.match(/�/g) ?? []).length
  const readableCount =
    (content.match(/[\u4e00-\u9fffA-Za-z0-9，。！？、；：“”‘’（）《》【】—…,.!?\s]/g) ?? []).length

  return readableCount - replacementCount * 20
}

const decodeLyricFile = async (file: File) => {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeWithEncoding(buffer, 'utf-8')
  }

  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decodeWithEncoding(buffer, 'utf-16le')
  }

  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decodeWithEncoding(buffer, 'utf-16be')
  }

  const candidates = ['utf-8', 'gb18030', 'utf-16le', 'utf-16be']
    .map((encoding) => decodeWithEncoding(buffer, encoding))
    .filter(Boolean)

  return candidates.sort((a, b) => getTextScore(b) - getTextScore(a))[0] ?? ''
}

// 支持的音乐格式
const MUSIC_FORMATS = '.mp3,.wav,.flac,.aac,.mgg,.mgg1,.ogg,.m4a,.wma,.ape,.opus'
const MUSIC_FORMAT_DISPLAY = 'MP3 / WAV / FLAC / AAC / MGG / OGG / M4A'
const PREVIEWABLE_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus'])

const getFileExtension = (fileName: string) => {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}


const getAudioDuration = (url: string) =>
  new Promise<number | undefined>((resolve) => {
    const audio = new Audio()

    const cleanup = () => {
      audio.onloadedmetadata = null
      audio.onerror = null
      audio.src = ''
    }

    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : undefined
      cleanup()
      resolve(duration)
    }
    audio.onerror = () => {
      cleanup()
      resolve(undefined)
    }
    audio.src = url
  })

const ImportPanel: React.FC = () => {

  const { project, setProject, setLyrics } = useAppStore()
  const [musicProgress, setMusicProgress] = useState(0)
  const currentMusicExtension = getFileExtension(project.musicName ?? '')
  const isPreviewableMusic = Boolean(project.musicName) && PREVIEWABLE_AUDIO_EXTENSIONS.has(currentMusicExtension)
  const isMggMusic = currentMusicExtension === '.mgg' || currentMusicExtension === '.mgg1'


  // 音乐文件导入
  const handleMusicUpload = async (file: File) => {
    setMusicProgress(20)

    const extension = getFileExtension(file.name)
    const isPreviewable = PREVIEWABLE_AUDIO_EXTENSIONS.has(extension)
    const electronFilePath = (file as File & { path?: string }).path
    const nextMusicFile = isPreviewable ? URL.createObjectURL(file) : undefined
    const duration = nextMusicFile ? await getAudioDuration(nextMusicFile) : undefined

    if (project.musicFile?.startsWith('blob:')) {
      URL.revokeObjectURL(project.musicFile)
    }

    setMusicProgress(100)
    setProject({
      musicName: file.name,
      musicFile: nextMusicFile,
      musicFilePath: electronFilePath,
      duration:
        duration ??
        project.duration ??
        (project.lyrics.length > 0 ? project.lyrics[project.lyrics.length - 1].time + 3 : undefined),
    })


    if (!isPreviewable) {
      message.warning(`当前格式暂不支持音频预览：${file.name}，将仅播放画面时间轴`)
    } else {
      message.success(`音乐导入成功：${file.name}`)
    }

    window.setTimeout(() => setMusicProgress(0), 500)
    return false
  }


  // 歌词文件解析
  const handleLyricUpload = async (file: File) => {
    try {
      const content = await decodeLyricFile(file)
      const kind = getFileExtension(file.name).replace('.', '') || 'auto'
      const response = await apiClient.post('/api/lyrics/parse', {
        content,
        kind,
        duration: project.duration,
      })
      const parsedLyrics = response.data.lyrics as LyricLine[]

      if (parsedLyrics.length === 0) {
        message.error('歌词解析失败，请检查文件格式')
        return false
      }

      const { lyrics: mergedLyrics, mergedCount } = mergeShortLyricLines(parsedLyrics)
      setLyrics(mergedLyrics)
      message.success(
        mergedCount > 0
          ? `成功解析 ${parsedLyrics.length} 行歌词，已合并 ${mergedCount} 行过短歌词`
          : `成功解析 ${parsedLyrics.length} 行歌词`
      )
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '歌词读取失败，请检查格式、时间轴或文件编码')
    }

    return false
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Title level={5} className="section-title">
        素材导入
      </Title>

      {/* 音乐导入 */}
      <div>
        <Text className="muted-label" style={{ display: 'block', marginBottom: 8 }}>
          音乐文件
        </Text>
        <Upload
          accept={MUSIC_FORMATS}
          showUploadList={false}
          beforeUpload={handleMusicUpload}
        >
          <div
            className="glass-card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              textAlign: 'left',
              border: project.musicName
                ? '1px solid rgba(20,184,166,0.45)'
                : '1px dashed var(--app-border-strong)',
              transition: 'all 0.2s',
              width: '100%',
            }}
          >
            {project.musicName ? (
              <Space size={10}>
                <CheckCircleOutlined style={{ fontSize: 20, color: 'var(--app-success)' }} />
                <div>
                <Text
                  style={{ color: 'var(--app-text)', fontSize: 13, maxWidth: 220, display: 'block' }}
                  ellipsis={{ tooltip: project.musicName }}
                >
                  {project.musicName}
                </Text>
                  <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
                    点击重新导入
                  </Text>
                </div>
              </Space>
            ) : (
              <Space size={10}>
                <SoundOutlined style={{ fontSize: 20, color: 'var(--app-text-subtle)' }} />
                <div>
                <Text style={{ color: 'var(--app-text-muted)', fontSize: 13, display: 'block' }}>
                  点击或拖拽音乐文件
                </Text>
                <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
                  {MUSIC_FORMAT_DISPLAY}
                </Text>
                </div>
              </Space>
            )}
          </div>
        </Upload>

        {/* 进度条 */}
        {musicProgress > 0 && musicProgress < 100 && (
          <Progress
            percent={musicProgress}
            size="small"
            strokeColor="#7c3aed"
            style={{ marginTop: 8 }}
          />
        )}

        {/* 不可预览格式提示 */}
        {project.musicName && !isPreviewableMusic && (
          <div
            style={{
              marginTop: 8,
              padding: '12px 14px',
              background: isMggMusic
                ? 'linear-gradient(135deg, rgba(127,29,29,0.22), rgba(120,53,15,0.18))'
                : 'rgba(251,146,60,0.08)',
              border: isMggMusic
                ? '1px solid rgba(248,113,113,0.35)'
                : '1px solid rgba(251,146,60,0.2)',
              borderRadius: 8,
            }}
          >
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text style={{ color: isMggMusic ? '#fca5a5' : '#fb923c', fontSize: 12, fontWeight: 600 }}>
                {isMggMusic
                  ? '当前导入的是 .mgg / .mgg1，加密格式无法在预览区直接播放音频'
                  : '当前音乐格式暂不支持音频预览'}
              </Text>
              <Text style={{ color: isMggMusic ? '#fecaca' : '#fdba74', fontSize: 11 }}>
                {isMggMusic
                  ? '你仍可预览歌词、画面和时间轴切换，但不会有声音。若要正常试听，建议先转换为 MP3。'
                  : '当前仅支持静默预览画面时间轴，建议转换为 MP3 后再导入。'}
              </Text>
              <Button
                type={isMggMusic ? 'primary' : 'default'}
                danger={isMggMusic}
                size="small"
                onClick={() => message.info('建议先将当前音频转换为 MP3，再重新导入，即可正常预览音频')}
                style={{ width: '100%' }}
              >
                建议先转换为 MP3 后重新导入
              </Button>
            </Space>
          </div>
        )}

      </div>

      {/* 歌词导入 */}
      <div>
        <Text className="muted-label" style={{ display: 'block', marginBottom: 8 }}>
          歌词文件
        </Text>
        <Upload
          accept=".lrc,.txt,.srt"
          showUploadList={false}
          beforeUpload={handleLyricUpload}
        >
          <div
            className="glass-card"
            style={{
              padding: '16px',
              cursor: 'pointer',
              textAlign: 'left',
              border: project.lyrics.length > 0
                ? '1px solid rgba(139,92,246,0.45)'
                : '1px dashed var(--app-border-strong)',
              transition: 'all 0.2s',
              width: '100%',
            }}
          >
            {project.lyrics.length > 0 ? (
              <Space size={10}>
                <CheckCircleOutlined style={{ fontSize: 20, color: 'var(--app-success)' }} />
                <div>
                <Text style={{ color: 'var(--app-text)', fontSize: 13, display: 'block' }}>
                  已加载 {project.lyrics.length} 行歌词
                </Text>
                <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
                  点击重新导入
                </Text>
                </div>
              </Space>
            ) : (
              <Space size={10}>
                <FileTextOutlined style={{ fontSize: 20, color: 'var(--app-text-subtle)' }} />
                <div>
                <Text style={{ color: 'var(--app-text-muted)', fontSize: 13, display: 'block' }}>
                  点击或拖拽歌词文件
                </Text>
                <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
                  LRC / TXT / SRT
                </Text>
                </div>
              </Space>
            )}
          </div>
        </Upload>
      </div>

      {/* 就绪提示 */}
      {project.musicName && project.lyrics.length > 0 && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(74,222,128,0.08)',
            border: '1px solid rgba(74,222,128,0.2)',
            borderRadius: 8,
          }}
        >
          <Text style={{ color: '#4ade80', fontSize: 12 }}>
            素材已就绪，请切换到「智能分镜」生成视频
          </Text>
        </div>
      )}

      {/* 只有歌词没有音乐的提示 */}
      {!project.musicName && project.lyrics.length > 0 && (
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(251,146,60,0.08)',
            border: '1px solid rgba(251,146,60,0.2)',
            borderRadius: 8,
          }}
        >
          <Text style={{ color: '#fb923c', fontSize: 12 }}>
            歌词已导入，还需导入音乐文件
          </Text>
        </div>
      )}
    </div>
  )
}

export default ImportPanel
