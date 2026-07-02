export const validateKlingCredential = (credential: string): string | null => {
  const value = credential.trim()
  if (!value) {
    return 'Kling 需要填写新版 API Key，或旧版 AccessKey:SecretKey / JWT Token'
  }

  if (/^api-key-kling-[A-Za-z0-9_-]{20,}$/.test(value)) {
    return null
  }

  if (value.includes(':')) {
    const separator = value.indexOf(':')
    const accessKey = value.slice(0, separator).trim()
    const secretKey = value.slice(separator + 1).trim()
    return accessKey && secretKey
      ? null
      : 'Kling 凭证格式错误：冒号前后必须分别填写 AccessKey 和 SecretKey'
  }

  const jwtParts = value.split('.')
  if (jwtParts.length === 3 && jwtParts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) {
    return null
  }

  return 'Kling 凭证格式错误：请填写新版 api-key-kling-...，或旧版 AccessKey:SecretKey / JWT Token'
}
