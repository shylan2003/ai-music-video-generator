import React from 'react'
import { Button, Typography, Space, Badge, message } from 'antd'
import {
  PlusOutlined,
  FolderOpenOutlined,
  ThunderboltOutlined,
  PictureOutlined,
  ExportOutlined,
} from '@ant-design/icons'
import { useAppStore } from '@/store/useAppStore'
import { normalizeLoadedProject } from '@/utils/projectFile'

const { Title, Text } = Typography

const workflowItems = [
  { icon: <FolderOpenOutlined />, title: '导入素材', desc: '添加音乐文件与 LRC / TXT 歌词' },
  { icon: <ThunderboltOutlined />, title: '生成画面', desc: '选择模型后按歌词生成连贯图片' },
  { icon: <PictureOutlined />, title: '预览校对', desc: '检查歌词、画面与时间轴同步' },
  { icon: <ExportOutlined />, title: '导出视频', desc: '调用本地 ffmpeg 合成 MP4' },
]

const HomePage: React.FC = () => {
  const { setCurrentPage, resetProject, loadProject } = useAppStore()

  const handleNewProject = () => {
    resetProject()
    setCurrentPage('editor')
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
      loadProject(normalizeLoadedProject(JSON.parse(fileText)))
      setCurrentPage('editor')
      message.success('项目已打开；如需导出，请重新导入本地音乐文件')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '项目打开失败')
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--app-bg)',
        color: 'var(--app-text)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        style={{
          height: 58,
          padding: '0 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid var(--app-border)',
          background: '#141519',
        }}
      >
        <div className="workspace-brand">
          <div className="workspace-logo">MV</div>
          <div className="workspace-title">
            <div className="workspace-title-main">AI Music Video Generator</div>
            <div className="workspace-title-sub">歌词驱动的音乐视频工作台</div>
          </div>
        </div>
        <Badge
          color="var(--app-accent-2)"
          text={<Text style={{ color: 'var(--app-text-muted)', fontSize: 12 }}>本地工作区</Text>}
        />
      </header>

      <main
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(360px, 520px) minmax(460px, 1fr)',
          gap: 28,
          width: '100%',
          maxWidth: 1180,
          margin: '0 auto',
          padding: '56px 32px',
          alignItems: 'start',
        }}
      >
        <section>
          <Text style={{ color: 'var(--app-text-subtle)', fontSize: 12, fontWeight: 600 }}>
            PROJECT LAUNCHER
          </Text>
          <Title style={{ color: 'var(--app-text)', margin: '10px 0 12px', fontSize: 34, lineHeight: 1.2 }}>
            从歌词生成同步画面的 MV 项目
          </Title>
          <Text style={{ color: 'var(--app-text-muted)', fontSize: 15, lineHeight: 1.8 }}>
            导入音乐和歌词，选择图片模型，逐句生成画面并在右侧预览校对，最后导出为本地 MP4。
          </Text>

          <Space size={10} style={{ marginTop: 28 }}>
            <Button type="primary" size="large" icon={<PlusOutlined />} onClick={handleNewProject}>
              新建项目
            </Button>
            <Button size="large" icon={<FolderOpenOutlined />} onClick={handleOpenProject}>
              打开项目
            </Button>
          </Space>
        </section>

        <section
          className="panel-section"
          style={{
            padding: 18,
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 12,
          }}
        >
          {workflowItems.map((item) => (
            <div
              key={item.title}
              className="glass-card"
              style={{
                padding: 16,
                minHeight: 132,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: '#252936',
                  color: 'var(--app-accent-2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 17,
                }}
              >
                {item.icon}
              </div>
              <Text style={{ color: 'var(--app-text)', fontSize: 14, fontWeight: 600 }}>
                {item.title}
              </Text>
              <Text style={{ color: 'var(--app-text-subtle)', fontSize: 12, lineHeight: 1.7 }}>
                {item.desc}
              </Text>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}

export default HomePage
