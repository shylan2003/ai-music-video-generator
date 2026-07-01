import type { LyricLine } from '@/store/useAppStore'

const MIN_VISUAL_TEXT_LENGTH = 8
const NON_LYRIC_PATTERNS = [
  /^作词[:：]/,
  /^作曲[:：]/,
  /^编曲[:：]/,
  /^制作[:：]/,
  /^出品[:：]/,
  /^监制[:：]/,
  /^混音[:：]/,
  /^录音[:：]/,
  /^演唱[:：]/,
  /^翻唱[:：]/,
  /^原唱[:：]/,
  /^词[:：]/,
  /^曲[:：]/,
  /^[\u4e00-\u9fffA-Za-z0-9_\-\s]{1,8}[:：]\s*$/,
]

const SPEAKER_LABEL_PATTERN = /^[\u4e00-\u9fffA-Za-z0-9_\-\s]{1,8}[:：]\s*/
const TRAILING_SPEAKER_LABEL_PATTERN = /\s+[\u4e00-\u9fffA-Za-z0-9_\-\s]{1,8}[:：]\s*$/

export const normalizeLyricForVisual = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[\s，。！？、；：“”‘’（）()《》【】…—,.!?;:·-]+/g, '')

const isShortVisualLyric = (line: LyricLine) =>
  !line.skip &&
  !isNonSungLyricLine(line.text) &&
  normalizeLyricForVisual(line.text).length > 0 &&
  normalizeLyricForVisual(line.text).length < MIN_VISUAL_TEXT_LENGTH

export const isNonSungLyricLine = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) {
    return true
  }

  if (NON_LYRIC_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return true
  }

  const speakerMatch = trimmed.match(SPEAKER_LABEL_PATTERN)
  if (!speakerMatch) {
    return false
  }

  const label = speakerMatch[0].replace(/[:：]\s*$/, '').trim()
  const rest = trimmed.slice(speakerMatch[0].length).trim()
  const restLength = normalizeLyricForVisual(rest).length

  return label.length <= 8 && restLength < MIN_VISUAL_TEXT_LENGTH
}

export const stripTrailingSpeakerLabel = (text: string) =>
  text.replace(TRAILING_SPEAKER_LABEL_PATTERN, '').trim()

const mergeText = (baseText: string, fragmentText: string) => {
  const baseKey = normalizeLyricForVisual(baseText)
  const fragmentKey = normalizeLyricForVisual(fragmentText)

  if (!fragmentKey || baseKey.includes(fragmentKey)) {
    return baseText
  }

  return `${baseText} ${fragmentText}`.trim()
}

export const mergeShortLyricLines = (lyrics: LyricLine[]) => {
  const sortedLyrics = [...lyrics].sort((a, b) => a.time - b.time)
  const merged: LyricLine[] = []
  let mergedCount = 0

  for (let index = 0; index < sortedLyrics.length; index += 1) {
    const line = sortedLyrics[index]

    if (line.skip || isNonSungLyricLine(line.text)) {
      merged.push({ ...line, skip: true })
      continue
    }

    const normalizedLine = {
      ...line,
      text: stripTrailingSpeakerLabel(line.text),
    }

    if (!isShortVisualLyric(normalizedLine)) {
      merged.push(normalizedLine)
      continue
    }

    const previous = merged[merged.length - 1]
    if (previous) {
      merged[merged.length - 1] = {
        ...previous,
        text: mergeText(previous.text, normalizedLine.text),
      }
      mergedCount += 1
      continue
    }

    const next = sortedLyrics[index + 1]
    if (next) {
      sortedLyrics[index + 1] = {
        ...next,
        time: normalizedLine.time,
        text: mergeText(normalizedLine.text, next.text),
      }
      mergedCount += 1
      continue
    }

    merged.push(normalizedLine)
  }

  return {
    lyrics: merged,
    mergedCount,
  }
}
