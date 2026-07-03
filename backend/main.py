from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import List, Optional
import uvicorn
import asyncio
import re
import hashlib
import json
import base64
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlparse
import httpx

from services.director import analyze_with_deepseek
from services.lyrics_parser import parse_lyrics
from services.tongyi_image import generate_tongyi_image, image_to_data_uri

app = FastAPI(title="Music Video Generator API", version="2.0.0")

DATA_DIR = Path(os.getenv("MUSIC_VIDEO_DATA_DIR", Path(__file__).resolve().parent))
GENERATED_DIR = DATA_DIR / "generated_images"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)
GENERATED_VIDEO_DIR = DATA_DIR / "generated_videos"
GENERATED_VIDEO_DIR.mkdir(parents=True, exist_ok=True)
VIDEO_TASKS_PATH = DATA_DIR / "video_tasks.json"
_video_tasks_lock = asyncio.Lock()


def load_video_tasks() -> dict[str, dict]:
    try:
        data = json.loads(VIDEO_TASKS_PATH.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


async def save_video_task(cache_key: str, payload: dict) -> None:
    async with _video_tasks_lock:
        tasks = load_video_tasks()
        tasks[cache_key] = {
            **tasks.get(cache_key, {}),
            **payload,
            "updated_at": time.time(),
        }
        temp_path = VIDEO_TASKS_PATH.with_suffix(".tmp")
        temp_path.write_text(json.dumps(tasks, ensure_ascii=False, indent=2), "utf-8")
        temp_path.replace(VIDEO_TASKS_PATH)


def get_resumable_video_task(cache_key: str, provider: str) -> dict | None:
    task = load_video_tasks().get(cache_key)
    if not isinstance(task, dict) or task.get("provider") != provider:
        return None
    if task.get("status") in {"failed", "canceled"}:
        return None
    return task


def basic_video_quality(file_path: Path, requested_duration: float) -> tuple[str, list[str], dict]:
    errors: list[str] = []
    metrics: dict = {"size_bytes": 0}
    try:
        size = file_path.stat().st_size
        metrics["size_bytes"] = size
        if size < 100 * 1024:
            errors.append("视频文件小于 100KB，可能为空或损坏")
        with file_path.open("rb") as source:
            header = source.read(32)
        if b"ftyp" not in header:
            errors.append("文件缺少 MP4 ftyp 标记")
    except OSError as error:
        errors.append(f"无法读取视频文件：{error}")

    ffmpeg_binary = os.getenv("MUSIC_VIDEO_FFMPEG_PATH", "").strip()
    if ffmpeg_binary and Path(ffmpeg_binary).is_file() and not errors:
        command = [
            ffmpeg_binary,
            "-hide_banner",
            "-i",
            str(file_path),
            "-vf",
            "blackdetect=d=0.20:pic_th=0.98,freezedetect=n=-50dB:d=1.50",
            "-an",
            "-f",
            "null",
            os.devnull,
        ]
        try:
            creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=180,
                creationflags=creation_flags,
                check=False,
            )
            probe_output = result.stderr or ""
            if result.returncode != 0:
                errors.append("FFmpeg 无法完整解码该片段")

            duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", probe_output)
            if duration_match:
                actual_duration = (
                    int(duration_match.group(1)) * 3600
                    + int(duration_match.group(2)) * 60
                    + float(duration_match.group(3))
                )
                metrics["duration"] = round(actual_duration, 3)
                if actual_duration + (1 / 30) < requested_duration:
                    errors.append(
                        f"云端片段仅 {actual_duration:.2f} 秒，短于镜头所需 {requested_duration:.2f} 秒"
                    )
            else:
                errors.append("无法读取视频时长")

            video_match = re.search(
                r"Video:.*?\b(\d{2,5})x(\d{2,5})\b.*?(\d+(?:\.\d+)?)\s*fps",
                probe_output,
            )
            if video_match:
                width = int(video_match.group(1))
                height = int(video_match.group(2))
                fps = float(video_match.group(3))
                metrics.update({"width": width, "height": height, "fps": fps})
                if width < 640 or height < 360:
                    errors.append(f"云端片段分辨率过低：{width}×{height}")
                if fps < 20:
                    errors.append(f"云端片段帧率过低：{fps:g}fps")
            else:
                errors.append("无法读取视频分辨率或帧率")

            black_durations = [float(value) for value in re.findall(r"black_duration:([0-9.]+)", probe_output)]
            freeze_durations = [float(value) for value in re.findall(r"freeze_duration:\s*([0-9.]+)", probe_output)]
            metrics["max_black_seconds"] = max(black_durations, default=0)
            metrics["max_freeze_seconds"] = max(freeze_durations, default=0)
            if metrics["max_black_seconds"] > 0.5:
                errors.append(f"检测到 {metrics['max_black_seconds']:.2f} 秒连续黑帧")
            if metrics["max_freeze_seconds"] > 2.0:
                errors.append(f"检测到 {metrics['max_freeze_seconds']:.2f} 秒连续冻结")
        except (OSError, subprocess.TimeoutExpired) as error:
            errors.append(f"FFmpeg 质检未完成：{error}")
    elif not ffmpeg_binary:
        metrics["probe"] = "ffmpeg_unavailable"

    return ("rejected" if errors else "needs_review", errors, metrics)


def completed_video_payload(
    *,
    video_url: str,
    scene_index: int,
    provider: str,
    task_id: str,
    file_path: Path,
    rendered_duration: float,
    requested_duration: float,
    cached: bool = False,
) -> dict:
    quality_status, quality_errors, quality_metrics = basic_video_quality(file_path, requested_duration)
    return {
        "video_url": video_url,
        "video_path": str(file_path.resolve()),
        "scene_index": scene_index,
        "provider": provider,
        "status": "done",
        "task_id": task_id,
        "cached": cached,
        "rendered_duration": quality_metrics.get("duration", rendered_duration),
        "quality_status": quality_status,
        "quality_errors": quality_errors,
        "quality_metrics": quality_metrics,
    }

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "file://",
    "null",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1):\d+$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

SESSION_TOKEN = os.getenv("MUSIC_VIDEO_SESSION_TOKEN", "").strip()


@app.middleware("http")
async def verify_local_session(request: Request, call_next):
    if SESSION_TOKEN and request.url.path.startswith("/api/"):
        if request.headers.get("X-Music-Video-Token", "") != SESSION_TOKEN:
            return JSONResponse(status_code=401, content={"detail": "本地会话令牌无效"})
    return await call_next(request)

app.mount("/generated", StaticFiles(directory=str(GENERATED_DIR)), name="generated")
app.mount("/generated-videos", StaticFiles(directory=str(GENERATED_VIDEO_DIR)), name="generated-videos")

# ── 非歌词行判断 ──────────────────────────────────────────
NON_LYRIC_PATTERNS = [
    r'^作词[:：]', r'^作曲[:：]', r'^编曲[:：]',
    r'^制作[:：]', r'^出品[:：]', r'^监制[:：]',
    r'^混音[:：]', r'^录音[:：]', r'^演唱[:：]',
    r'^翻唱[:：]', r'^原唱[:：]', r'^词[:：]', r'^曲[:：]',
    r'^[\u4e00-\u9fffA-Za-z0-9_\-\s]{1,8}[:：]\s*$',
    r'^\[.*\]$', r'^【.*】$', r'^\s*$',
]

STYLE_KEYWORDS = {
    "cinematic": "cinematic lighting, film grain, dramatic shadows, cohesive color script, movie quality",
    "ornate_gufeng": "ornate Chinese historical fantasy, Tang dynasty inspired costumes, gold embroidery, palace lanterns, silk, jade, flower petals, cinematic grandeur",
    "cyberpunk": "neon lights, rain reflections, futuristic city, holographic displays, atmospheric depth",
    "inkwash": "Chinese ink wash painting, misty mountains, poetic negative space, traditional brushwork",
    "song_landscape": "Song dynasty landscape aesthetics, elegant ink and mineral colors, misty rivers, refined scholar painting, quiet poetic composition",
    "tang_mural": "Tang dynasty mural style, mineral pigments, flying apsaras, decorative clouds, Dunhuang inspired patterns, ancient fresco texture",
    "xianxia": "Chinese xianxia fantasy, ethereal robes, glowing mist, celestial mountains, magical atmosphere, elegant cinematic lighting",
    "stage_opera": "Chinese opera stage lighting, dramatic makeup, embroidered costumes, theatrical smoke, spotlight, symbolic set design",
    "guofeng_cinematic": "modern Chinese guofeng cinema, realistic ancient architecture, poetic color grading, restrained epic composition",
    "anime": "anime illustration, soft pastel colors, expressive characters, detailed scene composition",
    "realistic": "photorealistic, natural lighting, high detail photography, cinematic depth",
    "abstract": "abstract geometric shapes, vibrant colors, layered texture, modern art composition",
    "dark_fantasy": "dark fantasy music video, moody fog, moonlight, dramatic contrast, gothic atmosphere, painterly realism",
    "retro_film": "retro film photography, warm grain, analog lens, nostalgic color grading, natural cinematic frames",
    "stage_lighting": "concert stage lighting, volumetric beams, haze, dramatic silhouettes, music video performance mood",
}

ARC_TEMPLATES = [
    {"title": "序章", "mood": "calm cinematic opening"},
    {"title": "铺垫", "mood": "gentle emotional build-up"},
    {"title": "推进", "mood": "steady narrative progression"},
    {"title": "转折", "mood": "subtle emotional turning point"},
    {"title": "高潮", "mood": "intense and powerful emotional peak"},
    {"title": "回响", "mood": "echoing chorus and recurring emotion"},
    {"title": "余韵", "mood": "reflective lingering aftertaste"},
    {"title": "尾声", "mood": "quiet closing resolution"},
]

THEME_KEYWORDS = {
    "farewell": ["别", "离", "散", "送", "归", "走", "远方"],
    "memory": ["回忆", "从前", "曾经", "昨日", "记得", "往事"],
    "night": ["夜", "月", "星", "灯", "梦", "黑", "晚", "黎明"],
    "journey": ["路", "风", "山", "海", "船", "远", "站", "旅行"],
    "city": ["城", "街", "楼", "窗", "人海", "霓虹", "巷"],
    "emotion": ["心", "泪", "爱", "想念", "孤独", "寂寞", "拥抱", "温柔"],
    "nature": ["雨", "雪", "云", "花", "叶", "江", "河", "雾", "海"],
}

SONG_TYPE_KEYWORDS = {
    "narrative": ["那年", "后来", "曾经", "从小", "长大", "来到", "离开", "回到", "相逢", "告别"],
    "lyrical": ["爱", "想念", "心", "温柔", "孤独", "寂寞", "泪", "拥抱", "遗憾", "思念"],
    "imagery": ["月", "云", "风", "雨", "雪", "花", "海", "山", "星", "雾", "光", "梦"],
    "performance": ["舞台", "灯光", "聚光灯", "掌声", "麦克风", "观众", "演唱", "乐队", "幕布"],
    "duet": ["男：", "女：", "合：", "对唱", "你问", "我答", "你说", "我说", "我们"],
}

MIN_SEGMENT_LINES = 3
IDEAL_SEGMENT_LINES = 4
MAX_SEGMENT_LINES = 5
BASE_HARD_PAUSE = 2.2
BASE_SOFT_PAUSE = 1.6
MIN_VISUAL_TEXT_LENGTH = 8
MAX_VISUAL_GROUP_LINES = 3
MAX_VISUAL_GROUP_TEXT_LENGTH = 36


def looks_like_song_credit_header(text: str) -> bool:
    if len(text) > 48:
        return False
    if re.search(r'[。？！?!，,；;]', text):
        return False
    return bool(re.match(r'^.{1,24}\s*[-–—]\s*[\u4e00-\u9fffA-Za-z0-9_\s/／&、·.]{1,30}$', text))


def is_non_lyric(text: str) -> bool:
    stripped = text.strip()
    if looks_like_song_credit_header(stripped):
        return True
    for pattern in NON_LYRIC_PATTERNS:
        if re.match(pattern, stripped):
            return True
    speaker_match = re.match(r'^([\u4e00-\u9fffA-Za-z0-9_\-\s]{1,8})[:：]\s*(.*)$', stripped)
    if speaker_match and len(normalize_lyric_text(speaker_match.group(2))) < MIN_VISUAL_TEXT_LENGTH:
        return True
    if re.match(r'^[A-Za-z\s:：]{1,20}$', stripped):
        return True
    return False


def normalize_lyric_text(text: str) -> str:
    return re.sub(r'[\s，。！？、；：“”‘’（）()《》【】…—,.!?;:·-]+', '', text.strip().lower())


def strip_trailing_speaker_label(text: str) -> str:
    return re.sub(r'\s+[\u4e00-\u9fffA-Za-z0-9_\-\s]{1,8}[:：]\s*$', '', text.strip())


def line_looks_complete(text: str) -> bool:
    stripped = text.strip()
    return bool(re.search(r'[。！？!?；;…]$', stripped)) or len(stripped) >= 10


def detect_theme(text: str) -> str:
    for theme, keywords in THEME_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            return theme
    return "neutral"


def detect_song_type(valid_lyrics: List["LyricLine"]) -> str:
    text = " ".join(line.text for line in valid_lyrics)
    scores = {
        song_type: sum(text.count(keyword) for keyword in keywords)
        for song_type, keywords in SONG_TYPE_KEYWORDS.items()
    }
    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    if not ranked or ranked[0][1] < 2:
        return "hybrid"
    if len(ranked) > 1 and ranked[1][1] >= ranked[0][1] * 0.8:
        return "hybrid"
    return ranked[0][0]


def median_gap(lyrics: List["LyricLine"]) -> float:
    gaps = [
        max(0.0, lyrics[index].time - lyrics[index - 1].time)
        for index in range(1, len(lyrics))
    ]
    valid_gaps = sorted(gap for gap in gaps if gap > 0)
    if not valid_gaps:
        return 4.0
    mid = len(valid_gaps) // 2
    if len(valid_gaps) % 2 == 1:
        return valid_gaps[mid]
    return (valid_gaps[mid - 1] + valid_gaps[mid]) / 2


def get_pause_thresholds(lyrics: List["LyricLine"]) -> tuple[float, float]:
    base_gap = median_gap(lyrics)
    hard_pause = max(BASE_HARD_PAUSE, base_gap * 1.8)
    soft_pause = max(BASE_SOFT_PAUSE, base_gap * 1.25)
    return hard_pause, soft_pause


def should_split_segment(
    current_segment: List["LyricLine"],
    next_line: "LyricLine",
    seen_counts: dict[str, int],
    hard_pause: float,
    soft_pause: float,
) -> bool:
    if not current_segment:
        return False

    previous_line = current_segment[-1]
    gap = max(0.0, next_line.time - previous_line.time)
    current_length = len(current_segment)
    next_key = normalize_lyric_text(next_line.text)
    repeated_line = bool(next_key and seen_counts.get(next_key, 0) > 0)
    current_theme = detect_theme(" ".join(line.text for line in current_segment[-2:]))
    next_theme = detect_theme(next_line.text)
    theme_shift = (
        current_length >= MIN_SEGMENT_LINES
        and current_theme != "neutral"
        and next_theme != "neutral"
        and current_theme != next_theme
    )

    if current_length >= MAX_SEGMENT_LINES:
        return True
    if gap >= hard_pause and current_length >= 2:
        return True
    if repeated_line and current_length >= 2:
        return True
    if current_length >= IDEAL_SEGMENT_LINES and (
        gap >= soft_pause or line_looks_complete(previous_line.text) or theme_shift
    ):
        return True
    return False


def merge_short_segments(segments: List[List["LyricLine"]]) -> List[List["LyricLine"]]:
    merged: List[List["LyricLine"]] = []

    for segment in segments:
        if not segment:
            continue
        if merged and len(segment) < MIN_SEGMENT_LINES and len(merged[-1]) + len(segment) <= MAX_SEGMENT_LINES + 1:
            merged[-1].extend(segment)
        elif merged and len(merged[-1]) < MIN_SEGMENT_LINES:
            merged[-1].extend(segment)
        else:
            merged.append(segment[:])

    if len(merged) >= 2 and len(merged[-1]) < MIN_SEGMENT_LINES:
        merged[-2].extend(merged[-1])
        merged.pop()

    return merged


def build_segments(valid_lyrics: List["LyricLine"]) -> List[List["LyricLine"]]:
    if not valid_lyrics:
        return []

    hard_pause, soft_pause = get_pause_thresholds(valid_lyrics)
    segments: List[List["LyricLine"]] = []
    current_segment: List["LyricLine"] = []
    seen_counts: dict[str, int] = {}

    for line in valid_lyrics:
        if should_split_segment(current_segment, line, seen_counts, hard_pause, soft_pause):
            segments.append(current_segment)
            current_segment = []

        current_segment.append(line)
        line_key = normalize_lyric_text(line.text)
        if line_key:
            seen_counts[line_key] = seen_counts.get(line_key, 0) + 1

    if current_segment:
        segments.append(current_segment)

    return merge_short_segments(segments)


def get_arc_template(index: int, total: int) -> dict:
    if total <= 1:
        return ARC_TEMPLATES[0]
    arc_index = round(index * (len(ARC_TEMPLATES) - 1) / max(total - 1, 1))
    return ARC_TEMPLATES[min(len(ARC_TEMPLATES) - 1, arc_index)]


def build_global_summary(valid_lyrics: List["LyricLine"]) -> str:
    snippets: List[str] = []
    for line in valid_lyrics:
        text = line.text.strip()
        if text and text not in snippets:
            snippets.append(text)
        if len(snippets) >= 5:
            break
    return "，".join(snippets)[:100]


def build_visual_lock_text(visual_lock: Optional["VisualLockConfig"] = None) -> str:
    if not visual_lock or not visual_lock.enabled:
        return ""

    parts = []
    if visual_lock.main_subject:
        parts.append(f"main subject: {visual_lock.main_subject.strip()}")
    if visual_lock.wardrobe:
        parts.append(f"identity signature and allowed life-stage changes: {visual_lock.wardrobe.strip()}")
    if visual_lock.setting:
        parts.append(f"fixed world and setting: {visual_lock.setting.strip()}")
    if visual_lock.palette:
        parts.append(f"locked color palette and lighting: {visual_lock.palette.strip()}")
    if visual_lock.symbols:
        parts.append(f"recurring visual symbols: {visual_lock.symbols.strip()}")
    if visual_lock.negative_prompt:
        parts.append(f"avoid: {visual_lock.negative_prompt.strip()}")

    if not parts:
        return ""

    return (
        "User visual continuity lock. Treat these as higher priority than automatic lyric interpretation: "
        + "; ".join(parts)
        + ". Keep identity, world, palette, and symbols consistent; age, hairstyle and wardrobe may only change through an explicit character stage."
    )


def append_visual_lock_to_prompt(prompt: str, visual_lock: Optional["VisualLockConfig"] = None) -> str:
    lock_text = build_visual_lock_text(visual_lock)
    return f"{prompt} {lock_text}" if lock_text else prompt


def build_visual_bible(
    valid_lyrics: List["LyricLine"],
    style: str,
    song_name: str = "",
    visual_lock: Optional["VisualLockConfig"] = None,
) -> str:
    summary = build_global_summary(valid_lyrics)
    lyric_text = " ".join(line.text for line in valid_lyrics[:30])
    themes = sorted({
        detect_theme(line.text)
        for line in valid_lyrics
        if detect_theme(line.text) != "neutral"
    })
    theme_text = " / ".join(themes[:4]) if themes else "poetic emotional journey"
    style_kw = STYLE_KEYWORDS.get(style, STYLE_KEYWORDS["cinematic"])

    visual_bible = (
        f"Song title: {song_name or 'unknown song'}. Overall lyric theme: {summary}. "
        f"Recurring themes: {theme_text}. Visual style: {style_kw}. "
        "Maintain one continuous music-video world across all images: same main character or symbolic subject, "
        "same era, same color palette, same lighting logic, coherent camera language, and evolving emotional arc. "
        "Do not render subtitles, captions, Chinese characters, lyrics, logos, watermarks, or UI text inside the image. "
        f"Reference lyric texture: {lyric_text[:260]}"
    )
    return append_visual_lock_to_prompt(visual_bible, visual_lock)


def visual_text_length(text: str) -> int:
    return len(normalize_lyric_text(text))


def is_short_visual_line(line: "LyricLine") -> bool:
    return visual_text_length(line.text) < MIN_VISUAL_TEXT_LENGTH


def group_text_length(group: List["LyricLine"]) -> int:
    return sum(visual_text_length(line.text) for line in group)


def can_merge_visual_group(left: List["LyricLine"], right: List["LyricLine"]) -> bool:
    return (
        len(left) + len(right) <= MAX_VISUAL_GROUP_LINES
        and group_text_length(left) + group_text_length(right) <= MAX_VISUAL_GROUP_TEXT_LENGTH
    )


def build_visual_groups(valid_lyrics: List["LyricLine"]) -> List[List["LyricLine"]]:
    """Merge very short lyric fragments into neighboring visual units."""
    groups: List[List["LyricLine"]] = []

    for line in valid_lyrics:
        line_group = [line]
        if is_short_visual_line(line) and groups and can_merge_visual_group(groups[-1], line_group):
            groups[-1].append(line)
        else:
            groups.append(line_group)

    merged: List[List["LyricLine"]] = []
    index = 0
    while index < len(groups):
        group = groups[index]
        is_lonely_short_group = len(group) == 1 and is_short_visual_line(group[0])

        if is_lonely_short_group and index + 1 < len(groups) and can_merge_visual_group(group, groups[index + 1]):
            groups[index + 1] = group + groups[index + 1]
            index += 1
            continue

        if is_lonely_short_group and merged and can_merge_visual_group(merged[-1], group):
            merged[-1].extend(group)
        else:
            merged.append(group)

        index += 1

    return merged


def build_director_analysis(valid_lyrics: List["LyricLine"], style: str, song_name: str = "") -> dict:
    full_text = " ".join(line.text for line in valid_lyrics)
    theme_counts: dict[str, int] = {}
    for line in valid_lyrics:
        theme = detect_theme(line.text)
        if theme != "neutral":
            theme_counts[theme] = theme_counts.get(theme, 0) + 1

    sorted_themes = sorted(theme_counts.items(), key=lambda item: item[1], reverse=True)
    dominant_themes = [theme for theme, _count in sorted_themes[:4]] or ["poetic"]
    summary = build_global_summary(valid_lyrics)
    style_keyword = STYLE_KEYWORDS.get(style, STYLE_KEYWORDS["cinematic"])

    if any(keyword in full_text for keyword in ["琵琶", "弦", "曲", "声", "乐"]):
        motif = "musical instrument strings, resonant sound waves, close-up hands, drifting petals and rippling water"
    elif any(keyword in full_text for keyword in ["江", "河", "海", "船", "月"]):
        motif = "moonlit water, distant boat, mist, reflections, lonely shoreline"
    elif any(keyword in full_text for keyword in ["花", "雨", "雪", "云", "风"]):
        motif = "natural elements, soft weather, moving clouds, falling petals, seasonal atmosphere"
    else:
        motif = "a consistent symbolic protagonist moving through poetic spaces"

    emotional_arc = [
        "opening: establish atmosphere and main visual world",
        "build: deepen emotion through closer shots and recurring symbols",
        "turning point: intensify contrast, motion, and lighting",
        "ending: resolve into a memorable final image",
    ]

    return {
        "song_name": song_name,
        "summary": summary,
        "dominant_themes": dominant_themes,
        "visual_motif": motif,
        "style_keyword": style_keyword,
        "color_script": "keep a coherent palette across all shots, with controlled accent colors that follow the emotional arc",
        "camera_language": "alternate wide establishing shots, medium narrative shots, and close-up emotional details; avoid random unrelated images",
        "emotional_arc": emotional_arc,
    }


def get_scene_arc(index: int, total: int) -> dict:
    arc = get_arc_template(index, total)
    progress = index / max(total - 1, 1)
    if progress < 0.25:
        shot_type = "wide establishing shot"
        camera_motion = "slow dolly in"
        transition = "soft dissolve"
    elif progress < 0.55:
        shot_type = "medium narrative shot"
        camera_motion = "gentle lateral tracking"
        transition = "match cut"
    elif progress < 0.82:
        shot_type = "dramatic close-up or dynamic medium shot"
        camera_motion = "slow push-in with subtle parallax"
        transition = "rhythmic cut"
    else:
        shot_type = "wide closing shot with strong silhouette"
        camera_motion = "slow pull back"
        transition = "cut"
    return {**arc, "shot_type": shot_type, "camera_motion": camera_motion, "transition": transition}


def build_smart_scene_groups(
    valid_lyrics: List["LyricLine"],
    duration: Optional[float] = None,
    target_seconds: float = 8.0,
    min_seconds: float = 6.0,
    max_seconds: float = 10.0,
    music_energy: Optional[List["MusicEnergyPoint"]] = None,
) -> List[dict]:
    """Build 6-10 second cloud-video windows and keep every lyric timestamp unchanged."""
    if not valid_lyrics:
        return []
    song_duration = max(float(duration or 0), valid_lyrics[-1].time + 1, 1)
    min_seconds = max(1.0, float(min_seconds))
    max_seconds = max(min_seconds, float(max_seconds))
    min_count = max(1, int((song_duration + max_seconds - 0.001) // max_seconds))
    max_count = max(min_count, int(song_duration // min_seconds) or 1)
    target_count = round(song_duration / max(min_seconds, min(max_seconds, target_seconds)))
    if song_duration >= 240:
        target_count = max(30, min(50, target_count))
    target_count = max(min_count, min(max_count, target_count))

    boundaries = [song_duration * index / target_count for index in range(target_count + 1)]
    lyric_times = [line.time for line in valid_lyrics if 0 < line.time < song_duration]
    energy_points = music_energy or []
    energy_peaks = [
        float(point.time)
        for index, point in enumerate(energy_points)
        if 0 < point.time < song_duration
        and point.value >= 0.58
        and point.value >= (energy_points[index - 1].value if index > 0 else 0)
        and point.value >= (energy_points[index + 1].value if index + 1 < len(energy_points) else 0)
    ]
    for index in range(1, len(boundaries) - 1):
        original = boundaries[index]
        nearest_energy = min(energy_peaks, key=lambda value: abs(value - original), default=original)
        nearest_lyric = min(lyric_times, key=lambda value: abs(value - original), default=original)
        nearest = nearest_energy if abs(nearest_energy - original) <= 1.0 else nearest_lyric
        previous = boundaries[index - 1]
        following = boundaries[index + 1]
        if (
            abs(nearest - original) <= 1.25
            and nearest - previous >= min_seconds
            and following - nearest >= min_seconds
            and nearest - previous <= max_seconds
            and following - nearest <= max_seconds
        ):
            boundaries[index] = nearest

    groups: List[dict] = []
    for index in range(target_count):
        start_time = round(boundaries[index], 3)
        end_time = round(boundaries[index + 1], 3)
        lines = [
            line
            for line in valid_lyrics
            if line.time >= start_time and (line.time < end_time or (index == target_count - 1 and line.time <= end_time))
        ]
        previous_line = next((line for line in reversed(valid_lyrics) if line.time < start_time), None)
        next_line = next((line for line in valid_lyrics if line.time >= end_time), None)
        context_lines = lines or [line for line in (previous_line, next_line) if line]
        groups.append({
            "group_index": index,
            "start_time": start_time,
            "end_time": end_time,
            "lyric_ids": [line.id for line in lines],
            "lyrics": [line.text for line in lines],
            "context_lyrics": [line.text for line in context_lines],
        })
    return groups


def stable_seed(value: str) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 1000


def stable_file_stem(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def get_public_image_url(file_path: Path) -> str:
    port = int(os.getenv("MUSIC_VIDEO_BACKEND_PORT", "8000"))
    return f"http://127.0.0.1:{port}/generated/{file_path.name}"


def get_public_video_url(file_path: Path) -> str:
    port = int(os.getenv("MUSIC_VIDEO_BACKEND_PORT", "8000"))
    return f"http://127.0.0.1:{port}/generated-videos/{file_path.name}"


def get_public_backend_base_url() -> str:
    return (
        os.getenv("PUBLIC_BACKEND_BASE_URL", "").strip()
        or os.getenv("PUBLIC_ASSET_BASE_URL", "").strip()
    ).rstrip("/")


def should_trust_system_proxy(url: str) -> bool:
    hostname = (urlparse(url).hostname or "").lower()
    return hostname not in {"localhost", "127.0.0.1", "::1"}


def convert_local_backend_url_to_public(url: str) -> str:
    public_base_url = get_public_backend_base_url()
    if not public_base_url:
        return url

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return url

    hostname = parsed.hostname or ""
    port = parsed.port
    is_local_backend = hostname in {"localhost", "127.0.0.1", "0.0.0.0"} and port in {8000, None}
    is_generated_asset = parsed.path.startswith("/generated/") or parsed.path.startswith("/generated-videos/")
    if not is_local_backend or not is_generated_asset:
        return url

    query = f"?{parsed.query}" if parsed.query else ""
    return f"{public_base_url}{parsed.path}{query}"


def get_luma_public_image_url(image_url: str) -> str:
    return convert_local_backend_url_to_public(image_url)


def get_image_provider_config(config: Optional["ImageProviderConfig"]) -> "ImageProviderConfig":
    return config or ImageProviderConfig()


def get_image_size(config: Optional["ImageProviderConfig"]) -> str:
    return ((config.size if config and config.size else os.getenv("OPENAI_IMAGE_SIZE", "1280x720")) or "1280x720").strip()


def get_image_dimensions(config: Optional["ImageProviderConfig"]) -> tuple[int, int]:
    size = get_image_size(config)
    match = re.match(r"^(\d{3,4})x(\d{3,4})$", size)
    if not match:
        return 1280, 720
    return int(match.group(1)), int(match.group(2))


def get_placeholder_url(seed: int, config: Optional["ImageProviderConfig"] = None) -> str:
    width, height = get_image_dimensions(config)
    return f"https://picsum.photos/seed/{seed}/{width}/{height}"


async def download_image_to_cache(url: str, file_path: Path, headers: Optional[dict[str, str]] = None) -> str:
    partial_path = file_path.with_suffix(file_path.suffix + ".part")
    async with httpx.AsyncClient(
        timeout=120,
        follow_redirects=True,
        trust_env=should_trust_system_proxy(url),
    ) as client:
        try:
            async with client.stream("GET", url, headers=headers) as response:
                response.raise_for_status()
                file_path.parent.mkdir(parents=True, exist_ok=True)
                size = 0
                with partial_path.open("wb") as target:
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 40 * 1024 * 1024:
                            raise RuntimeError("图片超过 40MB 下载限制")
                        target.write(chunk)
            partial_path.replace(file_path)
        except Exception:
            partial_path.unlink(missing_ok=True)
            raise
    return get_public_image_url(file_path)


async def download_video_to_cache(url: str, file_path: Path, headers: Optional[dict[str, str]] = None) -> str:
    partial_path = file_path.with_suffix(file_path.suffix + ".part")
    async with httpx.AsyncClient(
        timeout=300,
        follow_redirects=True,
        trust_env=should_trust_system_proxy(url),
    ) as client:
        try:
            async with client.stream("GET", url, headers=headers) as response:
                response.raise_for_status()
                file_path.parent.mkdir(parents=True, exist_ok=True)
                size = 0
                with partial_path.open("wb") as target:
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 1024 * 1024 * 1024:
                            raise RuntimeError("视频超过 1GB 下载限制")
                        target.write(chunk)
            partial_path.replace(file_path)
        except Exception:
            partial_path.unlink(missing_ok=True)
            raise
    return get_public_video_url(file_path)


async def image_source_to_data_uri(image_url: str) -> str:
    return await image_to_data_uri(image_url)


async def get_runway_prompt_image(image_url: str) -> str:
    if image_url.startswith("https://") or image_url.startswith("data:image/"):
        return image_url
    return await image_source_to_data_uri(image_url)


async def generate_openai_image(prompt: str, cache_key: str, config: Optional["ImageProviderConfig"] = None) -> Optional[str]:
    provider_config = get_image_provider_config(config)
    api_key = (provider_config.api_key or "").strip() or os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return None

    file_path = GENERATED_DIR / f"{stable_file_stem(cache_key)}.png"
    if file_path.exists() and file_path.stat().st_size > 0:
        return get_public_image_url(file_path)

    model = (provider_config.model or "").strip() or os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
    size = get_image_size(provider_config)
    quality = (provider_config.quality or "").strip() or os.getenv("OPENAI_IMAGE_QUALITY", "medium")
    base_url = (
        (provider_config.base_url or "").strip()
        or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    ).rstrip("/")

    payload = {
        "model": model,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": 1,
    }

    async with httpx.AsyncClient(
        timeout=120,
        trust_env=should_trust_system_proxy(base_url),
    ) as client:
        response = await client.post(
            f"{base_url}/images/generations",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    image_base64 = data.get("data", [{}])[0].get("b64_json")
    if not image_base64:
        image_url = data.get("data", [{}])[0].get("url")
        if image_url:
            async with httpx.AsyncClient(
                timeout=120,
                trust_env=should_trust_system_proxy(image_url),
            ) as client:
                image_response = await client.get(image_url)
                image_response.raise_for_status()
                file_path.write_bytes(image_response.content)
                return get_public_image_url(file_path)
        raise RuntimeError("OpenAI image response did not include image data")

    file_path.write_bytes(base64.b64decode(image_base64))
    return get_public_image_url(file_path)


async def generate_pollinations_image(prompt: str, cache_key: str, config: Optional["ImageProviderConfig"] = None) -> Optional[str]:
    provider_config = get_image_provider_config(config)
    width, height = get_image_dimensions(provider_config)
    model = (provider_config.model or "").strip() or "flux"
    api_key = (provider_config.api_key or "").strip()
    file_path = GENERATED_DIR / f"{stable_file_stem(cache_key)}.jpg"

    if file_path.exists() and file_path.stat().st_size > 0:
        return get_public_image_url(file_path)

    encoded_prompt = quote(prompt[:1800])
    if api_key:
        url = (
            f"https://gen.pollinations.ai/image/{encoded_prompt}"
            f"?width={width}&height={height}&model={quote(model)}&seed={stable_seed(cache_key)}&nologo=true&key={quote(api_key)}"
        )
    else:
        url = (
            f"https://image.pollinations.ai/prompt/{encoded_prompt}"
            f"?width={width}&height={height}&model={quote(model)}&seed={stable_seed(cache_key)}&nologo=true"
        )

    return await download_image_to_cache(url, file_path)


async def generate_provider_image(
    prompt: str,
    cache_key: str,
    config: Optional["ImageProviderConfig"] = None,
    reference_image: str = "",
    reference_images: Optional[List[str]] = None,
) -> Optional[str]:
    provider_config = get_image_provider_config(config)

    if provider_config.provider == "placeholder":
        return None
    if provider_config.provider == "pollinations":
        return await generate_pollinations_image(prompt, cache_key, provider_config)
    if provider_config.provider == "tongyi":
        api_key = (provider_config.api_key or "").strip() or os.getenv("DASHSCOPE_API_KEY", "")
        file_path = GENERATED_DIR / f"{stable_file_stem(cache_key)}.png"
        return await generate_tongyi_image(
            prompt=prompt,
            output_path=file_path,
            api_key=api_key,
            model=(provider_config.model or "wan2.6-image").strip(),
            base_url=(provider_config.base_url or "https://dashscope.aliyuncs.com/api/v1").strip(),
            size=provider_config.size,
            reference_image=reference_image,
            reference_images=reference_images or [],
            public_url_for_path=get_public_image_url,
        )
    if provider_config.provider in {"openai", "custom"}:
        return await generate_openai_image(prompt, cache_key, provider_config)

    return await generate_pollinations_image(prompt, cache_key, provider_config)


async def resolve_image_url(
    prompt: str,
    cache_key: str,
    placeholder_seed: int,
    config: Optional["ImageProviderConfig"] = None,
    reference_image: str = "",
) -> tuple[str, bool, Optional[str]]:
    placeholder_url = get_placeholder_url(placeholder_seed, config)

    try:
        image_url = await generate_provider_image(prompt, cache_key, config, reference_image)
        return image_url or placeholder_url, bool(image_url), None
    except Exception as error:
        print(f"[ERROR] image generation failed: {error}")
        return placeholder_url, False, str(error)


def build_visual_prompt(text: str, style: str, context: str = "single lyric") -> str:
    style_kw = STYLE_KEYWORDS.get(style, STYLE_KEYWORDS["cinematic"])
    lyric_text = text.strip()[:120]
    return (
        f"{context}, lyrics: '{lyric_text}', {style_kw}, "
        "match the meaning of this exact lyric line, cohesive music video frame, "
        "expressive composition, high quality, 4k, wide angle"
    )


def build_lyric_scene_prompt(
    lyric: "LyricLine",
    style: str,
    visual_bible: str,
    previous_text: str = "",
    next_text: str = "",
) -> str:
    return build_lyric_group_scene_prompt(
        current_text=lyric.text,
        style=style,
        visual_bible=visual_bible,
        previous_text=previous_text,
        next_text=next_text,
    )


def build_lyric_group_scene_prompt(
    current_text: str,
    style: str,
    visual_bible: str,
    previous_text: str = "",
    next_text: str = "",
) -> str:
    context_parts = []
    if previous_text:
        context_parts.append(f"previous lyric: '{previous_text[:60]}'")
    context_parts.append(f"current lyric group: '{current_text.strip()[:140]}'")
    if next_text:
        context_parts.append(f"next lyric: '{next_text[:60]}'")

    context = ", ".join(context_parts)
    style_kw = STYLE_KEYWORDS.get(style, STYLE_KEYWORDS["cinematic"])
    return (
        f"Create one cinematic music video still for the current lyric. Continuity bible: {visual_bible}. "
        f"Shot-specific context: {context}. Style emphasis: {style_kw}. "
        "The image must match the current lyric's concrete imagery and emotional meaning while still feeling like "
        "the next shot in the same MV. Keep subject identity, costume, environment, color palette, and lighting "
        "consistent with adjacent lyrics. No text overlay. "
        "high quality, 4k, 16:9 wide shot"
    )


# ── 数据模型（兼容 Python 3.10 以下版本）──────────────────
class LyricLine(BaseModel):
    id: str
    text: str
    time: float
    skip: Optional[bool] = False


class FilterRequest(BaseModel):
    lyrics: List[LyricLine]


class ImageProviderConfig(BaseModel):
    provider: str = "pollinations"
    model: str = "flux"
    api_key: Optional[str] = ""
    base_url: Optional[str] = ""
    size: str = "1280x720"
    quality: str = "medium"


class LLMProviderConfig(BaseModel):
    provider: str = "deepseek"
    model: str = "deepseek-chat"
    api_key: Optional[str] = ""
    base_url: Optional[str] = "https://api.deepseek.com/v1"


class VideoProviderConfig(BaseModel):
    provider: str = "kling"
    model: str = "kling-v2-5-turbo"
    api_key: Optional[str] = ""
    base_url: Optional[str] = ""
    motion_strength: str = "standard"
    clip_seconds: float = 6.0


class GenerationPolicyConfig(BaseModel):
    mode: str = "cloud_all"
    target_scene_seconds: float = 8.0
    min_scene_seconds: float = 6.0
    max_scene_seconds: float = 10.0
    require_test_batch: bool = True
    prompt_version: int = 1


class MusicEnergyPoint(BaseModel):
    time: float
    value: float = Field(ge=0, le=1)


class VisualLockConfig(BaseModel):
    enabled: bool = False
    main_subject: Optional[str] = ""
    wardrobe: Optional[str] = ""
    setting: Optional[str] = ""
    palette: Optional[str] = ""
    symbols: Optional[str] = ""
    negative_prompt: Optional[str] = ""


class StoryboardRequest(BaseModel):
    lyrics: List[LyricLine]
    style: str
    duration: Optional[float] = 240.0
    song_name: Optional[str] = ""
    image_provider: Optional[ImageProviderConfig] = None
    visual_lock: Optional[VisualLockConfig] = None


class LyricScenesRequest(BaseModel):
    lyrics: List[LyricLine]
    style: str
    duration: Optional[float] = 240.0
    song_name: Optional[str] = ""
    image_provider: Optional[ImageProviderConfig] = None
    video_provider: Optional[VideoProviderConfig] = None
    llm_provider: Optional[LLMProviderConfig] = None
    visual_lock: Optional[VisualLockConfig] = None
    generation_policy: Optional[GenerationPolicyConfig] = None
    music_energy: List[MusicEnergyPoint] = Field(default_factory=list)


class GenerateImageRequest(BaseModel):
    prompt: str
    scene_index: Optional[int] = 0
    lyric_id: Optional[str] = None
    character_id: Optional[str] = ""
    anchor_image: Optional[str] = ""
    reference_images: List[str] = Field(default_factory=list)
    image_provider: Optional[ImageProviderConfig] = None
    visual_lock: Optional[VisualLockConfig] = None


class CachedSceneImageRequest(BaseModel):
    scene_index: int
    prompt: str
    character_id: Optional[str] = ""
    anchor_image: Optional[str] = ""
    reference_images: List[str] = Field(default_factory=list)


class RestoreImageCacheRequest(BaseModel):
    scenes: List[CachedSceneImageRequest]
    visual_lock: Optional[VisualLockConfig] = None
    allow_ordered_fallback: bool = True


class LyricsParseRequest(BaseModel):
    content: str
    kind: str = "auto"
    duration: Optional[float] = None


class GenerateVideoRequest(BaseModel):
    prompt: str
    image_url: str
    scene_index: Optional[int] = 0
    duration: Optional[float] = 6.0
    camera_motion: Optional[str] = ""
    last_frame_url: Optional[str] = ""
    style_fingerprint: Optional[str] = ""
    video_provider: Optional[VideoProviderConfig] = None


class PublicImageRequest(BaseModel):
    image_url: str


class GeneratePromptRequest(BaseModel):
    lyric: str
    style: str


class BatchGenerateRequest(BaseModel):
    lyrics: List[LyricLine]
    style: str
    image_provider: Optional[ImageProviderConfig] = None
    visual_lock: Optional[VisualLockConfig] = None


# ── 接口 ──────────────────────────────────────────────────
@app.get("/health")
async def health_check():
    return {"status": "ok", "message": "Backend is running"}


@app.get("/api/video/tasks")
async def list_video_tasks():
    tasks = load_video_tasks()
    return {
        "tasks": [
            {"cache_key": cache_key, **task}
            for cache_key, task in sorted(
                tasks.items(), key=lambda item: float(item[1].get("updated_at", 0)), reverse=True
            )
        ][:500]
    }


@app.post("/api/lyrics/parse")
async def parse_lyrics_endpoint(request: LyricsParseRequest):
    try:
        parsed = parse_lyrics(request.content, request.kind, request.duration)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return {
        "lyrics": [
            {"id": f"lyric-{index}", "time": round(item.time, 3), "text": item.text}
            for index, item in enumerate(parsed)
        ]
    }


@app.post("/api/media/public-image")
async def resolve_public_image(request: PublicImageRequest):
    public_url = get_luma_public_image_url(request.image_url)
    return {
        "image_url": request.image_url,
        "public_image_url": public_url,
        "public_base_url": get_public_backend_base_url(),
        "is_public_https": is_public_https_url(public_url),
    }


@app.post("/api/lyrics/filter")
async def filter_lyrics(request: FilterRequest):
    result = []
    for line in request.lyrics:
        result.append({
            "id": line.id,
            "text": line.text,
            "time": line.time,
            "skip": is_non_lyric(line.text)
        })
    return {"lyrics": result}


@app.post("/api/generate/storyboard")
async def generate_storyboard(request: StoryboardRequest):
    """按段落切分歌词，生成更细致的分镜。"""
    try:
        valid_lyrics = [
            lyric.model_copy(update={"text": strip_trailing_speaker_label(lyric.text)})
            for lyric in request.lyrics
            if not lyric.skip and not is_non_lyric(lyric.text) and lyric.text.strip()
        ]

        if not valid_lyrics:
            return {"scenes": [], "analysis": {
                "total_scenes": 0,
                "valid_lyrics": 0,
                "style": request.style,
                "summary": "没有有效歌词，请先导入歌词"
            }}

        duration = request.duration or max(valid_lyrics[-1].time + 3, 240)
        style_kw = STYLE_KEYWORDS.get(request.style, STYLE_KEYWORDS["cinematic"])
        global_summary = append_visual_lock_to_prompt(build_global_summary(valid_lyrics), request.visual_lock)
        segments = build_segments(valid_lyrics)
        scene_key_map: dict[str, int] = {}
        scenes = []

        for index, segment in enumerate(segments):
            combined_text = "，".join(line.text for line in segment)
            short_text = combined_text[:90]
            start_time = segment[0].time
            last_line_time = segment[-1].time
            next_start = segments[index + 1][0].time if index < len(segments) - 1 else duration
            end_time = max(last_line_time + 0.4, next_start - 0.12)
            arc = get_arc_template(index, len(segments))
            segment_keys = [normalize_lyric_text(line.text) for line in segment if normalize_lyric_text(line.text)]
            reuse_from = next((scene_key_map[key] for key in segment_keys if key in scene_key_map), None)
            variation_prompt = (
                "reuse the established chorus visual motif with a fresh camera angle, tighter continuity"
                if reuse_from is not None
                else "introduce a new but style-consistent composition"
            )
            prompt = (
                f"{arc['mood']}, song visual theme: '{global_summary}', lyrics segment: '{short_text}', "
                f"{style_kw}, {variation_prompt}, high quality, 4k, wide angle"
            )
            seed = stable_seed(f"{combined_text}-{request.style}-{index}")
            image_url = f"https://picsum.photos/seed/{seed}/1280/720"

            scenes.append({
                "scene_index": index,
                "title": f"分镜{index + 1} · {arc['title']}",
                "description": combined_text[:72] + ("..." if len(combined_text) > 72 else ""),
                "prompt": prompt,
                "start_time": start_time,
                "end_time": end_time,
                "lyric_ids": [line.id for line in segment],
                "image_url": image_url,
            })

            for key in set(segment_keys):
                scene_key_map.setdefault(key, index)

        average_lines = round(len(valid_lyrics) / max(len(scenes), 1), 1)
        analysis = {
            "total_scenes": len(scenes),
            "valid_lyrics": len(valid_lyrics),
            "style": request.style,
            "summary": f"已按段落切分 {len(valid_lyrics)} 行歌词，生成 {len(scenes)} 个分镜，平均每镜 {average_lines} 行歌词",
        }

        return {"scenes": scenes, "analysis": analysis}

    except Exception as e:
        print(f"[ERROR] generate_storyboard: {e}")
        import traceback
        traceback.print_exc()
        return {"scenes": [], "analysis": {
            "total_scenes": 0,
            "valid_lyrics": 0,
            "style": request.style,
            "summary": f"生成出错：{str(e)}"
        }}


@app.post("/api/analyze/director")
async def analyze_director(request: LyricScenesRequest):
    valid_lyrics = [
        lyric.model_copy(update={"text": strip_trailing_speaker_label(lyric.text)})
        for lyric in request.lyrics
        if not lyric.skip and not is_non_lyric(lyric.text) and lyric.text.strip()
    ]
    valid_lyrics.sort(key=lambda lyric: lyric.time)

    if not valid_lyrics:
        return {
            "director_analysis": {},
            "summary": "没有有效歌词，请先导入歌词",
        }

    director_analysis = build_director_analysis(valid_lyrics, request.style, request.song_name or "")
    duration = request.duration or max(valid_lyrics[-1].time + 4, 30)
    scene_groups = build_smart_scene_groups(valid_lyrics, duration)
    return {
        "director_analysis": director_analysis,
        "summary": f"已分析 {len(valid_lyrics)} 行有效歌词，建议生成 {len(scene_groups)} 个智能镜头",
    }


@app.post("/api/generate/smart-storyboard")
async def generate_smart_storyboard(request: LyricScenesRequest):
    """只生成导演分析和分镜结构；此阶段严禁调用收费图片接口。"""
    try:
        valid_lyrics = [
            lyric.model_copy(update={"text": strip_trailing_speaker_label(lyric.text)})
            for lyric in request.lyrics
            if not lyric.skip and not is_non_lyric(lyric.text) and lyric.text.strip()
        ]
        valid_lyrics.sort(key=lambda lyric: lyric.time)

        if not valid_lyrics:
            return {"scenes": [], "analysis": {
                "total_scenes": 0,
                "valid_lyrics": 0,
                "style": request.style,
                "summary": "没有有效歌词，请先导入歌词"
            }}

        fallback_duration = max(valid_lyrics[-1].time + 4, 30)
        duration = request.duration or fallback_duration
        duration = max(duration, valid_lyrics[-1].time + 1)
        policy = request.generation_policy or GenerationPolicyConfig()
        fallback_style = "cinematic" if request.style == "auto" else request.style
        director_analysis = build_director_analysis(valid_lyrics, fallback_style, request.song_name or "")
        fallback_visual_bible_text = build_visual_bible(
            valid_lyrics, fallback_style, request.song_name or "", request.visual_lock
        )
        scene_groups = build_smart_scene_groups(
            valid_lyrics,
            duration,
            policy.target_scene_seconds,
            policy.min_scene_seconds,
            policy.max_scene_seconds,
            request.music_energy,
        )
        llm_result: Optional[dict] = None
        llm_error = ""
        llm_config = request.llm_provider or LLMProviderConfig()
        llm_key = (llm_config.api_key or "").strip() or os.getenv("DEEPSEEK_API_KEY", "")
        if llm_key and (llm_config.provider or "deepseek").lower() == "deepseek":
            try:
                llm_result = await analyze_with_deepseek(
                    lyrics=[
                        {"id": line.id, "time": line.time, "text": line.text}
                        for line in valid_lyrics
                    ],
                    groups=scene_groups,
                    style=request.style,
                    song_name=request.song_name or "",
                    visual_lock=request.visual_lock.model_dump() if request.visual_lock else None,
                    api_key=llm_key,
                    base_url=llm_config.base_url or "https://api.deepseek.com/v1",
                    model=llm_config.model or "deepseek-chat",
                )
                director_analysis = {
                    **director_analysis,
                    "summary": llm_result.get("summary") or director_analysis["summary"],
                    "palette": llm_result.get("visual_bible", {}).get("palette") or [],
                    "negative_prompt": llm_result.get("visual_bible", {}).get("negative_prompt") or "",
                    "characters": llm_result.get("characters") or {},
                    "locations": llm_result.get("locations") or {},
                    "hero_props": llm_result.get("hero_props") or {},
                    "source": "deepseek",
                }
            except Exception as error:
                llm_error = str(error)
                print(f"[WARN] DeepSeek director fallback: {error}")

        if "characters" not in director_analysis:
            fallback_characters = {}
            if request.visual_lock and request.visual_lock.enabled and request.visual_lock.main_subject:
                fallback_characters["main"] = {
                    "name": "主角",
                    "description": request.visual_lock.main_subject,
                    "wardrobe": request.visual_lock.wardrobe or "",
                    "anchor_prompt": build_visual_lock_text(request.visual_lock),
                    "anchor_image": "",
                    "identity_prompt": build_visual_lock_text(request.visual_lock),
                    "identity_anchor_image": "",
                    "immutable_traits": [request.visual_lock.main_subject],
                    "stages": {
                        "default": {
                            "id": "default",
                            "name": "默认阶段",
                            "age_range": "",
                            "appearance": request.visual_lock.main_subject,
                            "hairstyle": "",
                            "wardrobe": request.visual_lock.wardrobe or "",
                            "temperament": "",
                            "anchor_prompt": build_visual_lock_text(request.visual_lock),
                            "anchor_image": "",
                            "version": 1,
                        }
                    },
                }
            director_analysis["characters"] = fallback_characters
        director_analysis.setdefault("source", "rules")
        llm_scenes = llm_result.get("scenes", []) if llm_result else []
        selected_style = str((llm_result or {}).get("selected_style") or fallback_style)
        if request.style != "auto":
            selected_style = request.style
        visual_bible_data = (llm_result or {}).get("visual_bible") or {
            "media": selected_style,
            "linework": "coherent linework across every shot",
            "character_rendering": "consistent character proportions and facial construction",
            "palette": director_analysis.get("palette") or [],
            "lighting": "coherent cinematic lighting",
            "era": "consistent world and period",
            "texture": fallback_visual_bible_text,
            "negative_prompt": (
                "blood, gore, horror, costume change, face change, deformed hands, extra limbs, "
                "text, subtitles, logo, watermark"
            ),
        }
        visual_fingerprint_payload = {
            "style": selected_style,
            "visual_bible": visual_bible_data,
            "image_provider": (request.image_provider or ImageProviderConfig()).provider,
            "image_model": (request.image_provider or ImageProviderConfig()).model,
            "image_size": (request.image_provider or ImageProviderConfig()).size,
            "image_quality": (request.image_provider or ImageProviderConfig()).quality,
            "video_provider": (request.video_provider or VideoProviderConfig()).provider,
            "video_model": (request.video_provider or VideoProviderConfig()).model,
            "aspect_ratio": "16:9",
            "prompt_version": policy.prompt_version,
        }
        visual_fingerprint = hashlib.sha256(
            json.dumps(visual_fingerprint_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()[:24]
        visual_bible_data = {
            **visual_bible_data,
            "version": policy.prompt_version,
            "fingerprint": visual_fingerprint,
            "selected_style": selected_style,
            "image_provider": visual_fingerprint_payload["image_provider"],
            "image_model": visual_fingerprint_payload["image_model"],
            "video_provider": visual_fingerprint_payload["video_provider"],
            "video_model": visual_fingerprint_payload["video_model"],
            "aspect_ratio": "16:9",
            "quality_mode": visual_fingerprint_payload["image_quality"],
            "prompt_version": policy.prompt_version,
            "locations": director_analysis.get("locations") or {},
            "hero_props": director_analysis.get("hero_props") or {},
        }
        scenes = []

        for index, group in enumerate(scene_groups):
            combined_text = "，".join(group.get("lyrics") or group.get("context_lyrics") or [])
            start_time = float(group["start_time"])
            end_time = float(group["end_time"])
            arc = get_scene_arc(index, len(scene_groups))
            ai_scene = llm_scenes[index] if index < len(llm_scenes) else {}
            prompt = ai_scene.get("image_prompt") or (
                f"{arc['mood']}，{arc['shot_type']}，诗意画面表现：{combined_text[:180]}。"
                f"整曲视觉圣经：{fallback_visual_bible_text}。"
                "避免血腥和恐怖直译，无字幕，无文字，无 logo，无水印。"
            )
            video_prompt = ai_scene.get("video_prompt") or (
                f"{arc['camera_motion']}, controlled 2D animation, subtle continuous motion, "
                "keep face, costume, linework, palette and props unchanged, no morphing"
            )
            character_id = str(ai_scene.get("character_id") or "")
            if character_id not in director_analysis.get("characters", {}):
                character_id = ""
            character_stage_id = str(ai_scene.get("character_stage_id") or "")
            stages = director_analysis.get("characters", {}).get(character_id, {}).get("stages", {})
            if character_stage_id not in stages:
                character_stage_id = next(iter(stages), "")

            scenes.append({
                "scene_index": index,
                "title": f"镜头 {index + 1} · {arc['title']}",
                "description": combined_text,
                "summary": ai_scene.get("summary") or combined_text[:80],
                "mood": ai_scene.get("mood") or arc["mood"],
                "imagery": ai_scene.get("imagery") or [director_analysis["visual_motif"]],
                "visual": director_analysis["visual_motif"],
                "character_id": character_id,
                "character_stage_id": character_stage_id,
                "location_id": str(ai_scene.get("location_id") or ""),
                "hero_prop_ids": ai_scene.get("hero_prop_ids") or [],
                "shot_type": ai_scene.get("shot_type") or arc["shot_type"],
                "camera_motion": ai_scene.get("camera_motion") or arc["camera_motion"],
                "transition": ai_scene.get("transition") or arc["transition"],
                "video_prompt": video_prompt,
                "prompt": prompt,
                "image_prompt": prompt,
                "start_time": start_time,
                "end_time": end_time,
                "lyric_ids": group.get("lyric_ids") or [],
                "image_url": "",
                "image_path": "",
                "video_path": "",
                "anchor_image": "",
                "first_frame": "",
                "last_frame": "",
                "requested_duration": round(end_time - start_time, 3),
                "rendered_duration": 0,
                "video_provider": "",
                "video_model": "",
                "provider_task_id": "",
                "style_fingerprint": visual_fingerprint,
                "quality_status": "pending",
                "quality_errors": [],
                "image_status": "idle",
                "video_status": "idle",
                "generation_status": "idle",
                "error": "",
                "reuse_from": ai_scene.get("reuse_from"),
            })

        analysis = {
            "total_scenes": len(scenes),
            "valid_lyrics": len(valid_lyrics),
            "style": selected_style,
            "resolved_style": selected_style,
            "song_type": (llm_result or {}).get("song_type") or detect_song_type(valid_lyrics),
            "sections": (llm_result or {}).get("sections") or [],
            "emotion_curve": (llm_result or {}).get("emotion_curve") or [],
            "visual_bible": visual_bible_data,
            "director_analysis": director_analysis,
            "characters": director_analysis.get("characters", {}),
            "summary": (
                f"已生成 {len(scenes)} 个 6-10 秒全云端候选镜头，覆盖 {len(valid_lyrics)} 行歌词；"
                "尚未调用任何收费图片或视频接口"
                + (f"；DeepSeek 不可用已回退规则分析：{llm_error[:120]}" if llm_error else "")
            ),
        }

        return {"scenes": scenes, "analysis": analysis}

    except Exception as e:
        print(f"[ERROR] generate_smart_storyboard: {e}")
        import traceback
        traceback.print_exc()
        return {"scenes": [], "analysis": {
            "total_scenes": 0,
            "valid_lyrics": 0,
            "style": request.style,
            "summary": f"生成出错：{str(e)}"
        }}


@app.post("/api/generate/lyric-scenes")
async def generate_lyric_scenes(request: LyricScenesRequest):
    """逐句生成分镜：每句有效歌词对应一张画面，并按歌词时间戳对齐。"""
    try:
        valid_lyrics = [
            lyric.model_copy(update={"text": strip_trailing_speaker_label(lyric.text)})
            for lyric in request.lyrics
            if not lyric.skip and not is_non_lyric(lyric.text) and lyric.text.strip()
        ]
        valid_lyrics.sort(key=lambda lyric: lyric.time)

        if not valid_lyrics:
            return {"scenes": [], "analysis": {
                "total_scenes": 0,
                "valid_lyrics": 0,
                "style": request.style,
                "summary": "没有有效歌词，请先导入歌词"
            }}

        fallback_duration = max(valid_lyrics[-1].time + 4, 30)
        duration = request.duration or fallback_duration
        duration = max(duration, valid_lyrics[-1].time + 1)
        visual_bible = build_visual_bible(valid_lyrics, request.style, request.song_name or "", request.visual_lock)
        visual_groups = build_visual_groups(valid_lyrics)
        image_provider = get_image_provider_config(request.image_provider)
        using_ai_images = image_provider.provider != "placeholder"
        generated_count = 0
        failed_count = 0
        scenes = []

        for index, group in enumerate(visual_groups):
            combined_text = "，".join(line.text.strip() for line in group if line.text.strip())
            previous_text = visual_groups[index - 1][-1].text if index > 0 else ""
            next_text = visual_groups[index + 1][0].text if index < len(visual_groups) - 1 else ""
            start_time = 0.0 if index == 0 else group[0].time
            next_time = visual_groups[index + 1][0].time if index < len(visual_groups) - 1 else duration
            end_time = max(start_time + 0.4, next_time)
            prompt = build_lyric_group_scene_prompt(
                current_text=combined_text,
                style=request.style,
                visual_bible=visual_bible,
                previous_text=previous_text,
                next_text=next_text,
            )
            group_key = "|".join(f"{line.id}:{line.text}" for line in group)
            seed = stable_seed(f"lyric-scene-{group_key}-{request.style}-{index}")
            image_url, generated_with_ai, image_error = await resolve_image_url(
                prompt,
                cache_key=f"lyric-scene-{group_key}-{request.style}-{index}",
                placeholder_seed=seed,
                config=image_provider,
            )
            if generated_with_ai:
                generated_count += 1
            elif image_error:
                failed_count += 1

            scenes.append({
                "scene_index": index,
                "title": f"歌词画面 {index + 1}",
                "description": combined_text,
                "prompt": prompt,
                "start_time": start_time,
                "end_time": end_time,
                "lyric_ids": [line.id for line in group],
                "image_url": image_url,
            })

        analysis = {
            "total_scenes": len(scenes),
            "valid_lyrics": len(valid_lyrics),
            "style": request.style,
            "summary": (
                f"已合并短句并使用 AI 生成 {generated_count}/{len(visual_groups)} 张连贯画面，覆盖 {len(valid_lyrics)} 行歌词"
                + (f"，{failed_count} 张失败后使用占位图" if failed_count else "")
                if using_ai_images
                else f"已合并短句为 {len(visual_groups)} 个画面组，覆盖 {len(valid_lyrics)} 行歌词；当前使用占位图模式"
            ),
        }

        return {"scenes": scenes, "analysis": analysis}

    except Exception as e:
        print(f"[ERROR] generate_lyric_scenes: {e}")
        import traceback
        traceback.print_exc()
        return {"scenes": [], "analysis": {
            "total_scenes": 0,
            "valid_lyrics": 0,
            "style": request.style,
            "summary": f"生成出错：{str(e)}"
        }}


@app.post("/api/generate/prompt")
async def generate_prompt(request: GeneratePromptRequest):
    prompt = build_visual_prompt(request.lyric, request.style)
    return {"prompt": prompt}


@app.post("/api/generate/batch")
async def generate_batch(request: BatchGenerateRequest):
    results = []
    valid_lyrics = [
        line.model_copy(update={"text": strip_trailing_speaker_label(line.text)})
        for line in request.lyrics
        if not line.skip and line.text.strip()
    ]
    visual_bible = build_visual_bible(valid_lyrics, request.style, visual_lock=request.visual_lock)
    visual_groups = build_visual_groups(valid_lyrics)
    image_provider = get_image_provider_config(request.image_provider)

    for index, group in enumerate(visual_groups):
        combined_text = "，".join(line.text.strip() for line in group if line.text.strip())
        prompt = build_lyric_group_scene_prompt(
            current_text=combined_text,
            style=request.style,
            visual_bible=visual_bible,
            previous_text=visual_groups[index - 1][-1].text if index > 0 else "",
            next_text=visual_groups[index + 1][0].text if index < len(visual_groups) - 1 else "",
        )
        group_key = "|".join(f"{line.id}:{line.text}" for line in group)
        seed = stable_seed(f"batch-{group_key}-{request.style}")
        image_url, _, _ = await resolve_image_url(
            prompt,
            cache_key=f"batch-{group_key}-{request.style}",
            placeholder_seed=seed,
            config=image_provider,
        )

        for line in group:
            results.append({
                "id": line.id,
                "image_url": image_url,
                "prompt": prompt,
            })

    return {"results": results}


def build_single_image_cache_key(request: GenerateImageRequest | CachedSceneImageRequest, visual_lock: Optional[VisualLockConfig] = None) -> tuple[str, str]:
    request_visual_lock = request.visual_lock if isinstance(request, GenerateImageRequest) else visual_lock
    prompt = append_visual_lock_to_prompt(request.prompt, request_visual_lock)
    lyric_id = request.lyric_id if isinstance(request, GenerateImageRequest) else ""
    cache_key = (
        f"single-{request.scene_index}-{lyric_id or ''}-"
        f"{request.character_id or ''}-{request.anchor_image or ''}-"
        f"{'|'.join(request.reference_images)}-{prompt}"
    )
    return prompt, cache_key


def list_cached_image_files() -> list[Path]:
    allowed_suffixes = {".png", ".jpg", ".jpeg", ".webp"}
    try:
        files = [
            path for path in GENERATED_DIR.iterdir()
            if path.is_file() and path.suffix.lower() in allowed_suffixes and path.stat().st_size > 0
        ]
    except OSError:
        return []
    return sorted(files, key=lambda path: (path.stat().st_mtime_ns, path.name.lower()))


@app.post("/api/images/cache/restore")
async def restore_image_cache(request: RestoreImageCacheRequest):
    cached_files = list_cached_image_files()
    cached_by_stem = {path.stem: path for path in cached_files}
    recovered: list[dict] = []
    unmatched: list[CachedSceneImageRequest] = []
    used_paths: set[Path] = set()

    for scene in sorted(request.scenes, key=lambda item: item.scene_index):
        _prompt, cache_key = build_single_image_cache_key(scene, request.visual_lock)
        matched_path = cached_by_stem.get(stable_file_stem(cache_key))
        if matched_path and matched_path not in used_paths:
            recovered.append({
                "scene_index": scene.scene_index,
                "image_url": get_public_image_url(matched_path),
                "file_name": matched_path.name,
                "match_mode": "exact",
            })
            used_paths.add(matched_path)
        else:
            unmatched.append(scene)

    ordered_fallback_used = False
    remaining_files = [path for path in cached_files if path not in used_paths]
    if (
        request.allow_ordered_fallback
        and unmatched
        and len(cached_files) == len(request.scenes)
        and len(remaining_files) == len(unmatched)
    ):
        ordered_fallback_used = True
        for scene, matched_path in zip(sorted(unmatched, key=lambda item: item.scene_index), remaining_files):
            recovered.append({
                "scene_index": scene.scene_index,
                "image_url": get_public_image_url(matched_path),
                "file_name": matched_path.name,
                "match_mode": "ordered_fallback",
            })
        unmatched = []

    recovered.sort(key=lambda item: item["scene_index"])
    return {
        "recovered": recovered,
        "recovered_count": len(recovered),
        "unmatched_scene_indexes": [scene.scene_index for scene in unmatched],
        "cache_file_count": len(cached_files),
        "ordered_fallback_used": ordered_fallback_used,
        "cloud_requests": 0,
    }


@app.post("/api/generate/image")
async def generate_image(request: GenerateImageRequest):
    try:
        seed = stable_seed(request.prompt)
        prompt, cache_key = build_single_image_cache_key(request)
        provider_config = get_image_provider_config(request.image_provider)
        if provider_config.provider == "placeholder":
            image_url = get_placeholder_url(seed, provider_config)
        else:
            image_url = await generate_provider_image(
                prompt,
                cache_key,
                provider_config,
                request.anchor_image or "",
                request.reference_images,
            )
            if not image_url:
                raise RuntimeError(f"{provider_config.provider} 未返回图片")
        return {
            "image_url": image_url,
            "scene_index": request.scene_index,
            "lyric_id": request.lyric_id,
            "prompt": prompt,
        }
    except Exception as e:
        print(f"[ERROR] generate_image: {e}")
        raise HTTPException(status_code=502, detail=f"图片生成失败：{e}") from e


def get_runway_model(model: str) -> str:
    normalized = (model or "").strip().lower()
    model_map = {
        "gen-4": "gen4_turbo",
        "gen4": "gen4_turbo",
        "gen-4-turbo": "gen4_turbo",
        "gen-3-alpha": "gen3a_turbo",
        "gen-3-alpha-turbo": "gen3a_turbo",
    }
    return model_map.get(normalized, normalized or "gen4_turbo")


def get_runway_duration(duration: float) -> int:
    return 5 if duration <= 5.0 else 10


def get_luma_model(model: str) -> str:
    normalized = (model or "").strip().lower()
    model_map = {
        "ray-2": "ray-2",
        "ray2": "ray-2",
        "dream-machine": "ray-2",
        "ray-flash-2": "ray-flash-2",
        "ray-flash": "ray-flash-2",
    }
    return model_map.get(normalized, normalized or "ray-2")


def get_luma_duration(duration: float) -> str:
    return "5s" if duration <= 5.0 else "9s"


def is_public_https_url(url: str) -> bool:
    return url.startswith("https://")


def is_valid_kling_api_key(token: str) -> bool:
    prefix = "api-key-kling-"
    suffix = token[len(prefix):] if token.startswith(prefix) else ""
    return len(suffix) >= 20 and re.fullmatch(r"[A-Za-z0-9_-]+", suffix) is not None


def kling_credential_error() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail="Kling API Key 格式错误：必须以 api-key-kling- 开头，请从 Kling 开放平台重新复制",
    )


def get_kling_auth_token(provider_config: VideoProviderConfig) -> str:
    raw_key = (provider_config.api_key or "").strip()
    env_token = os.getenv("KLING_API_TOKEN", "").strip()

    if raw_key:
        if is_valid_kling_api_key(raw_key):
            return raw_key
        raise kling_credential_error()

    if env_token:
        if is_valid_kling_api_key(env_token):
            return env_token
        raise kling_credential_error()

    raise HTTPException(status_code=400, detail="Kling 需要填写以 api-key-kling- 开头的新版 API Key")


def kling_response_body(response: httpx.Response) -> str:
    body = (response.text or "").strip().replace("\r", " ").replace("\n", " ")
    return body[:400] or "空响应"


def parse_kling_response(response: httpx.Response, action: str) -> dict:
    try:
        data = response.json()
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Kling {action}返回了无法解析的响应（HTTP {response.status_code}）：{kling_response_body(response)}",
        ) from exc

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail=f"Kling {action}返回格式异常：应为 JSON 对象")

    code = data.get("code")
    if code not in (None, 0, "0"):
        provider_message = str(data.get("message") or data.get("msg") or "未知错误")[:300]
        if str(code) == "1002":
            detail = "Kling API Key 无效或已撤销，请在开放平台重新生成并确认 API 套餐已启用"
        else:
            detail = f"Kling {action}失败（错误码 {code}）：{provider_message}"
        raise HTTPException(status_code=502, detail=detail)
    return data


def kling_http_error_detail(response: httpx.Response, action: str) -> str:
    try:
        parse_kling_response(response, action)
    except HTTPException as exc:
        return str(exc.detail)
    return f"Kling {action}失败（HTTP {response.status_code}）：{kling_response_body(response)}"


def extract_kling_task_data(response_data: dict, action: str) -> dict:
    task_data = response_data.get("data", response_data)
    if not isinstance(task_data, dict):
        raise HTTPException(status_code=502, detail=f"Kling {action}返回格式异常：缺少任务对象")
    return task_data


def get_kling_model(model: str) -> str:
    normalized = (model or "").strip().lower()
    model_map = {
        "kling-image-to-video": "kling-v1-6",
        "kling-v1": "kling-v1",
        "kling-v1-5": "kling-v1-5",
        "kling-v1-6": "kling-v1-6",
        "kling-v2-1": "kling-v2-1",
        "kling-v2-5-turbo": "kling-v2-5-turbo",
    }
    return model_map.get(normalized, normalized or "kling-v1-6")


def get_kling_duration(duration: float) -> str:
    return "5" if duration <= 5.0 else "10"


async def get_kling_image_source(image_url: str) -> str:
    if image_url.startswith("https://"):
        return image_url
    data_uri = image_url if image_url.startswith("data:image/") else await image_source_to_data_uri(image_url)
    return data_uri.split(",", 1)[1] if "," in data_uri else data_uri


async def generate_runway_video(request: GenerateVideoRequest, provider_config: VideoProviderConfig, duration: float):
    api_key = (provider_config.api_key or "").strip() or os.getenv("RUNWAY_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="Runway 需要 API key")

    cache_key = stable_file_stem(
        f"runway-{request.scene_index}-{request.image_url}-{request.last_frame_url}-{request.prompt}-"
        f"{provider_config.model}-{duration}-{request.style_fingerprint}"
    )
    file_path = GENERATED_VIDEO_DIR / f"{cache_key}.mp4"
    if file_path.exists() and file_path.stat().st_size > 0:
        cached_task = get_resumable_video_task(cache_key, "runway") or {}
        return completed_video_payload(
            video_url=get_public_video_url(file_path),
            scene_index=request.scene_index or 0,
            provider="runway",
            task_id=str(cached_task.get("task_id") or ""),
            file_path=file_path,
            rendered_duration=float(get_runway_duration(duration)),
            requested_duration=duration,
            cached=True,
        )

    base_url = (provider_config.base_url or "").strip() or "https://api.dev.runwayml.com/v1"
    base_url = base_url.rstrip("/")
    prompt_image = await get_runway_prompt_image(request.image_url)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06",
    }
    payload = {
        "model": get_runway_model(provider_config.model),
        "promptImage": prompt_image,
        "promptText": (request.prompt or "")[:1000],
        "ratio": "1280:720",
        "duration": get_runway_duration(duration),
    }

    async with httpx.AsyncClient(
        timeout=120.0,
        follow_redirects=True,
        trust_env=should_trust_system_proxy(base_url),
    ) as client:
        resumable = get_resumable_video_task(cache_key, "runway")
        task_id = str(resumable.get("task_id")) if resumable and resumable.get("task_id") else ""
        if task_id:
            task_response = await client.get(f"{base_url}/tasks/{task_id}", headers=headers)
            task_response.raise_for_status()
            task_data = task_response.json()
        else:
            try:
                create_response = await client.post(f"{base_url}/image_to_video", json=payload, headers=headers)
                create_response.raise_for_status()
                task_data = create_response.json()
            except httpx.HTTPStatusError as exc:
                raise HTTPException(
                    status_code=exc.response.status_code,
                    detail=f"Runway 创建任务失败：{exc.response.text[:400]}",
                ) from exc
            task_id = str(task_data.get("id") or "")
            if not task_id:
                raise HTTPException(status_code=502, detail="Runway 未返回任务 id")
            await save_video_task(cache_key, {
                "provider": "runway", "task_id": task_id, "status": "pending", "scene_index": request.scene_index
            })
        for _ in range(120):
            status = str(task_data.get("status", "")).upper()
            if status in {"SUCCEEDED", "SUCCESS", "COMPLETED"}:
                output = task_data.get("output")
                if not isinstance(output, list) or not output:
                    raise HTTPException(status_code=502, detail="Runway 任务成功但未返回 output")
                video_url = output[0]
                local_video_url = await download_video_to_cache(video_url, file_path)
                await save_video_task(cache_key, {"status": "done", "local_video_url": local_video_url})
                return completed_video_payload(
                    video_url=local_video_url,
                    scene_index=request.scene_index or 0,
                    provider="runway",
                    task_id=task_id,
                    file_path=file_path,
                    rendered_duration=float(get_runway_duration(duration)),
                    requested_duration=duration,
                )

            if status in {"FAILED", "CANCELLED", "CANCELED"}:
                failure = task_data.get("failure") or task_data.get("error") or task_data
                await save_video_task(cache_key, {"status": "failed", "error": str(failure)[:1000]})
                raise HTTPException(status_code=502, detail=f"Runway 任务失败：{failure}")

            await asyncio.sleep(5)
            try:
                task_response = await client.get(f"{base_url}/tasks/{task_id}", headers=headers)
                task_response.raise_for_status()
                task_data = task_response.json()
            except httpx.HTTPStatusError as exc:
                raise HTTPException(
                    status_code=exc.response.status_code,
                    detail=f"Runway 查询任务失败：{exc.response.text[:400]}",
                ) from exc

    raise HTTPException(status_code=504, detail="Runway 任务等待超时，请稍后重试")


async def generate_luma_video(request: GenerateVideoRequest, provider_config: VideoProviderConfig, duration: float):
    api_key = (provider_config.api_key or "").strip() or os.getenv("LUMA_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="Luma 需要 API key")

    prompt_image_url = get_luma_public_image_url(request.image_url)

    if not is_public_https_url(prompt_image_url):
        raise HTTPException(
            status_code=400,
            detail="Luma 图生视频需要外网可访问的 HTTPS 图片 URL；可设置 PUBLIC_BACKEND_BASE_URL 为 Cloudflare Tunnel/ngrok 地址",
        )

    cache_key = stable_file_stem(
        f"luma-{request.scene_index}-{prompt_image_url}-{request.last_frame_url}-{request.prompt}-"
        f"{provider_config.model}-{duration}-{request.style_fingerprint}"
    )
    file_path = GENERATED_VIDEO_DIR / f"{cache_key}.mp4"
    if file_path.exists() and file_path.stat().st_size > 0:
        cached_task = get_resumable_video_task(cache_key, "luma") or {}
        return completed_video_payload(
            video_url=get_public_video_url(file_path),
            scene_index=request.scene_index or 0,
            provider="luma",
            task_id=str(cached_task.get("task_id") or ""),
            file_path=file_path,
            rendered_duration=float(get_luma_duration(duration).rstrip("s")),
            requested_duration=duration,
            cached=True,
        )

    base_url = (provider_config.base_url or "").strip() or "https://api.lumalabs.ai/dream-machine/v1"
    base_url = base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "prompt": (request.prompt or "")[:5000],
        "model": get_luma_model(provider_config.model),
        "duration": get_luma_duration(duration),
        "aspect_ratio": "16:9",
        "keyframes": {
            "frame0": {
                "type": "image",
                "url": prompt_image_url,
            }
        },
    }
    if request.last_frame_url:
        public_last_frame = get_luma_public_image_url(request.last_frame_url)
        if is_public_https_url(public_last_frame):
            payload["keyframes"]["frame1"] = {"type": "image", "url": public_last_frame}

    async with httpx.AsyncClient(
        timeout=120.0,
        follow_redirects=True,
        trust_env=should_trust_system_proxy(base_url),
    ) as client:
        resumable = get_resumable_video_task(cache_key, "luma")
        generation_id = str(resumable.get("task_id")) if resumable and resumable.get("task_id") else ""
        if generation_id:
            generation_response = await client.get(f"{base_url}/generations/{generation_id}", headers=headers)
            generation_response.raise_for_status()
            generation_data = generation_response.json()
        else:
            try:
                create_response = await client.post(f"{base_url}/generations", json=payload, headers=headers)
                create_response.raise_for_status()
                generation_data = create_response.json()
            except httpx.HTTPStatusError as exc:
                raise HTTPException(
                    status_code=exc.response.status_code,
                    detail=f"Luma 创建任务失败：{exc.response.text[:400]}",
                ) from exc
            generation_id = str(generation_data.get("id") or "")
            if not generation_id:
                raise HTTPException(status_code=502, detail="Luma 未返回 generation id")
            await save_video_task(cache_key, {
                "provider": "luma", "task_id": generation_id, "status": "pending", "scene_index": request.scene_index
            })

        for _ in range(120):
            state = str(generation_data.get("state", "")).lower()
            if state in {"completed", "succeeded", "success"}:
                assets = generation_data.get("assets") or {}
                video_url = assets.get("video") if isinstance(assets, dict) else None
                if not video_url:
                    raise HTTPException(status_code=502, detail="Luma 任务成功但未返回 assets.video")
                local_video_url = await download_video_to_cache(video_url, file_path)
                await save_video_task(cache_key, {"status": "done", "local_video_url": local_video_url})
                return completed_video_payload(
                    video_url=local_video_url,
                    scene_index=request.scene_index or 0,
                    provider="luma",
                    task_id=generation_id,
                    file_path=file_path,
                    rendered_duration=float(get_luma_duration(duration).rstrip("s")),
                    requested_duration=duration,
                )

            if state in {"failed", "failure", "canceled", "cancelled"}:
                failure = generation_data.get("failure_reason") or generation_data.get("error") or generation_data
                await save_video_task(cache_key, {"status": "failed", "error": str(failure)[:1000]})
                raise HTTPException(status_code=502, detail=f"Luma 任务失败：{failure}")

            await asyncio.sleep(5)
            try:
                generation_response = await client.get(f"{base_url}/generations/{generation_id}", headers=headers)
                generation_response.raise_for_status()
                generation_data = generation_response.json()
            except httpx.HTTPStatusError as exc:
                raise HTTPException(
                    status_code=exc.response.status_code,
                    detail=f"Luma 查询任务失败：{exc.response.text[:400]}",
                ) from exc

    raise HTTPException(status_code=504, detail="Luma 任务等待超时，请稍后重试")


async def generate_kling_video(request: GenerateVideoRequest, provider_config: VideoProviderConfig, duration: float):
    token = get_kling_auth_token(provider_config)
    cache_key = stable_file_stem(
        f"kling-{request.scene_index}-{request.image_url}-{request.last_frame_url}-{request.prompt}-"
        f"{provider_config.model}-{duration}-{request.style_fingerprint}"
    )
    file_path = GENERATED_VIDEO_DIR / f"{cache_key}.mp4"
    if file_path.exists() and file_path.stat().st_size > 0:
        cached_task = get_resumable_video_task(cache_key, "kling") or {}
        return completed_video_payload(
            video_url=get_public_video_url(file_path),
            scene_index=request.scene_index or 0,
            provider="kling",
            task_id=str(cached_task.get("task_id") or ""),
            file_path=file_path,
            rendered_duration=float(get_kling_duration(duration)),
            requested_duration=duration,
            cached=True,
        )

    base_url = (provider_config.base_url or "").strip() or "https://api-beijing.klingai.com/v1"
    base_url = base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    try:
        first_frame = await get_kling_image_source(request.image_url)
        last_frame = await get_kling_image_source(request.last_frame_url) if request.last_frame_url else ""
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Kling 关键帧读取失败：{exc}") from exc

    payload = {
        "model_name": get_kling_model(provider_config.model),
        "image": first_frame,
        "prompt": (request.prompt or "")[:2500],
        "duration": get_kling_duration(duration),
        "mode": "std",
        "cfg_scale": 0.5,
    }
    if last_frame:
        payload["image_tail"] = last_frame

    async with httpx.AsyncClient(
        timeout=120.0,
        follow_redirects=True,
        trust_env=should_trust_system_proxy(base_url),
    ) as client:
        resumable = get_resumable_video_task(cache_key, "kling")
        task_id = str(resumable.get("task_id")) if resumable and resumable.get("task_id") else ""
        if task_id:
            try:
                task_response = await client.get(f"{base_url}/videos/image2video/{task_id}", headers=headers)
                task_response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=kling_http_error_detail(exc.response, "查询任务"),
                ) from exc
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"无法连接 Kling 查询任务：{exc}") from exc
            query_data = parse_kling_response(task_response, "查询任务")
            task_data = extract_kling_task_data(query_data, "查询任务")
        else:
            try:
                create_response = await client.post(f"{base_url}/videos/image2video", json=payload, headers=headers)
                create_response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=kling_http_error_detail(exc.response, "创建任务"),
                ) from exc
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"无法连接 Kling 创建任务：{exc}") from exc
            create_data = parse_kling_response(create_response, "创建任务")
            data = extract_kling_task_data(create_data, "创建任务")
            task_id_value = data.get("task_id")
            task_id = str(task_id_value or "")
            if not task_id:
                raise HTTPException(status_code=502, detail="Kling 创建任务响应中缺少 task_id，任务未被记录，请勿连续重试")
            task_data = data
            await save_video_task(cache_key, {
                "provider": "kling", "task_id": task_id, "status": "pending", "scene_index": request.scene_index
            })
        for _ in range(120):
            status = str(task_data.get("task_status") or task_data.get("status") or "").lower()
            if status in {"succeed", "succeeded", "success", "completed"}:
                task_result = task_data.get("task_result") or {}
                videos = task_result.get("videos") if isinstance(task_result, dict) else None
                video_url = videos[0].get("url") if isinstance(videos, list) and videos and isinstance(videos[0], dict) else None
                if not video_url:
                    video_url = task_data.get("video_url") or task_data.get("url")
                if not video_url:
                    raise HTTPException(status_code=502, detail="Kling 任务成功但未返回视频 URL")
                try:
                    local_video_url = await download_video_to_cache(video_url, file_path)
                except httpx.HTTPStatusError as exc:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Kling 视频下载失败（HTTP {exc.response.status_code}）",
                    ) from exc
                except httpx.RequestError as exc:
                    raise HTTPException(status_code=502, detail=f"无法连接 Kling 下载生成视频：{exc}") from exc
                except Exception as exc:
                    raise HTTPException(status_code=502, detail=f"Kling 视频保存失败：{exc}") from exc
                await save_video_task(cache_key, {"status": "done", "local_video_url": local_video_url})
                return completed_video_payload(
                    video_url=local_video_url,
                    scene_index=request.scene_index or 0,
                    provider="kling",
                    task_id=task_id,
                    file_path=file_path,
                    rendered_duration=float(get_kling_duration(duration)),
                    requested_duration=duration,
                )

            if status in {"failed", "failure", "canceled", "cancelled"}:
                reason = task_data.get("task_status_msg") or task_data.get("error") or task_data
                await save_video_task(cache_key, {"status": "failed", "error": str(reason)[:1000]})
                raise HTTPException(status_code=502, detail=f"Kling 任务失败：{reason}")

            await asyncio.sleep(5)
            try:
                task_response = await client.get(f"{base_url}/videos/image2video/{task_id}", headers=headers)
                task_response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise HTTPException(
                    status_code=502,
                    detail=kling_http_error_detail(exc.response, "查询任务"),
                ) from exc
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"无法连接 Kling 查询任务：{exc}") from exc

            query_data = parse_kling_response(task_response, "查询任务")

            task_data = extract_kling_task_data(query_data, "查询任务")

    raise HTTPException(status_code=504, detail="Kling 任务等待超时，请稍后重试")


@app.post("/api/generate/video")
async def generate_video(request: GenerateVideoRequest):
    provider_config = request.video_provider or VideoProviderConfig()
    provider = (provider_config.provider or "local_motion").strip().lower()
    duration = max(0.5, float(request.duration or provider_config.clip_seconds or 6.0))

    if provider == "none":
        raise HTTPException(status_code=400, detail="当前已关闭视频模型")

    if provider == "local_motion":
        return {
            "video_url": f"local-motion://scene/{request.scene_index}",
            "scene_index": request.scene_index,
            "provider": provider,
            "status": "ready_for_export",
            "message": "本地动态片段会在导出时由 ffmpeg 根据关键帧和镜头运动生成",
        }

    if provider == "custom":
        if not provider_config.base_url:
            raise HTTPException(status_code=400, detail="自定义视频模型需要填写 Base URL")

        cache_key = stable_file_stem(
            f"custom-{request.scene_index}-{request.image_url}-{request.last_frame_url}-{request.prompt}-"
            f"{provider_config.model}-{duration}-{request.style_fingerprint}"
        )
        file_path = GENERATED_VIDEO_DIR / f"{cache_key}.mp4"
        if file_path.exists() and file_path.stat().st_size > 0:
            cached_task = get_resumable_video_task(cache_key, "custom") or {}
            return completed_video_payload(
                video_url=get_public_video_url(file_path),
                scene_index=request.scene_index or 0,
                provider="custom",
                task_id=str(cached_task.get("task_id") or ""),
                file_path=file_path,
                rendered_duration=duration,
                requested_duration=duration,
                cached=True,
            )

        headers = {"Content-Type": "application/json"}
        if provider_config.api_key:
            headers["Authorization"] = f"Bearer {provider_config.api_key}"

        payload = {
            "model": provider_config.model,
            "prompt": request.prompt,
            "image_url": request.image_url,
            "last_frame_url": request.last_frame_url,
            "style_fingerprint": request.style_fingerprint,
            "duration": duration,
            "camera_motion": request.camera_motion,
            "scene_index": request.scene_index,
        }

        try:
            async with httpx.AsyncClient(
                timeout=120.0,
                trust_env=should_trust_system_proxy(provider_config.base_url),
            ) as client:
                response = await client.post(provider_config.base_url, json=payload, headers=headers)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=exc.response.status_code,
                detail=f"自定义视频模型请求失败：{exc.response.text[:300]}",
            ) from exc
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"自定义视频模型不可用：{exc}") from exc

        video_url = (
            data.get("video_url")
            or data.get("url")
            or data.get("output_url")
            or data.get("result", {}).get("video_url")
            if isinstance(data, dict)
            else None
        )
        if not video_url:
            raise HTTPException(status_code=502, detail="自定义视频模型未返回 video_url")
        task_id = str(data.get("task_id") or data.get("id") or "") if isinstance(data, dict) else ""
        local_video_url = await download_video_to_cache(str(video_url), file_path)
        await save_video_task(cache_key, {
            "provider": "custom",
            "task_id": task_id,
            "status": "done",
            "scene_index": request.scene_index,
            "local_video_url": local_video_url,
        })
        result = completed_video_payload(
            video_url=local_video_url,
            scene_index=request.scene_index or 0,
            provider="custom",
            task_id=task_id,
            file_path=file_path,
            rendered_duration=duration,
            requested_duration=duration,
        )
        result["raw"] = data
        return result

    if provider == "runway":
        return await generate_runway_video(request, provider_config, duration)

    if provider == "luma":
        return await generate_luma_video(request, provider_config, duration)

    if provider == "kling":
        return await generate_kling_video(request, provider_config, duration)

    raise HTTPException(status_code=400, detail=f"未知视频提供商：{provider_config.provider}")


if __name__ == "__main__":
    is_frozen = bool(getattr(sys, "frozen", False))
    reload_enabled = os.getenv("MUSIC_VIDEO_RELOAD", "1") == "1" and not is_frozen
    port = int(os.getenv("MUSIC_VIDEO_BACKEND_PORT", "8000"))
    if reload_enabled:
        uvicorn.run("main:app", host="127.0.0.1", port=port, reload=True)
    else:
        uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
