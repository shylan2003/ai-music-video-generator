import React from 'react'
import { Button, Result, Space, Typography } from 'antd'

interface Props {
  children: React.ReactNode
}

interface State {
  error?: Error
}

class AppErrorBoundary extends React.Component<Props, State> {
  state: State = {}

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[renderer] uncaught render error', error, info)
  }

  private returnToEditor = () => {
    this.setState({ error: undefined })
  }

  render() {
    if (!this.state.error) {
      return this.props.children
    }

    return (
      <div style={{ width: '100vw', height: '100vh', display: 'grid', placeItems: 'center', background: '#101113' }}>
        <Result
          status="error"
          title="页面显示遇到异常"
          subTitle="当前工程仍保留在内存中。可以先返回编辑器；如果问题重复出现，请复制下方错误信息。"
          extra={
            <Space>
              <Button type="primary" onClick={this.returnToEditor}>
                返回编辑器
              </Button>
              <Button onClick={() => window.location.reload()}>
                重新载入应用
              </Button>
            </Space>
          }
        >
          <Typography.Text type="secondary" copyable style={{ maxWidth: 760 }}>
            {this.state.error.message}
          </Typography.Text>
        </Result>
      </div>
    )
  }
}

export default AppErrorBoundary
