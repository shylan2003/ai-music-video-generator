interface TimedLyric {
  time: number
  text?: string
  skip?: boolean
}

export interface MusicEnergyPoint {
  time: number
  value: number
}

export const buildLyricTimingEnergy = (
  lyrics: TimedLyric[],
  duration?: number
): MusicEnergyPoint[] => {
  const lines = lyrics
    .filter((line) => !line.skip && Number.isFinite(line.time) && typeof line.text === 'string' && line.text.trim())
    .sort((left, right) => left.time - right.time)

  if (lines.length === 0) return []

  const songDuration = Math.max(duration || 0, lines[lines.length - 1].time + 3, 1)
  const raw = lines.map((line, index) => {
    const previous = index > 0 ? lines[index - 1].time : Math.max(0, line.time - 8)
    const next = index + 1 < lines.length ? lines[index + 1].time : Math.min(songDuration, line.time + 8)
    const localGap = Math.max(0.25, (next - previous) / (index > 0 && index + 1 < lines.length ? 2 : 1))
    const density = 1 / localGap
    const emphasis = /[！!？?…]$/.test(line.text?.trim() || '') ? 0.12 : 0
    return { time: line.time, value: density + emphasis }
  })

  const values = raw.map((point) => point.value)
  const floor = Math.min(...values)
  const ceiling = Math.max(...values)
  const range = Math.max(ceiling - floor, 0.000001)

  return raw.map((point) => ({
    time: Number(point.time.toFixed(3)),
    value: Number(((point.value - floor) / range).toFixed(4)),
  }))
}
