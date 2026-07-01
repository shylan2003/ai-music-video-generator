from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ParsedLyric:
    time: float
    text: str


LRC_TIME = re.compile(r"\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]")
SRT_TIME = re.compile(
    r"(?P<sh>\d{1,2}):(?P<sm>\d{2}):(?P<ss>\d{2})[,.](?P<sms>\d{3})\s*-->\s*"
    r"(?P<eh>\d{1,2}):(?P<em>\d{2}):(?P<es>\d{2})[,.](?P<ems>\d{3})"
)


def _srt_seconds(match: re.Match[str], prefix: str) -> float:
    return (
        int(match.group(f"{prefix}h")) * 3600
        + int(match.group(f"{prefix}m")) * 60
        + int(match.group(f"{prefix}s"))
        + int(match.group(f"{prefix}ms")) / 1000
    )


def parse_lrc(content: str) -> list[ParsedLyric]:
    result: list[ParsedLyric] = []
    for raw in content.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        matches = list(LRC_TIME.finditer(raw))
        if not matches:
            continue
        text = LRC_TIME.sub("", raw).strip()
        if not text:
            continue
        for match in matches:
            result.append(ParsedLyric(int(match.group(1)) * 60 + float(match.group(2)), text))
    return sorted(result, key=lambda item: item.time)


def parse_srt(content: str) -> list[ParsedLyric]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    result: list[ParsedLyric] = []
    for block in re.split(r"\n\s*\n", normalized.strip()):
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        time_index = next((index for index, line in enumerate(lines) if SRT_TIME.search(line)), None)
        if time_index is None:
            continue
        match = SRT_TIME.search(lines[time_index])
        if not match:
            continue
        text = " ".join(lines[time_index + 1 :]).strip()
        text = re.sub(r"<[^>]+>", "", text)
        if text:
            result.append(ParsedLyric(_srt_seconds(match, "s"), text))
    return sorted(result, key=lambda item: item.time)


def parse_txt(content: str, duration: float | None = None) -> list[ParsedLyric]:
    lines = [line.strip() for line in content.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    lines = [line for line in lines if line and not line.startswith("#")]
    if not lines:
        return []
    if not duration or duration <= 0:
        raise ValueError("TXT 歌词没有时间轴，请提供歌曲时长后自动对齐，或使用 LRC/SRT")
    step = duration / max(len(lines), 1)
    return [ParsedLyric(index * step, text) for index, text in enumerate(lines)]


def parse_lyrics(content: str, kind: str = "auto", duration: float | None = None) -> list[ParsedLyric]:
    normalized_kind = kind.lower().lstrip(".")
    if normalized_kind == "auto":
        if LRC_TIME.search(content):
            normalized_kind = "lrc"
        elif SRT_TIME.search(content):
            normalized_kind = "srt"
        else:
            normalized_kind = "txt"
    if normalized_kind == "lrc":
        return parse_lrc(content)
    if normalized_kind == "srt":
        return parse_srt(content)
    if normalized_kind == "txt":
        return parse_txt(content, duration)
    raise ValueError(f"不支持的歌词格式：{kind}")

