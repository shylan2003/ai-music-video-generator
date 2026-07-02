export const validateKlingCredential = (credential: string): string | null => {
  const value = credential.trim()
  if (!value) {
    return 'Kling 需要填写以 api-key-kling- 开头的新版 API Key'
  }

  if (/^api-key-kling-[A-Za-z0-9_-]{20,}$/.test(value)) {
    return null
  }

  return 'Kling API Key 格式错误：必须以 api-key-kling- 开头，请从 Kling 开放平台重新复制'
}
