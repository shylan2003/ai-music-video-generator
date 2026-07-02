import React, { useState } from 'react'
import { Button, Divider, Form, Input, Modal, Select, Space, Tag, Typography, message } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { ImageProvider, ModelTemplate, VideoProvider, useAppStore } from '@/store/useAppStore'

const { Text, Title } = Typography

const styles = [
  {
    id: 'auto',
    name: 'AI 自动判断',
    desc: '根据歌词类型、时代、情绪和叙事结构自动建立视觉圣经',
    gradient: 'linear-gradient(135deg, #312e81, #7c3aed, #0891b2)',
    accent: '#c4b5fd',
    tag: '默认',
  },
  {
    id: 'cinematic',
    name: '电影质感',
    desc: '电影级色调，光影丰富',
    gradient: 'linear-gradient(135deg, #1a1a2e, #16213e)',
    accent: '#4fc3f7',
    tag: '推荐',
  },
  {
    id: 'ornate_gufeng',
    name: '华丽古风',
    desc: '金箔丝绸，宫灯飞花，盛唐气韵',
    gradient: 'linear-gradient(135deg, #3b1d0f, #7f1d1d, #d97706)',
    accent: '#fbbf24',
    tag: '古风',
  },
  {
    id: 'song_landscape',
    name: '宋韵山水',
    desc: '淡雅青绿，江月烟雨，文人画意',
    gradient: 'linear-gradient(135deg, #10231f, #315346, #9ca986)',
    accent: '#a7f3d0',
    tag: '',
  },
  {
    id: 'tang_mural',
    name: '唐风壁画',
    desc: '敦煌矿物色，飞天纹样，壁画质感',
    gradient: 'linear-gradient(135deg, #4a2511, #9a3412, #f59e0b)',
    accent: '#fdba74',
    tag: '',
  },
  {
    id: 'xianxia',
    name: '唯美仙侠',
    desc: '云雾仙山，流光衣袂，空灵奇幻',
    gradient: 'linear-gradient(135deg, #172554, #581c87, #e0e7ff)',
    accent: '#c4b5fd',
    tag: '',
  },
  {
    id: 'guofeng_cinematic',
    name: '国风电影',
    desc: '写实古建，诗意调色，电影构图',
    gradient: 'linear-gradient(135deg, #111827, #374151, #b45309)',
    accent: '#d1d5db',
    tag: '',
  },
  {
    id: 'stage_opera',
    name: '戏曲舞台',
    desc: '戏台灯光，水袖妆容，符号化场景',
    gradient: 'linear-gradient(135deg, #111827, #7f1d1d, #ef4444)',
    accent: '#fca5a5',
    tag: '',
  },
  {
    id: 'cyberpunk',
    name: '赛博朋克',
    desc: '霓虹灯光，未来都市',
    gradient: 'linear-gradient(135deg, #0d0221, #1a0533)',
    accent: '#ff0099',
    tag: '热门',
  },
  {
    id: 'inkwash',
    name: '水墨风',
    desc: '中国水墨，意境悠远',
    gradient: 'linear-gradient(135deg, #1a1a1a, #2d2d2d)',
    accent: '#e8d5b7',
    tag: '',
  },
  {
    id: 'anime',
    name: '动漫风',
    desc: '日系动漫，清新唯美',
    gradient: 'linear-gradient(135deg, #1a1030, #2d1b4e)',
    accent: '#ff9ecd',
    tag: '',
  },
  {
    id: 'realistic',
    name: '写实摄影',
    desc: '真实场景，自然光影',
    gradient: 'linear-gradient(135deg, #0f1923, #1a2744)',
    accent: '#7eb8f7',
    tag: '',
  },
  {
    id: 'abstract',
    name: '抽象艺术',
    desc: '几何色块，现代抽象',
    gradient: 'linear-gradient(135deg, #0a0a1a, #1a0a2e)',
    accent: '#c084fc',
    tag: '新',
  },
  {
    id: 'dark_fantasy',
    name: '暗黑奇幻',
    desc: '月光雾气，强烈明暗，史诗氛围',
    gradient: 'linear-gradient(135deg, #030712, #312e81, #111827)',
    accent: '#818cf8',
    tag: '',
  },
  {
    id: 'retro_film',
    name: '复古胶片',
    desc: '暖色颗粒，旧镜头，怀旧音乐影像',
    gradient: 'linear-gradient(135deg, #292524, #854d0e, #fef3c7)',
    accent: '#facc15',
    tag: '',
  },
  {
    id: 'stage_lighting',
    name: '舞台灯光',
    desc: '光束烟雾，剪影表演，演唱会质感',
    gradient: 'linear-gradient(135deg, #111827, #0f766e, #8b5cf6)',
    accent: '#5eead4',
    tag: '',
  },
]

const providerOptions: Array<{
  value: ImageProvider
  label: string
  desc: string
  defaultModel: string
  requiresKey: boolean
}> = [
  {
    value: 'tongyi',
    label: '通义万相（默认）',
    desc: '国内稳定图片生成，支持角色定妆照参考图',
    defaultModel: 'wan2.6-image',
    requiresKey: true,
  },
  {
    value: 'pollinations',
    label: 'Pollinations 免费',
    desc: '免费社区生图，默认无需密钥；服务拥挤时可能较慢',
    defaultModel: 'flux',
    requiresKey: false,
  },
  {
    value: 'openai',
    label: 'OpenAI 付费',
    desc: '质量更稳，需要 OpenAI API Key',
    defaultModel: 'gpt-image-2',
    requiresKey: true,
  },
  {
    value: 'custom',
    label: '自定义兼容接口',
    desc: '兼容 OpenAI Images API 的服务，需要 Base URL 和 API Key',
    defaultModel: 'gpt-image-2',
    requiresKey: true,
  },
  {
    value: 'placeholder',
    label: '免费占位图',
    desc: '不调用 AI，只用于测试时间轴和导出流程',
    defaultModel: 'placeholder',
    requiresKey: false,
  },
]

const providerModelOptions: Record<ImageProvider, Array<{ label: string; value: string }>> = {
  tongyi: [
    { label: 'Wan 2.6 Image', value: 'wan2.6-image' },
  ],
  pollinations: [
    { label: 'Flux', value: 'flux' },
    { label: 'Turbo', value: 'turbo' },
  ],
  openai: [
    { label: 'GPT Image 2', value: 'gpt-image-2' },
  ],
  custom: [
    { label: 'GPT Image 2', value: 'gpt-image-2' },
  ],
  placeholder: [
    { label: 'Placeholder', value: 'placeholder' },
  ],
}

const sizeOptions = [
  { label: '16:9 1280x720', value: '1280x720' },
  { label: '16:9 1536x864', value: '1536x864' },
  { label: '4:3 1536x1024', value: '1536x1024' },
  { label: '1:1 1024x1024', value: '1024x1024' },
]

const qualityOptions = [
  { label: '标准', value: 'medium' },
  { label: '高质量', value: 'high' },
  { label: '低成本/快速', value: 'low' },
]

const videoProviderOptions: Array<{
  value: VideoProvider
  label: string
  desc: string
  defaultModel: string
  requiresKey: boolean
}> = [
  {
    value: 'local_motion',
    label: '本地动态（仅旧工程预览）',
    desc: '全云端正式导出不接受本地动态，请改选云端提供商',
    defaultModel: 'ken-burns',
    requiresKey: false,
  },
  {
    value: 'kling',
    label: 'Kling 付费',
    desc: '支持开放平台新版 API Key，也兼容旧版 AccessKey 与 SecretKey',
    defaultModel: 'kling-v2-5-turbo',
    requiresKey: true,
  },
  {
    value: 'runway',
    label: 'Runway 付费',
    desc: '适合电影镜头运动和图生视频，需要 API Key',
    defaultModel: 'gen4_turbo',
    requiresKey: true,
  },
  {
    value: 'luma',
    label: 'Luma 付费',
    desc: '适合 Dream Machine 图生视频，需要 API Key',
    defaultModel: 'ray-2',
    requiresKey: true,
  },
  {
    value: 'custom',
    label: '自定义视频接口',
    desc: '预留给兼容接口，需要 Base URL 和 API Key',
    defaultModel: 'custom-video',
    requiresKey: true,
  },
  {
    value: 'none',
    label: '静态图片',
    desc: '保持图片静止，适合最快导出和调试',
    defaultModel: 'static',
    requiresKey: false,
  },
]

const videoModelOptions: Record<VideoProvider, Array<{ label: string; value: string }>> = {
  local_motion: [{ label: 'Ken Burns 本地运动', value: 'ken-burns' }],
  kling: [
    { label: 'Kling 1.6', value: 'kling-v1-6' },
    { label: 'Kling 2.1', value: 'kling-v2-1' },
    { label: 'Kling 2.5 Turbo', value: 'kling-v2-5-turbo' },
  ],
  runway: [
    { label: 'Runway Gen-4 Turbo', value: 'gen4_turbo' },
    { label: 'Runway Gen-3 Alpha Turbo', value: 'gen3a_turbo' },
  ],
  luma: [
    { label: 'Luma Ray 2', value: 'ray-2' },
    { label: 'Luma Ray Flash 2', value: 'ray-flash-2' },
  ],
  custom: [{ label: 'Custom Video', value: 'custom-video' }],
  none: [{ label: 'Static', value: 'static' }],
}

const motionStrengthOptions = [
  { label: '轻微', value: 'subtle' },
  { label: '标准', value: 'standard' },
  { label: '强烈', value: 'dramatic' },
]

const StyleSelector: React.FC = () => {
  const {
    project,
    directorSettings,
    imageSettings,
    videoSettings,
    modelTemplates,
    setStyle,
    setProject,
    setDirectorSettings,
    setImageSettings,
    setVideoSettings,
    addModelTemplate,
    removeModelTemplate,
  } = useAppStore()
  const [isTemplateModalOpen, setTemplateModalOpen] = useState(false)
  const [templateForm] = Form.useForm<Omit<ModelTemplate, 'id'>>()
  const currentProvider = providerOptions.find((provider) => provider.value === imageSettings.provider) ?? providerOptions[0]
  const currentVideoProvider =
    videoProviderOptions.find((provider) => provider.value === videoSettings.provider) ?? videoProviderOptions[0]
  const imageTemplates = modelTemplates.filter((template) => template.kind === 'image')
  const videoTemplates = modelTemplates.filter((template) => template.kind === 'video')

  const invalidateProviderLock = () => {
    setProject({
      generationPolicy: {
        ...project.generationPolicy,
        test_approved: false,
        provider_locked: false,
        test_scene_indexes: [],
      },
    })
  }

  const handleProviderChange = (provider: ImageProvider) => {
    const nextProvider = providerOptions.find((item) => item.value === provider) ?? providerOptions[0]
    setImageSettings({
      provider,
      model: nextProvider.defaultModel,
      baseUrl:
        provider === 'custom'
          ? imageSettings.baseUrl
          : provider === 'tongyi'
            ? 'https://dashscope.aliyuncs.com/api/v1'
            : '',
      apiKey: '',
    })
    invalidateProviderLock()
  }

  const handleVideoProviderChange = (provider: VideoProvider) => {
    const nextProvider = videoProviderOptions.find((item) => item.value === provider) ?? videoProviderOptions[0]
    setVideoSettings({
      provider,
      model: nextProvider.defaultModel,
      baseUrl: provider === 'custom' ? videoSettings.baseUrl : '',
      apiKey: '',
    })
    invalidateProviderLock()
  }

  const applyTemplate = (templateId: string) => {
    const template = modelTemplates.find((item) => item.id === templateId)
    if (!template) {
      return
    }

    if (template.kind === 'image') {
      setImageSettings({
        provider: template.provider as ImageProvider,
        model: template.model,
        baseUrl: template.baseUrl || '',
      })
    } else {
      setVideoSettings({
        provider: template.provider as VideoProvider,
        model: template.model,
        baseUrl: template.baseUrl || '',
      })
    }

    invalidateProviderLock()

    message.success('模型模板已应用')
  }

  const handleCreateTemplate = async () => {
    const values = await templateForm.validateFields()
    addModelTemplate({
      ...values,
      requiresKey: Boolean(values.requiresKey),
    })
    templateForm.resetFields()
    setTemplateModalOpen(false)
    message.success('模型模板已添加')
  }

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Title level={5} className="section-title">
        视频风格
      </Title>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {styles.map((style) => (
          <div
            key={style.id}
            onClick={() => setStyle(style.id)}
            style={{
              borderRadius: 10,
              overflow: 'hidden',
              cursor: 'pointer',
              background: 'var(--app-surface-raised)',
              border:
                project.style === style.id
                  ? `1px solid ${style.accent}66`
                  : '1px solid var(--app-border)',
              transition: 'all 0.2s',
              position: 'relative',
            }}
          >
            <div
              style={{
                background: 'transparent',
                padding: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: style.gradient,
                  border: `1px solid ${style.accent}55`,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: 'var(--app-text)', fontSize: 13, fontWeight: 600 }}>
                    {style.name}
                  </Text>
                  {style.tag && (
                    <Tag
                      style={{
                        fontSize: 10,
                        padding: '0 6px',
                        lineHeight: '16px',
                        height: 16,
                        background: `${style.accent}22`,
                        border: `1px solid ${style.accent}55`,
                        color: style.accent,
                        borderRadius: 4,
                        margin: 0,
                      }}
                    >
                      {style.tag}
                    </Tag>
                  )}
                </div>
                <Text style={{ color: 'var(--app-text-subtle)', fontSize: 11 }}>{style.desc}</Text>
              </div>

              {project.style === style.id && (
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    background: style.accent,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CheckOutlined style={{ fontSize: 11, color: '#000' }} />
                </div>
              )}
            </div>

            {project.style === style.id && (
              <div
                style={{
                  height: 2,
                  background: `linear-gradient(90deg, transparent, ${style.accent}, transparent)`,
                }}
              />
            )}
          </div>
        ))}
      </div>

      <Divider style={{ margin: '2px 0', borderColor: 'var(--app-border)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Title level={5} className="section-title">
          AI 导演
        </Title>
        <div className="glass-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Select
            value={directorSettings.provider}
            onChange={(provider) => setDirectorSettings({ provider })}
            options={[
              { label: 'DeepSeek 整曲导演（推荐）', value: 'deepseek' },
              { label: '本地规则分镜', value: 'rules' },
            ]}
          />
          {directorSettings.provider === 'deepseek' && (
            <>
              <Input
                value={directorSettings.model}
                onChange={(event) => setDirectorSettings({ model: event.target.value })}
                placeholder="deepseek-chat"
              />
              <Input
                value={directorSettings.baseUrl}
                onChange={(event) => setDirectorSettings({ baseUrl: event.target.value })}
                placeholder="https://api.deepseek.com/v1"
              />
              <Input.Password
                value={directorSettings.apiKey}
                onChange={(event) => setDirectorSettings({ apiKey: event.target.value })}
                placeholder="DeepSeek API Key"
              />
            </>
          )}
          <Text style={{ color: '#64748b', fontSize: 11, lineHeight: 1.6 }}>
            分镜阶段只生成角色设定和提示词，不会调用收费图片接口。
          </Text>
        </div>
      </div>

      <Divider style={{ margin: '2px 0', borderColor: 'var(--app-border)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Title level={5} className="section-title" style={{ margin: 0 }}>
            模型市场
          </Title>
          <Button size="small" onClick={() => setTemplateModalOpen(true)}>
            新增模板
          </Button>
        </div>

        <div className="glass-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
              图片模型模板
            </Text>
            <Select
              placeholder="选择并应用图片模板"
              options={imageTemplates.map((template) => ({
                label: template.name,
                value: template.id,
              }))}
              onChange={applyTemplate}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
              视频模型模板
            </Text>
            <Select
              placeholder="选择并应用视频模板"
              options={videoTemplates.map((template) => ({
                label: template.name,
                value: template.id,
              }))}
              onChange={applyTemplate}
              style={{ width: '100%' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {modelTemplates.slice(0, 8).map((template) => (
              <div
                key={template.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: 'var(--app-surface)',
                  border: '1px solid var(--app-border)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Text style={{ color: 'var(--app-text)', fontSize: 12 }} ellipsis>
                    {template.name}
                  </Text>
                  <Text style={{ color: 'var(--app-text-subtle)', fontSize: 10, display: 'block' }} ellipsis>
                    {template.kind} · {template.provider} · {template.model}
                  </Text>
                </div>
                <Space size={4}>
                  <Button size="small" onClick={() => applyTemplate(template.id)}>
                    应用
                  </Button>
                  {!template.id.startsWith('image-') && !template.id.startsWith('video-') && (
                    <Button size="small" danger onClick={() => removeModelTemplate(template.id)}>
                      删除
                    </Button>
                  )}
                </Space>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Divider style={{ margin: '2px 0', borderColor: 'var(--app-border)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Title level={5} className="section-title">
          图片 AI 模型
        </Title>

        <div className="glass-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
              服务商
            </Text>
            <Select
              value={imageSettings.provider}
              onChange={handleProviderChange}
              options={providerOptions.map((provider) => ({
                label: provider.label,
                value: provider.value,
              }))}
              style={{ width: '100%' }}
            />
          </div>

          <Text style={{ color: '#64748b', fontSize: 11, lineHeight: 1.6 }}>
            {currentProvider.desc}
          </Text>

          <div>
            <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
              模型
            </Text>
            <Select
              value={imageSettings.model}
              onChange={(model) => {
                setImageSettings({ model })
                invalidateProviderLock()
              }}
              options={providerModelOptions[imageSettings.provider]}
              style={{ width: '100%' }}
            />
          </div>

          <Space size={8} style={{ width: '100%' }}>
            <div style={{ flex: 1 }}>
              <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
                尺寸
              </Text>
              <Select
                value={imageSettings.size}
                onChange={(size) => setImageSettings({ size })}
                options={sizeOptions}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
                质量
              </Text>
              <Select
                value={imageSettings.quality}
                onChange={(quality) => setImageSettings({ quality })}
                options={qualityOptions}
                disabled={imageSettings.provider === 'pollinations' || imageSettings.provider === 'placeholder'}
                style={{ width: '100%' }}
              />
            </div>
          </Space>

          {imageSettings.provider === 'custom' && (
            <div>
              <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
                Base URL
              </Text>
              <Input
                value={imageSettings.baseUrl}
                onChange={(event) => setImageSettings({ baseUrl: event.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </div>
          )}

          {(currentProvider.requiresKey || imageSettings.provider === 'pollinations') && (
            <div>
              <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
                API Key{imageSettings.provider === 'pollinations' ? '（可选）' : ''}
              </Text>
              <Input.Password
                value={imageSettings.apiKey}
                onChange={(event) => setImageSettings({ apiKey: event.target.value })}
                placeholder={currentProvider.requiresKey ? '请输入 API Key' : '免费模式可留空'}
              />
            </div>
          )}

          {currentProvider.requiresKey && !imageSettings.apiKey.trim() && (
            <Text style={{ color: '#fca5a5', fontSize: 11 }}>
              当前模型需要 API Key；未填写时后端会回退到免费/占位图。
            </Text>
          )}
        </div>
      </div>

      <Divider style={{ margin: '2px 0', borderColor: 'var(--app-border)' }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Title level={5} className="section-title">
          视频模型 / 镜头运动
        </Title>

        <div className="glass-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
              服务商
            </Text>
            <Select
              value={videoSettings.provider}
              onChange={handleVideoProviderChange}
              options={videoProviderOptions.map((provider) => ({
                label: provider.label,
                value: provider.value,
              }))}
              style={{ width: '100%' }}
            />
          </div>

          <Text style={{ color: '#64748b', fontSize: 11, lineHeight: 1.6 }}>
            {currentVideoProvider.desc}
          </Text>

          <div>
            <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
              模型
            </Text>
            <Select
              value={videoSettings.model}
              onChange={(model) => {
                setVideoSettings({ model })
                invalidateProviderLock()
              }}
              options={videoModelOptions[videoSettings.provider]}
              style={{ width: '100%' }}
            />
          </div>

          <Space size={8} style={{ width: '100%' }}>
            <div style={{ flex: 1 }}>
              <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
                运动强度
              </Text>
              <Select
                value={videoSettings.motionStrength}
                onChange={(motionStrength) => setVideoSettings({ motionStrength })}
                options={motionStrengthOptions}
                disabled={videoSettings.provider === 'none'}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
                单段时长
              </Text>
              <Select
                value={videoSettings.clipSeconds}
                onChange={(clipSeconds) => setVideoSettings({ clipSeconds })}
                options={[
                  { label: '4 秒', value: 4 },
                  { label: '6 秒', value: 6 },
                  { label: '8 秒', value: 8 },
                  { label: '10 秒', value: 10 },
                ]}
                disabled={videoSettings.provider === 'local_motion' || videoSettings.provider === 'none'}
                style={{ width: '100%' }}
              />
            </div>
          </Space>

          {videoSettings.provider === 'custom' && (
            <div>
              <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
                Base URL
              </Text>
              <Input
                value={videoSettings.baseUrl}
                onChange={(event) => setVideoSettings({ baseUrl: event.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </div>
          )}

          {currentVideoProvider.requiresKey && (
            <div>
              <Text style={{ color: '#64748b', fontSize: 12, display: 'block', marginBottom: 6 }}>
                {videoSettings.provider === 'kling' ? 'Kling 新版 API Key / 旧版凭证' : 'API Key'}
              </Text>
              <Input.Password
                value={videoSettings.apiKey}
                onChange={(event) => setVideoSettings({ apiKey: event.target.value })}
                placeholder={videoSettings.provider === 'kling' ? 'api-key-kling-... 或 AccessKey:SecretKey' : '请输入视频模型 API Key'}
              />
              {videoSettings.provider === 'kling' && (
                <Text style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.6 }}>
                  支持新版 api-key-kling-...，以及旧版 AccessKey:SecretKey / JWT；不是可灵网页会员、通义或 DeepSeek 的 Key。
                </Text>
              )}
            </div>
          )}

          {videoSettings.provider !== 'local_motion' && videoSettings.provider !== 'none' && (
            <Text style={{ color: '#22c55e', fontSize: 11, lineHeight: 1.6 }}>
              全云端模式会锁定当前提供商和模型；需先通过三镜测试，再生成全部镜头。
              {videoSettings.provider === 'luma' ? ' Luma 需要公网 HTTPS 图片，可设置 PUBLIC_BACKEND_BASE_URL。' : ''}
            </Text>
          )}

          {(videoSettings.provider === 'local_motion' || videoSettings.provider === 'none') && (
            <Text style={{ color: '#fca5a5', fontSize: 11, lineHeight: 1.6 }}>
              当前选择不能用于正式导出，请选择 Kling、Runway、Luma 或自定义云端接口。
            </Text>
          )}
        </div>
      </div>
    </div>
    <Modal
      title="新增模型模板"
      open={isTemplateModalOpen}
      onCancel={() => setTemplateModalOpen(false)}
      onOk={handleCreateTemplate}
      okText="添加"
      cancelText="取消"
    >
      <Form
        layout="vertical"
        form={templateForm}
        initialValues={{
          kind: 'image',
          provider: 'custom',
          model: 'gpt-image-2',
          requiresKey: true,
        }}
      >
        <Form.Item label="模板名称" name="name" rules={[{ required: true, message: '请输入模板名称' }]}>
          <Input placeholder="例如：我的 ComfyUI 图片接口" />
        </Form.Item>
        <Space size={10} style={{ width: '100%' }} align="start">
          <Form.Item label="类型" name="kind" style={{ flex: 1 }} rules={[{ required: true }]}>
            <Select
              options={[
                { label: '图片', value: 'image' },
                { label: '视频', value: 'video' },
              ]}
            />
          </Form.Item>
          <Form.Item label="供应商协议" name="provider" style={{ flex: 1 }} rules={[{ required: true }]}>
            <Select
              options={[
                { label: 'OpenAI-compatible 图片', value: 'custom' },
                { label: 'Pollinations 免费图片', value: 'pollinations' },
                { label: '占位图', value: 'placeholder' },
                { label: '本地动态视频', value: 'local_motion' },
                { label: 'Runway', value: 'runway' },
                { label: 'Luma', value: 'luma' },
                { label: 'Kling', value: 'kling' },
                { label: '自定义视频接口', value: 'custom' },
                { label: '关闭视频', value: 'none' },
              ]}
            />
          </Form.Item>
        </Space>
        <Form.Item label="模型 ID" name="model" rules={[{ required: true, message: '请输入模型 ID' }]}>
          <Input placeholder="例如：gpt-image-2 / gen4_turbo / kling-v1-6" />
        </Form.Item>
        <Form.Item label="Base URL" name="baseUrl">
          <Input placeholder="OpenAI-compatible: https://api.example.com/v1；自定义视频：完整接口 URL" />
        </Form.Item>
        <Form.Item label="是否需要 API Key" name="requiresKey">
          <Select
            options={[
              { label: '需要', value: true },
              { label: '不需要', value: false },
            ]}
          />
        </Form.Item>
        <Form.Item label="说明" name="description">
          <Input.TextArea rows={3} placeholder="记录这个模板怎么用，例如 Replicate/Fal/ComfyUI 需要的服务包装方式。" />
        </Form.Item>
      </Form>
    </Modal>
    </>
  )
}

export default StyleSelector


