import React, { useEffect, useState } from 'react'
import { Button, Input, Modal, Progress, Radio, Space, Switch, Tooltip, Typography, message } from 'antd'

import {
  ArrowLeftOutlined,
  PlayCircleOutlined,
  ExportOutlined,
  SaveOutlined,
  SettingOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons'
import { useAppStore, Project, Scene } from '../store/useAppStore'

import ImportPanel from '../components/ImportPanel/ImportPanel'
import LyricTimeline from '../components/Timeline/LyricTimeline'
import StyleSelector from '../components/StyleSelector/StyleSelector'
import PreviewPanel from '../components/Preview/PreviewPanel'
import StoryboardPanel from '../components/Storyboard/StoryboardPanel'
import { normalizeLoadedProject } from '../utils/projectFile'

const { Text } = Typography

const sanitizeFileName = (value: string) =>
  value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || '未命名项目'

const serializeProject = (project: Project) => ({
  ...project,
  musicFile: undefined,
  createdAt:
    project.createdAt instanceof Date
      ? project.createdAt.toISOString()
      : new Date(project.createdAt).toISOString(),
})

const downloadJsonFile = (fileName: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}

const EditorPage: React.FC = () => {
  const { project, videoSettings, setCurrentPage, setProject, loadProject, addGenerationLog, backendStatus } = useAppStore()
  const [leftPanelTab, setLeftPanelTab] = useState<'import' | 'style'>('import')
  const [centerTab, setCenterTab] = useState<'lyrics' | 'storyboard'>('lyrics')
  const [selectedSceneIndex, setSelectedSceneIndex] = useState<number | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isPreviewVisible, setIsPreviewVisible] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportLyricsEnabled, setExportLyricsEnabled] = useState(true)
  const [exportMessage, setExportMessage] = useState('等待开始导出')
  const [previewWidth, setPreviewWidth] = useState(360)
  const [draftProjectName, setDraftProjectName] = useState(project.name)
  const [draftPreviewWidth, setDraftPreviewWidth] = useState(360)



  const statusConfig = {
    online: { color: '#4ade80', text: '后端已连接' },
    offline: { color: '#f87171', text: '后端未连接' },
    connecting: { color: '#fb923c', text: '连接中...' },
  }

  useEffect(() => {
    setDraftProjectName(project.name)
  }, [project.name])

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onExportProgress((payload) => {
      setExportProgress(payload.progress)
      setExportMessage(payload.message)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const handleSceneSelect = (scene: Scene) => {

    setSelectedSceneIndex(scene.scene_index)
  }

  const handleSaveProject = () => {
    const serializedProject = serializeProject(project)
    const fileName = `${sanitizeFileName(project.name)}.mv-project.json`

    try {
      localStorage.setItem(`music-video-project:${project.id}`, JSON.stringify(serializedProject))
    } catch {
      message.warning('本地草稿缓存失败，但仍会继续下载项目文件')
    }

    downloadJsonFile(fileName, {
      ...serializedProject,
      savedAt: new Date().toISOString(),
      note: project.musicFile
        ? '项目 JSON 不包含本地音频二进制内容，重新打开项目后请重新导入音乐文件。'
        : undefined,
    })

    message.success(
      project.musicFile
        ? '项目已保存，且已下载 JSON 文件；重新打开时请重新导入音频'
        : '项目已保存，且已下载 JSON 文件'
    )
  }

  const handleOpenProject = async () => {
    if (!window.electronAPI?.openFile || !window.electronAPI.readTextFile) {
      message.error('当前环境不支持打开本地项目文件，请在 Electron 桌面版中使用')
      return
    }

    const result = await window.electronAPI.openFile({
      title: '打开 MV 项目',
      filters: [{ name: 'MV Project', extensions: ['json'] }],
      properties: ['openFile'],
    })

    if (result?.canceled || !result?.filePaths?.[0]) {
      return
    }

    try {
      const fileText = await window.electronAPI.readTextFile(result.filePaths[0])
      const loadedProject = normalizeLoadedProject(JSON.parse(fileText))
      loadProject(loadedProject)
      setSelectedSceneIndex(null)
      setCenterTab(loadedProject.scenes.length > 0 ? 'storyboard' : 'lyrics')
      message.success('项目已打开；如需导出，请重新导入本地音乐文件')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '项目打开失败')
    }
  }

  const handleOpenSettings = () => {
    setDraftProjectName(project.name)
    setDraftPreviewWidth(previewWidth)
    setIsSettingsOpen(true)
  }

  const handleApplySettings = () => {
    setProject({
      name: draftProjectName.trim() || '未命名项目',
    })
    setPreviewWidth(draftPreviewWidth)
    setIsSettingsOpen(false)
    message.success('设置已应用')
  }

  const handleTogglePreview = () => {
    const nextVisible = !isPreviewVisible
    setIsPreviewVisible(nextVisible)

    if (nextVisible && project.scenes.length > 0) {
      setCenterTab('storyboard')
    }

    message.info(nextVisible ? '已显示右侧实时预览' : '已收起右侧实时预览')
  }

  const handleExportMv = async () => {
    if (!project.musicName) {
      message.warning('请先导入音乐文件后再导出')
      return
    }

    if (!project.musicFilePath) {
      message.warning('当前未拿到原始音频路径，请重新导入本地音乐文件后再导出')
      return
    }

    if (/\.mgg1?$/i.test(project.musicFilePath)) {
      message.warning('mgg / mgg1 仍无法直接导出，请先转换为 MP3 后再导出')
      return
    }

    if (project.scenes.length === 0) {
      message.warning('请先生成智能分镜后再导出')
      return
    }

    const invalidScene = project.scenes.find((scene) => !scene.image_url)
    if (invalidScene) {
      message.warning(`镜头 ${invalidScene.scene_index + 1} 缺少图片，暂时无法导出`)
      return
    }

    if (!window.electronAPI?.saveFile || !window.electronAPI.exportVideo) {
      message.error('当前环境不支持本地视频导出，请在 Electron 桌面版中使用')
      return
    }

    const saveResult = await window.electronAPI.saveFile({
      title: '导出 MV',
      defaultPath: `${sanitizeFileName(project.name)}.mp4`,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })

    if (saveResult?.canceled || !saveResult?.filePath) {
      return
    }

    const startedAt = Date.now()
    try {
      setIsExporting(true)
      setExportProgress(1)
      setExportMessage('正在准备导出任务...')

      const result = await window.electronAPI.exportVideo({
        audioPath: project.musicFilePath,
        outputPath: saveResult.filePath,
        duration:
          project.duration ??
          project.scenes[project.scenes.length - 1]?.end_time ??
          project.lyrics[project.lyrics.length - 1]?.time ??
          240,
        width: 1280,
        height: 720,
        fps: 30,
        motion:
          videoSettings.provider === 'local_motion'
            ? videoSettings.motionStrength
            : 'none',
        subtitles: {
          enabled: exportLyricsEnabled,
        },
        lyrics: project.lyrics
          .filter((line) => !line.skip && line.text.trim())
          .sort((a, b) => a.time - b.time)
          .map((line) => ({
            id: line.id,
            time: line.time,
            text: line.text,
          })),
        scenes: [...project.scenes]
          .sort((a, b) => a.start_time - b.start_time)
          .map((scene) => ({
            scene_index: scene.scene_index,
            title: scene.title,
            start_time: scene.start_time,
            end_time: scene.end_time,
            image_url: scene.image_url,
            video_url: scene.video_url,
            camera_motion: scene.camera_motion,
          })),
      })

      setExportProgress(100)
      addGenerationLog({
        type: 'export',
        status: 'success',
        title: '导出 MV',
        provider: 'ffmpeg',
        model: videoSettings.provider,
        message: `已导出到 ${result.outputPath}；${project.scenes.length} 个镜头；字幕${exportLyricsEnabled ? '已开启' : '已关闭'}`,
        durationMs: Date.now() - startedAt,
      })
      setExportMessage('视频导出完成')
      message.success('MV 导出成功')
      Modal.success({
        title: '导出完成',
        content: `MV 已导出到：${result.outputPath}`,
        okText: '知道了',
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '视频导出失败，请稍后重试'
      addGenerationLog({
        type: 'export',
        status: 'error',
        title: '导出 MV 失败',
        provider: 'ffmpeg',
        model: videoSettings.provider,
        message: `${project.scenes.length} 个镜头；字幕${exportLyricsEnabled ? '已开启' : '已关闭'}`,
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      })
      message.error(errorMessage)
    } finally {
      setIsExporting(false)
    }
  }


  return (
    <div className="workspace-shell">
      <div className="workspace-topbar">
        <div className="workspace-brand">
          <Tooltip title="返回首页">
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => setCurrentPage('home')}
              style={{ color: 'var(--app-text-muted)' }}
            />
          </Tooltip>
          <div className="workspace-logo">MV</div>
          <div className="workspace-title">
            <div className="workspace-title-main">{project.name}</div>
            <div className="workspace-title-sub">{project.musicName || '未导入音乐'}</div>
          </div>
        </div>

        <div className="workspace-center-status">
          <div className="status-pill">
            <span className="status-dot" style={{ background: statusConfig[backendStatus].color }} />
            {statusConfig[backendStatus].text}
          </div>
          <div className="status-pill">{project.lyrics.filter((line) => !line.skip).length} 行有效歌词</div>
          <div className="status-pill">{project.scenes.length} 个画面</div>
        </div>

        <div className="workspace-actions">
          <Tooltip title="打开项目">
            <Button type="text" icon={<FolderOpenOutlined />} onClick={handleOpenProject} style={{ color: 'var(--app-text-muted)' }} />
          </Tooltip>
          <Tooltip title="保存项目">
            <Button type="text" icon={<SaveOutlined />} onClick={handleSaveProject} style={{ color: 'var(--app-text-muted)' }} />
          </Tooltip>
          <Tooltip title="编辑器设置">
            <Button type="text" icon={<SettingOutlined />} onClick={handleOpenSettings} style={{ color: 'var(--app-text-muted)' }} />
          </Tooltip>
          <Button icon={<PlayCircleOutlined />} onClick={handleTogglePreview}>
            {isPreviewVisible ? '收起预览' : '显示预览'}
          </Button>
          <Button type="primary" icon={<ExportOutlined />} onClick={handleExportMv}>
            导出 MV
          </Button>
        </div>
      </div>

      <div
        className={`workspace-body${isPreviewVisible ? '' : ' preview-hidden'}`}
        style={{
          gridTemplateColumns: isPreviewVisible
            ? `var(--app-sidebar) minmax(500px, 1fr) minmax(320px, ${previewWidth}px)`
            : 'var(--app-sidebar) minmax(500px, 1fr) 0',
        }}
      >
        <aside className="workspace-panel">
          <div className="tab-strip">
            {[{ key: 'import', label: '素材' }, { key: 'style', label: '风格与模型' }].map((tab) => (
              <div
                key={tab.key}
                className={`tab-button${leftPanelTab === tab.key ? ' active' : ''}`}
                onClick={() => setLeftPanelTab(tab.key as 'import' | 'style')}
              >
                {tab.label}
              </div>
            ))}
          </div>
          <div className="panel-scroll">
            {leftPanelTab === 'import' && <ImportPanel />}
            {leftPanelTab === 'style' && <StyleSelector />}
          </div>
        </aside>

        <main className="workspace-main">
          <div className="tab-strip">
            {[
              { key: 'lyrics', label: '歌词时间轴' },
              { key: 'storyboard', label: '智能分镜', badge: project.scenes.length },
            ].map((tab) => (
              <div
                key={tab.key}
                className={`tab-button${centerTab === tab.key ? ' active' : ''}`}
                onClick={() => setCenterTab(tab.key as 'lyrics' | 'storyboard')}
                style={{ flex: '0 0 auto', padding: '0 16px' }}
              >
                {tab.label}
                {tab.badge ? <span className="tab-badge">{tab.badge}</span> : null}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {centerTab === 'lyrics' && <LyricTimeline />}
            {centerTab === 'storyboard' && (
              <StoryboardPanel
                onSceneSelect={handleSceneSelect}
                selectedSceneIndex={selectedSceneIndex}
              />
            )}
          </div>
        </main>

        {isPreviewVisible && (
          <aside className="workspace-panel right">
            <PreviewPanel selectedSceneIndex={selectedSceneIndex} />
          </aside>
        )}
      </div>

      <Modal
        title="编辑器设置"
        open={isSettingsOpen}
        onOk={handleApplySettings}
        onCancel={() => setIsSettingsOpen(false)}
        okText="应用"
        cancelText="取消"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
          <div>
            <Text style={{ color: '#475569', fontSize: 12, display: 'block', marginBottom: 8 }}>
              项目名称
            </Text>
            <Input
              value={draftProjectName}
              onChange={(event) => setDraftProjectName(event.target.value)}
              placeholder="请输入项目名称"
              maxLength={40}
            />
          </div>

          <div>
            <Text style={{ color: '#475569', fontSize: 12, display: 'block', marginBottom: 8 }}>
              右侧预览面板宽度
            </Text>
            <Radio.Group
              value={draftPreviewWidth}
              onChange={(event) => setDraftPreviewWidth(event.target.value)}
            >
              <Space direction="vertical">
                <Radio value={320}>紧凑</Radio>
                <Radio value={360}>标准</Radio>
                <Radio value={440}>宽屏</Radio>
              </Space>
            </Radio.Group>
          </div>

          <div>
            <Text style={{ color: '#475569', fontSize: 12, display: 'block', marginBottom: 8 }}>
              导出歌词字幕
            </Text>
            <Switch
              checked={exportLyricsEnabled}
              onChange={setExportLyricsEnabled}
              checkedChildren="开启"
              unCheckedChildren="关闭"
            />
          </div>

          <Text style={{ color: '#94a3b8', fontSize: 12 }}>
            保存项目会导出当前工程 JSON；导出 MV 会调用本地 ffmpeg 生成真实 mp4 文件。
          </Text>
        </div>
      </Modal>

      <Modal
        title="正在导出 MV"
        open={isExporting}
        footer={null}
        closable={false}
        maskClosable={false}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <Progress percent={Math.max(0, Math.min(100, exportProgress))} status="active" />
          <Text style={{ color: '#475569', fontSize: 12 }}>{exportMessage}</Text>
          <Text style={{ color: '#94a3b8', fontSize: 12 }}>
            正在缓存镜头画面并调用 ffmpeg 合成视频，请耐心等待。
          </Text>
        </div>
      </Modal>
    </div>
  )
}



export default EditorPage
