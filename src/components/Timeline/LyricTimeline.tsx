import React, { useEffect, useState } from 'react'
import { Typography, Empty, Tooltip, Tag, Space, message } from 'antd'
import {
  ClockCircleOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons'
import { useAppStore } from '@/store/useAppStore'
import { mergeShortLyricLines } from '@/utils/lyrics'

import { apiClient } from '@/api/client'

const { Text, Title } = Typography

const LyricTimeline: React.FC = () => {
  const { project, setLyrics } = useAppStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

    apiClient
      .post('/api/lyrics/filter', {
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

  const validCount = project.lyrics.filter((l) => !l.skip).length

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
            </Space>
          )}
        </Space>

        <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>
          画面统一在“智能分镜”中按段落生成
        </Text>
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

                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default LyricTimeline
