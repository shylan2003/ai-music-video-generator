import React, { useEffect, useRef } from 'react'
import { useAppStore } from './store/useAppStore'
import HomePage from './pages/HomePage'
import EditorPage from './pages/EditorPage'
import { apiClient, configureApiClient } from './api/client'

const App: React.FC = () => {
  const {
    currentPage,
    directorSettings,
    imageSettings,
    videoSettings,
    modelTemplates,
    setBackendStatus,
    setImageSettings,
    setDirectorSettings,
    setVideoSettings,
    setModelTemplates,
  } = useAppStore()
  const modelSettingsLoadedRef = useRef(false)

  // 检测后端状态
  useEffect(() => {
    const checkBackend = async () => {
      try {
        await configureApiClient()
        await apiClient.get('/health', { timeout: 3000 })
        setBackendStatus('online')
      } catch {
        setBackendStatus('offline')
      }
    }
    checkBackend()
    const interval = setInterval(checkBackend, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    let disposed = false

    const loadModelSettings = async () => {
      if (!window.electronAPI?.loadModelSettings) {
        modelSettingsLoadedRef.current = true
        return
      }

      try {
        const settings = await window.electronAPI.loadModelSettings()
        if (disposed) {
          return
        }

        if (settings.directorSettings) {
          setDirectorSettings(settings.directorSettings)
        }
        if (settings.imageSettings) {
          setImageSettings(settings.imageSettings)
        }
        if (settings.videoSettings) {
          setVideoSettings(settings.videoSettings)
        }
        if (settings.modelTemplates) {
          setModelTemplates(settings.modelTemplates)
        }
      } finally {
        if (!disposed) {
          modelSettingsLoadedRef.current = true
        }
      }
    }

    loadModelSettings()

    return () => {
      disposed = true
    }
  }, [setDirectorSettings, setImageSettings, setModelTemplates, setVideoSettings])

  useEffect(() => {
    if (!modelSettingsLoadedRef.current || !window.electronAPI?.saveModelSettings) {
      return
    }

    const timer = window.setTimeout(() => {
      window.electronAPI?.saveModelSettings({
        directorSettings,
        imageSettings,
        videoSettings,
        modelTemplates,
      }).catch(() => {
        // Keeping model settings in memory is still usable if local persistence fails.
      })
    }, 500)

    return () => window.clearTimeout(timer)
  }, [directorSettings, imageSettings, modelTemplates, videoSettings])

  return (
    <div style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {currentPage === 'home' && <HomePage />}
      {currentPage === 'editor' && <EditorPage />}
    </div>
  )
}

export default App
