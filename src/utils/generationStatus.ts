import type { GenerationStatus } from '../store/useAppStore'

export const normalizeGenerationStatus = (status?: string): GenerationStatus => {
  switch ((status || '').toLowerCase()) {
    case 'queued':
    case 'queueing':
      return 'queued'
    case 'generating':
    case 'processing':
    case 'running':
    case 'in_progress':
      return 'generating'
    case 'done':
    case 'success':
    case 'succeeded':
    case 'complete':
    case 'completed':
      return 'done'
    case 'error':
    case 'failed':
    case 'failure':
    case 'rejected':
      return 'error'
    default:
      return 'idle'
  }
}
