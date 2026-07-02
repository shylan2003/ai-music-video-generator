import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: '#8b5cf6',
          colorBgBase: '#101113',
          colorBgContainer: '#16171b',
          colorBgElevated: '#1d1f25',
          colorBorder: '#2b2f38',
          colorText: '#e6e8ec',
          colorTextSecondary: '#9aa3af',
          colorTextTertiary: '#6f7785',
          borderRadius: 8,
          fontFamily: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
        },
        components: {
          Layout: {
            siderBg: '#16171b',
            headerBg: '#141519',
            bodyBg: '#101113',
          },
        },
      }}
    >
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </ConfigProvider>
  </React.StrictMode>
)
