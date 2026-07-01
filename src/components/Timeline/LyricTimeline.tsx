import React, { useEffect, useState } from 'react'
import { Typography, Button, Empty, Modal, Tooltip, Tag, Space, message } from 'antd'
import {
  ThunderboltOutlined,
  PictureOutlined,
  ClockCircleOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons'
import { useAppStore } from '@/store/useAppStore'
import { mergeShortLyricLines } from '@/utils/lyrics'

import axios from 'axios'

const { Text, Title } = Typography
const THUMBNAIL_SIZE = 48

const LyricTimeline: React.FC = () => {
  const { project, imageSettings, isGenerating, setGenerating, setLyrics } = useAppStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [generatingId, setGeneratingId] = useState<string | null>(null)
  const [previewLyricId, setPreviewLyricId] = useState<string | null>(null)
  const previewLyric = project.lyrics.find((lyric) => lyric.id === previewLyricId)

  useEffect(() => {
    if (project.lyrics.length === 0) return

    const { lyrics: mergedLyrics, mergedCount } = mergeShortLyricLines(project.lyrics)
    if (mergedCount === 0) return

    setLyrics(mergedLyrics)
    message.info(`已自动合并 ${mergedCount} 行过短歌词，避免单独生成画面`)
  }, [project.lyrics.length])

  // 自动过滤非歌词行
  useEffect(() => {
    if (project.lyrics.length === 0) return
    const hasSkipField = project.lyrics.some((l) => l.skip !== undefined)
    if (hasSkipField) return // 已经过滤过了

    axios
      .post('http://localhost:8000/api/lyrics/filter', {
        lyrics: project.lyrics,
      })
      .then((res) => {
        const filtered = res.data.lyrics
        const updated = project.lyrics.map((line) => {
          const found = filtered.find((f: any) => f.id === line.id)
          return found ? { ...line, skip: found.skip } : line
        })
        const { lyrics: mergedLyrics } = mergeShortLyricLines(updated)
        setLyrics(mergedLyrics)
        const skippedCount = updated.filter((l) => l.skip).length
        if (skippedCount > 0) {
          message.info(`已自动识别 ${skippedCount} 行非歌词内容并标记跳过`)
        }
      })
      .catch(() => {})
  }, [project.lyrics.length])

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`
  }

  // 切换跳过状态
  const toggleSkip = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = project.lyrics.map((l) =>
      l.id === id ? { ...l, skip: !l.skip } : l
    )
    setLyrics(updated)
  }

  // 单行生成
  const generateSingle = async (id: string, text: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setGeneratingId(id)
    try {
      // 第一步：生成 Prompt
      const promptRes = await axios.post('http://localhost:8000/api/generate/prompt', {
        lyric: text,
        style: project.style,
      })
      const prompt = promptRes.data.prompt

      // 第二步：生成图片
      const imageRes = await axios.post('http://localhost:8000/api/generate/image', {
        prompt,
        lyric_id: id,
        image_provider: imageSettings,
      })

      // 更新歌词行
      const updated = project.lyrics.map((l) =>
        l.id === id
          ? { ...l, imageUrl: imageRes.data.image_url, prompt }
          : l
      )
      setLyrics(updated)
      message.success('画面生成成功')
    } catch (err) {
      message.error('生成失败，请检查后端服务')
    } finally {
      setGeneratingId(null)
    }
  }

  const openImagePreview = (lyricId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPreviewLyricId(lyricId)
  }

  // 一键批量生成
  const handleGenerateAll = async () => {
    const validLyrics = project.lyrics.filter((l) => !l.skip)
    if (validLyrics.length === 0) {
      message.warning('没有可生成的歌词行')
      return
    }

    setGenerating(true)
    message.loading({ content: `正在生成 ${validLyrics.length} 张画面...`, key: 'generating' })

    try {
      const res = await axios.post('http://localhost:8000/api/generate/batch', {
        lyrics: validLyrics,
        style: project.style,
        image_provider: imageSettings,
      })

      const results = res.data.results
      const resultMap: Record<string, { image_url: string; prompt: string }> = {}
      results.forEach((r: any) => {
        resultMap[r.id] = { image_url: r.image_url, prompt: r.prompt }
      })

      const updated = project.lyrics.map((l) => {
        if (resultMap[l.id]) {
          return {
            ...l,
            imageUrl: resultMap[l.id].image_url,
            prompt: resultMap[l.id].prompt,
          }
        }
        return l
      })

      setLyrics(updated)
      message.success({ content: `成功生成 ${results.length} 张画面！`, key: 'generating' })
    } catch (err) {
      message.error({ content: '批量生成失败，请检查后端服务', key: 'generating' })
    } finally {
      setGenerating(false)
    }
  }

  const validCount = project.lyrics.filter((l) => !l.skip).length
  const doneCount = project.lyrics.filter((l) => !l.skip && l.imageUrl).length

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
            歌词时间轴
          </Title>
          {project.lyrics.length > 0 && (
            <Space size={6}>
              <Tag style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', color: '#a78bfa', fontSize: 11 }}>
                共 {project.lyrics.length} 行
              </Tag>
              <Tag style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', fontSize: 11 }}>
                有效 {validCount} 行
              </Tag>
              {doneCount > 0 && (
                <Tag style={{ background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa', fontSize: 11 }}>
                  已生成 {doneCount}/{validCount}
                </Tag>
              )}
            </Space>
          )}
        </Space>

        {project.lyrics.length > 0 && (
          <Button
            type="primary"
            size="small"
            icon={<ThunderboltOutlined />}
            loading={isGenerating}
            onClick={handleGenerateAll}
            style={{
              background: isGenerating ? undefined : 'linear-gradient(135deg, #7c3aed, #9d5ff5)',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            {isGenerating ? '生成中...' : `一键生成画面 (${validCount})`}
          </Button>
        )}
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {project.lyrics.length === 0 ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<Text style={{ color: '#475569' }}>请先在左侧导入歌词文件</Text>}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {project.lyrics.map((lyric, index) => (
              <div
                key={lyric.id}
                onClick={() => !lyric.skip && setSelectedId(lyric.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 62,
                  padding: '7px 10px 7px 12px',
                  borderRadius: 8,
                  cursor: lyric.skip ? 'default' : 'pointer',
                  opacity: lyric.skip ? 0.35 : 1,
                  background: selectedId === lyric.id
                    ? 'rgba(139,92,246,0.12)'
                    : 'var(--app-surface)',
                  border: selectedId === lyric.id
                    ? '1px solid rgba(139,92,246,0.4)'
                    : '1px solid var(--app-border)',
                  transition: 'all 0.15s',
                }}
              >
                {/* 序号 */}
                <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11, width: 24, textAlign: 'right', flexShrink: 0 }}>
                  {index + 1}
                </Text>

                {/* 时间戳 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, width: 80 }}>
                  <ClockCircleOutlined style={{ fontSize: 10, color: 'var(--app-text-subtle)' }} />
                  <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11, fontFamily: 'monospace' }}>
                    {formatTime(lyric.time)}
                  </Text>
                </div>

                {/* 歌词文本 */}
                <Text
                  style={{ color: selectedId === lyric.id ? 'var(--app-text)' : 'var(--app-text-muted)', fontSize: 14, flex: 1 }}
                  ellipsis
                >
                  {lyric.text}
                </Text>

                {/* 右侧操作区 */}
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>

                  {/* 跳过开关 */}
                  <Tooltip title={lyric.skip ? '已跳过（点击恢复）' : '标记为跳过'}>
                    <div
                      onClick={(e) => toggleSkip(lyric.id, e)}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        background: lyric.skip ? 'rgba(245,158,11,0.14)' : 'transparent',
                        border: lyric.skip ? '1px solid rgba(245,158,11,0.35)' : '1px solid transparent',
                      }}
                    >
                      <EyeInvisibleOutlined style={{ fontSize: 12, color: lyric.skip ? 'var(--app-warning)' : 'var(--app-text-subtle)' }} />
                    </div>
                  </Tooltip>

                  {/* 画面状态 / 生成按钮 */}
                  {!lyric.skip && (
                    lyric.imageUrl ? (
                      <Tooltip title="已生成，点击重新生成">
                        <div
                          onClick={(e) => generateSingle(lyric.id, lyric.text, e)}
                          onContextMenu={(e) => openImagePreview(lyric.id, e)}
                          style={{
                            width: THUMBNAIL_SIZE,
                            height: THUMBNAIL_SIZE,
                            borderRadius: 6,
                            overflow: 'hidden',
                            border: '1px solid rgba(34,197,94,0.45)',
                            cursor: 'pointer',
                            background: 'rgba(255,255,255,0.04)',
                          }}
                        >
                          <img
                            src={lyric.imageUrl}
                            alt="preview"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        </div>
                      </Tooltip>
                    ) : generatingId === lyric.id ? (
                      <div style={{
                        width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, borderRadius: 6,
                        background: 'rgba(139,92,246,0.12)',
                        border: '1px solid rgba(139,92,246,0.35)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        animation: 'pulse-glow 1.5s infinite',
                      }}>
                        <ThunderboltOutlined style={{ fontSize: 12, color: '#c4b5fd' }} />
                      </div>
                    ) : (
                      <Tooltip title="点击单独生成画面">
                        <div
                          onClick={(e) => generateSingle(lyric.id, lyric.text, e)}
                          style={{
                            width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE, borderRadius: 6,
                            background: 'var(--app-surface-raised)',
                            border: '1px solid var(--app-border-strong)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                          onMouseEnter={(e) => {
                            (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(139,92,246,0.45)'
                            ;(e.currentTarget as HTMLDivElement).style.background = 'rgba(139,92,246,0.12)'
                          }}
                          onMouseLeave={(e) => {
                            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--app-border-strong)'
                            ;(e.currentTarget as HTMLDivElement).style.background = 'var(--app-surface-raised)'
                          }}
                        >
                          <PictureOutlined style={{ fontSize: 14, color: 'var(--app-text-subtle)' }} />
                        </div>
                      </Tooltip>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        title="画面预览"
        open={Boolean(previewLyric?.imageUrl)}
        footer={null}
        width={900}
        centered
        onCancel={() => setPreviewLyricId(null)}
        styles={{
          body: {
            paddingTop: 12,
          },
        }}
      >
        {previewLyric?.imageUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                borderRadius: 8,
                overflow: 'hidden',
                background: '#0f0f1a',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <img
                src={previewLyric.imageUrl}
                alt={previewLyric.text}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
            </div>

            <div
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <Text style={{ color: '#e2e8f0', fontSize: 14, display: 'block', marginBottom: 6 }}>
                {previewLyric.text}
              </Text>
              <Text style={{ color: '#64748b', fontSize: 12, display: 'block' }}>
                时间戳：{formatTime(previewLyric.time)}
              </Text>
              {previewLyric.prompt && (
                <Text style={{ color: '#475569', fontSize: 12, display: 'block', marginTop: 8 }}>
                  Prompt：{previewLyric.prompt}
                </Text>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default LyricTimeline
