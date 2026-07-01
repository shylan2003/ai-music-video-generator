import axios from 'axios'

export const apiClient = axios.create({
  baseURL: 'http://127.0.0.1:8000',
  timeout: 180_000,
})

let configured = false

export const configureApiClient = async () => {
  if (configured) return
  configured = true
  const config = await window.electronAPI?.getBackendConfig?.()
  if (config?.baseUrl) {
    apiClient.defaults.baseURL = config.baseUrl
  }
  if (config?.token) {
    apiClient.defaults.headers.common['X-Music-Video-Token'] = config.token
  }
}

