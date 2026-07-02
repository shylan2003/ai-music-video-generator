export const validateKlingCredential = (credential: string): string | null => {
  const value = credential.trim()
  if (!value) {
    return 'Kling 需要填写 AccessKey:SecretKey 或完整 JWT Token'
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

  return 'Kling 凭证格式错误：请填写 AccessKey:SecretKey，或完整的三段式 JWT Token'
}
