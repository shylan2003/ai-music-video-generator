import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Typography, Slider, Button, Space, Divider, message } from 'antd'

import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
} from '@ant-design/icons'

import { useAppStore } from '@/store/useAppStore'


const { Text, Title } = Typography
const PREVIEWABLE_AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.opus'])

interface Props {
  selectedSceneIndex?: number | null
}

const PreviewPanel: React.FC<Props> = ({ selectedSceneIndex }) => {
  const { project } = useAppStore()
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const previewFrameRef = useRef<HTMLDivElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const hasShownUnsupportedMessageRef = useRef(false)


  const duration =
    project.duration ||
    project.scenes[project.scenes.length - 1]?.end_time ||
    project.lyrics[project.lyrics.length - 1]?.time ||
    240

  const musicExtension = useMemo(() => {
    const fileName = project.musicName || ''
    const dotIndex = fileName.lastIndexOf('.')
    return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
  }, [project.musicName])

  const canPlayAudio = Boolean(
    project.musicFile && PREVIEWABLE_AUDIO_EXTENSIONS.has(musicExtension)
  )

  const stopTimeline = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const seekTo = (time: number) => {
    const nextTime = Math.max(0, Math.min(time, duration))
    setCurrentTime(nextTime)

    if (audioRef.current && canPlayAudio) {
      audioRef.current.currentTime = nextTime
    }
  }

  const startAudioPlayback = async () => {
    if (!canPlayAudio || !audioRef.current) {
      return false
    }

    try {
      audioRef.current.currentTime = Math.max(0, Math.min(currentTime, duration))
      await audioRef.current.play()
      setIsPlaying(true)
      return true
    } catch {
      setIsPlaying(false)
      message.warning('音频预览启动失败，可能是音频尚未就绪，请稍后重试')
      return false
    }
  }

  const toggleFullscreen = async () => {
    const previewFrame = previewFrameRef.current

    if (!previewFrame) {
      return
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await previewFrame.requestFullscreen()
      }
    } catch {
      message.warning('当前环境暂不支持放大预览，请稍后重试')
    }
  }

  // 获取当前选中场景

  const selectedScene =
    selectedSceneIndex !== null && selectedSceneIndex !== undefined
      ? project.scenes[selectedSceneIndex]
      : null

  const lockedScene = isPlaying ? null : selectedScene

  // 当前时间对应的歌词
  const activeLyrics = useMemo(
    () => project.lyrics.filter((line) => !line.skip).sort((a, b) => a.time - b.time),
    [project.lyrics]
  )

  const currentLyric = activeLyrics.find(
    (line, index) =>
      line.time <= currentTime &&
      (activeLyrics[index + 1]?.time > currentTime || index === activeLyrics.length - 1)
  )

  // 当前时间对应的场景
  const currentScene = project.scenes.find(
    (scene, index) =>
      currentTime >= scene.start_time &&
      (currentTime < scene.end_time || index === project.scenes.length - 1)
  )

  const previewImage = lockedScene?.image_url || currentScene?.image_url || null

  useEffect(() => {
    return () => {
      stopTimeline()
    }
  }, [])

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === previewFrameRef.current)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }
  }, [])


  useEffect(() => {
    if (!isPlaying) {
      stopTimeline()
      audioRef.current?.pause()
      return
    }

    if (currentTime >= duration) {
      seekTo(0)
    }

    if (canPlayAudio) {
      stopTimeline()
      return
    }

    if (project.musicName && !hasShownUnsupportedMessageRef.current) {
      hasShownUnsupportedMessageRef.current = true
      message.info('当前音乐格式不支持音频预览，已切换为静默画面播放')
    }

    stopTimeline()
    timerRef.current = window.setInterval(() => {
      setCurrentTime((prev) => {
        const next = Math.min(prev + 0.1, duration)
        if (next >= duration) {
          stopTimeline()
          setIsPlaying(false)
        }
        return next
      })
    }, 100)
  }, [isPlaying, canPlayAudio, duration, project.musicName])


  useEffect(() => {
    hasShownUnsupportedMessageRef.current = false
    setIsPlaying(false)
    stopTimeline()
    audioRef.current?.pause()
    audioRef.current?.load()
    seekTo(0)
  }, [project.musicFile, project.musicName])


  const formatTime = (sec: number) => {


    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  const styleMap: Record<string, { bg: string; accent: string }> = {
    cinematic: { bg: 'linear-gradient(135deg, #0a1628, #1a2744)', accent: '#4fc3f7' },
    cyberpunk: { bg: 'linear-gradient(135deg, #0d0221, #1a0533)', accent: '#ff0099' },
    inkwash: { bg: 'linear-gradient(135deg, #111, #222)', accent: '#e8d5b7' },
    anime: { bg: 'linear-gradient(135deg, #1a1030, #2d1b4e)', accent: '#ff9ecd' },
    realistic: { bg: 'linear-gradient(135deg, #0f1923, #1a2744)', accent: '#7eb8f7' },
    abstract: { bg: 'linear-gradient(135deg, #0a0a1a, #1a0a2e)', accent: '#c084fc' },
  }
  const currentStyle = styleMap[project.style] || styleMap.cinematic

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: 14,
        gap: 12,
      }}
    >
      <Title level={5} className="section-title">
        实时预览
      </Title>

      {project.musicName && !canPlayAudio && (
        <div
          className="glass-card"
          style={{
            padding: '12px 14px',
            border: '1px solid rgba(239,68,68,0.35)',
            background: 'rgba(239,68,68,0.1)',
          }}
        >
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Text style={{ color: '#fecaca', fontSize: 12, fontWeight: 600 }}>
              当前音乐格式无法直接播放音频：{project.musicName}
            </Text>
            <Text style={{ color: '#fca5a5', fontSize: 11 }}>
              现在仅支持静默预览画面和歌词时间轴。若要正常听到声音，建议先转换为 MP3 后重新导入。
            </Text>
            <Button
              danger
              size="small"
              onClick={() => message.info('请先将 .mgg / .mgg1 转换为 MP3，再重新导入，即可正常预览音频')}
              style={{ width: 'fit-content' }}
            >
              建议先转换为 MP3 后重新导入
            </Button>
          </Space>
        </div>
      )}

      {/* 预览画面区域 */}
      <div
        ref={previewFrameRef}
        style={{
          aspectRatio: isFullscreen ? undefined : '16/9',
          width: '100%',
          height: isFullscreen ? '100%' : undefined,
          borderRadius: isFullscreen ? 0 : 10,
          overflow: 'hidden',
          background: currentStyle.bg,
          border: '1px solid var(--app-border)',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >

        {/* 场景图片或占位内容 */}
        {previewImage ? (
          // 显示选中场景图片
          <img
            src={previewImage}
            alt="scene preview"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : currentScene?.image_url ? (
          // 显示当前播放时间对应场景图片
          <img
            src={currentScene.image_url}
            alt="current scene"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        ) : (
          // 占位内容
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            {/* 装饰粒子 */}
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  width: 2,
                  height: 2,
                  borderRadius: '50%',
                  background: currentStyle.accent,
                  opacity: 0.4,
                  left: `${15 + i * 15}%`,
                  top: `${20 + (i % 3) * 25}%`,
                  boxShadow: `0 0 6px ${currentStyle.accent}`,
                }}
              />
            ))}

            <div style={{ textAlign: 'center', opacity: 0.5 }}>
              <Text style={{ color: '#475569', fontSize: 12 }}>
                {project.scenes.length > 0
                  ? '点击场景查看预览'
                  : '等待生成智能分镜'}
              </Text>
            </div>
          </div>
        )}

        {/* 歌词字幕叠加层（有图片时也显示） */}
        {currentLyric && !lockedScene && (

          <div
            style={{
              position: 'absolute',
              bottom: 20,
              left: 0,
              right: 0,
              textAlign: 'center',
              padding: '0 16px',
            }}
          >
            <div
              style={{
                display: 'inline-block',
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(4px)',
                padding: '6px 16px',
                borderRadius: 6,
              }}
            >
              <Text
                style={{
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 500,
                  textShadow: `0 0 20px ${currentStyle.accent}66`,
                }}
              >
                {currentLyric.text}
              </Text>
            </div>
          </div>
        )}

        {/* 选中场景标题叠加 */}
        {lockedScene && (

          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              padding: '20px 14px 10px',
              background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: 600, display: 'block' }}>
              {lockedScene?.title}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }} ellipsis>
              {lockedScene?.description}
            </Text>

          </div>
        )}

        {/* 全屏按钮 */}
        <Button
          type="text"
          icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          size="small"
          title={isFullscreen ? '退出放大预览' : '放大预览'}
          onClick={toggleFullscreen}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            color: 'rgba(255,255,255,0.6)',
            background: 'rgba(0,0,0,0.4)',
            backdropFilter: 'blur(4px)',
          }}
        />


        {/* 底部进度条 */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'rgba(255,255,255,0.1)',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${(currentTime / duration) * 100}%`,
              background: `linear-gradient(90deg, ${currentStyle.accent}, ${currentStyle.accent}aa)`,
              transition: 'width 0.1s linear',
            }}
          />
        </div>
      </div>

      {/* 播放控制 */}
      <div
        className="glass-card"
        style={{
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* 进度条 */}
        <div>
          <Slider
            value={currentTime}
            max={duration}
            onChange={seekTo}

            tooltip={{ formatter: (v) => formatTime(v || 0) }}
            styles={{
              track: { background: currentStyle.accent },
              rail: { background: 'rgba(255,255,255,0.1)' },
            }}
            style={{ margin: '0 0 4px' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
              {formatTime(currentTime)}
            </Text>
          <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
              {formatTime(duration)}
            </Text>
          </div>
        </div>

        {/* 控制按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <Button
            type="text"
            icon={<StepBackwardOutlined />}
            onClick={() => seekTo(0)}
            style={{ color: 'var(--app-text-muted)' }}
          />

          <Button
            type="text"
            icon={
              isPlaying ? (
                <PauseCircleOutlined
                  style={{ fontSize: 36, color: currentStyle.accent }}
                />
              ) : (
                <PlayCircleOutlined
                  style={{ fontSize: 36, color: currentStyle.accent }}
                />
              )
            }
            onClick={async () => {
              if (isPlaying) {
                setIsPlaying(false)
                return
              }

              if (currentTime >= duration) {
                seekTo(0)
              }

              if (canPlayAudio) {
                await startAudioPlayback()
                return
              }

              setIsPlaying(true)
            }}

            style={{ padding: 0, height: 'auto', lineHeight: 1 }}
          />

          <Button
            type="text"
            icon={<StepForwardOutlined />}
            onClick={() => seekTo(duration)}
            style={{ color: 'var(--app-text-muted)' }}
          />

        </div>
      </div>

      <audio
        ref={audioRef}
        src={canPlayAudio ? project.musicFile : undefined}
        preload="metadata"
        onLoadedMetadata={() => {
          if (audioRef.current && currentTime > 0) {
            audioRef.current.currentTime = currentTime
          }
        }}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime)
          }
        }}
        onError={() => {
          setIsPlaying(false)
          message.error('音频文件加载失败，可能是文件损坏、编码异常，或文件仍被其他程序占用')
        }}
        onEnded={() => {
          setIsPlaying(false)
          seekTo(0)
        }}
        style={{ display: 'none' }}
      />


      <Divider style={{ margin: '2px 0', borderColor: 'var(--app-border)' }} />


      {/* 当前信息面板 */}
      <div>
        <Text className="muted-label" style={{ display: 'block', marginBottom: 8 }}>
          {lockedScene ? '选中场景信息' : '当前画面信息'}
        </Text>
        <div className="glass-card" style={{ padding: '12px' }}>
          {lockedScene ? (

            // 显示选中场景信息
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>
                {lockedScene?.title}
              </Text>
              <Text style={{ color: '#64748b', fontSize: 11 }}>
                时间段：{formatTime(lockedScene?.start_time || 0)} →{' '}
                {formatTime(lockedScene?.end_time || 0)}
              </Text>
              <Text style={{ color: '#64748b', fontSize: 11 }}>
                包含歌词：{lockedScene?.lyric_ids.length || 0} 行
              </Text>
              {lockedScene?.prompt && (

                <div
                  style={{
                    marginTop: 4,
                    padding: '6px 10px',
                    background: 'rgba(255,255,255,0.03)',
                    borderRadius: 6,
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <Text style={{ color: '#374151', fontSize: 10, display: 'block', marginBottom: 2 }}>
                    AI Prompt：
                  </Text>
                  <Text style={{ color: '#4b5563', fontSize: 11 }}>
                    {lockedScene.prompt}
                  </Text>

                </div>
              )}
            </Space>
          ) : currentLyric ? (
            // 显示当前歌词信息
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <Text style={{ color: '#e2e8f0', fontSize: 13 }}>
                {currentLyric.text}
              </Text>
              <Text style={{ color: '#475569', fontSize: 11 }}>
                时间戳：{formatTime(currentLyric.time)}
              </Text>
              {currentScene && (
                <Text style={{ color: '#64748b', fontSize: 11 }}>
                  所属场景：{currentScene.title}
                </Text>
              )}
            </Space>
          ) : (
            <Text style={{ color: '#374151', fontSize: 12 }}>
              {project.scenes.length > 0
                ? '拖动进度条查看对应场景'
                : '请先生成智能分镜'}
            </Text>
          )}
        </div>
      </div>
    </div>
  )
}

export default PreviewPanel
