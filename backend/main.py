from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import List, Optional
import uvicorn
import asyncio
import re
import hashlib
import hmac
import json
import base64
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlparse
import httpx

app = FastAPI(title="Music Video Generator API", version="1.0.0")

DATA_DIR = Path(os.getenv("MUSIC_VIDEO_DATA_DIR", Path(__file__).resolve().parent))
GENERATED_DIR = DATA_DIR / "generated_images"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)
GENERATED_VIDEO_DIR = DATA_DIR / "generated_videos"
GENERATED_VIDEO_DIR.mkdir(parents=True, exist_ok=True)

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
        parts.append(f"wardrobe and appearance: {visual_lock.wardrobe.strip()}")
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
        + ". Keep identity, costume, world, palette, and symbols consistent across every shot."
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
        transition = "fade out"
    return {**arc, "shot_type": shot_type, "camera_motion": camera_motion, "transition": transition}


def build_smart_scene_groups(valid_lyrics: List["LyricLine"]) -> List[List["LyricLine"]]:
    segments = build_segments(valid_lyrics)
    visual_groups = build_visual_groups(valid_lyrics)

    if len(segments) <= 1 and len(visual_groups) > 1:
        return visual_groups

    refined: List[List["LyricLine"]] = []
    for segment in segments:
        if not segment:
            continue
        segment_groups = build_visual_groups(segment)
        if len(segment_groups) == 1:
            refined.append(segment_groups[0])
            continue

        current: List["LyricLine"] = []
        for group in segment_groups:
            if not current:
                current = group[:]
                continue
            current_duration = group[-1].time - current[0].time
            if len(current) + len(group) <= 5 and current_duration < 14:
                current.extend(group)
            else:
                refined.append(current)
                current = group[:]
        if current:
            refined.append(current)

    return refined or visual_groups


def stable_seed(value: str) -> int:
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 1000


def stable_file_stem(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:24]


def get_public_image_url(file_path: Path) -> str:
    return f"http://localhost:8000/generated/{file_path.name}"


def get_public_video_url(file_path: Path) -> str:
    return f"http://localhost:8000/generated-videos/{file_path.name}"


def get_public_backend_base_url() -> str:
    return (
        os.getenv("PUBLIC_BACKEND_BASE_URL", "").strip()
        or os.getenv("PUBLIC_ASSET_BASE_URL", "").strip()
    ).rstrip("/")


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
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        file_path.write_bytes(response.content)
    return get_public_image_url(file_path)


async def download_video_to_cache(url: str, file_path: Path, headers: Optional[dict[str, str]] = None) -> str:
    async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()
        file_path.write_bytes(response.content)
    return get_public_video_url(file_path)


async def image_source_to_data_uri(image_url: str) -> str:
    if image_url.startswith("data:image/"):
        return image_url

    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        response = await client.get(image_url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "image/jpeg").split(";")[0]
        if not content_type.startswith("image/"):
            content_type = "image/jpeg"
        encoded = base64.b64encode(response.content).decode("utf-8")
        return f"data:{content_type};base64,{encoded}"


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

    model = (provider_config.model or "").strip() or os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1.5")
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

    async with httpx.AsyncClient(timeout=120) as client:
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
            async with httpx.AsyncClient(timeout=120) as client:
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


async def generate_provider_image(prompt: str, cache_key: str, config: Optional["ImageProviderConfig"] = None) -> Optional[str]:
    provider_config = get_image_provider_config(config)

    if provider_config.provider == "placeholder":
        return None
    if provider_config.provider == "pollinations":
        return await generate_pollinations_image(prompt, cache_key, provider_config)
    if provider_config.provider in {"openai", "custom"}:
        return await generate_openai_image(prompt, cache_key, provider_config)

    return await generate_pollinations_image(prompt, cache_key, provider_config)


async def resolve_image_url(
    prompt: str,
    cache_key: str,
    placeholder_seed: int,
    config: Optional["ImageProviderConfig"] = None,
) -> tuple[str, bool, Optional[str]]:
    placeholder_url = get_placeholder_url(placeholder_seed, config)

    try:
        image_url = await generate_provider_image(prompt, cache_key, config)
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


class VideoProviderConfig(BaseModel):
    provider: str = "local_motion"
    model: str = "ken-burns"
    api_key: Optional[str] = ""
    base_url: Optional[str] = ""
    motion_strength: str = "standard"
    clip_seconds: float = 6.0


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
    visual_lock: Optional[VisualLockConfig] = None


class GenerateImageRequest(BaseModel):
    prompt: str
    scene_index: Optional[int] = 0
    lyric_id: Optional[str] = None
    image_provider: Optional[ImageProviderConfig] = None
    visual_lock: Optional[VisualLockConfig] = None


class GenerateVideoRequest(BaseModel):
    prompt: str
    image_url: str
    scene_index: Optional[int] = 0
    duration: Optional[float] = 6.0
    camera_motion: Optional[str] = ""
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
            lyric.copy(update={"text": strip_trailing_speaker_label(lyric.text)})
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
        lyric.copy(update={"text": strip_trailing_speaker_label(lyric.text)})
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
    scene_groups = build_smart_scene_groups(valid_lyrics)
    return {
        "director_analysis": director_analysis,
        "summary": f"已分析 {len(valid_lyrics)} 行有效歌词，建议生成 {len(scene_groups)} 个智能镜头",
    }


@app.post("/api/generate/smart-storyboard")
async def generate_smart_storyboard(request: LyricScenesRequest):
    """先做导演分析，再按歌词语义和时间生成智能分镜。"""
    try:
        valid_lyrics = [
            lyric.copy(update={"text": strip_trailing_speaker_label(lyric.text)})
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
        director_analysis = build_director_analysis(valid_lyrics, request.style, request.song_name or "")
        visual_bible = build_visual_bible(valid_lyrics, request.style, request.song_name or "", request.visual_lock)
        scene_groups = build_smart_scene_groups(valid_lyrics)
        image_provider = get_image_provider_config(request.image_provider)
        using_ai_images = image_provider.provider != "placeholder"
        generated_count = 0
        failed_count = 0
        scenes = []

        for index, group in enumerate(scene_groups):
            combined_text = "，".join(line.text.strip() for line in group if line.text.strip())
            previous_text = scene_groups[index - 1][-1].text if index > 0 else ""
            next_text = scene_groups[index + 1][0].text if index < len(scene_groups) - 1 else ""
            start_time = 0.0 if index == 0 else group[0].time
            next_time = scene_groups[index + 1][0].time if index < len(scene_groups) - 1 else duration
            end_time = max(start_time + 0.8, next_time)
            arc = get_scene_arc(index, len(scene_groups))
            prompt = (
                f"Create a coherent MV storyboard keyframe. Director analysis: {director_analysis}. "
                f"Scene arc: {arc['title']}, mood: {arc['mood']}, shot type: {arc['shot_type']}, "
                f"camera motion: {arc['camera_motion']}. Lyric scene: '{combined_text[:180]}'. "
                f"Previous lyric: '{previous_text[:80]}'. Next lyric: '{next_text[:80]}'. "
                f"Continuity bible: {visual_bible}. No subtitles, no lyrics, no logo, no watermark."
            )
            video_prompt = (
                f"{arc['camera_motion']}, {arc['shot_type']}, subtle cinematic motion, "
                f"keep the same character, costume, palette, and environment; visualize: {combined_text[:120]}"
            )
            group_key = "|".join(f"{line.id}:{line.text}" for line in group)
            seed = stable_seed(f"smart-storyboard-{group_key}-{request.style}-{index}")
            image_url, generated_with_ai, image_error = await resolve_image_url(
                prompt,
                cache_key=f"smart-storyboard-{group_key}-{request.style}-{index}",
                placeholder_seed=seed,
                config=image_provider,
            )
            if generated_with_ai:
                generated_count += 1
            elif image_error:
                failed_count += 1

            scenes.append({
                "scene_index": index,
                "title": f"镜头 {index + 1} · {arc['title']}",
                "description": combined_text,
                "summary": combined_text[:80],
                "mood": arc["mood"],
                "visual": director_analysis["visual_motif"],
                "shot_type": arc["shot_type"],
                "camera_motion": arc["camera_motion"],
                "transition": arc["transition"],
                "video_prompt": video_prompt,
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
            "director_analysis": director_analysis,
            "summary": (
                f"已完成 AI 导演分析，生成 {len(scenes)} 个智能镜头，覆盖 {len(valid_lyrics)} 行歌词"
                + (f"；AI 生成关键帧 {generated_count}/{len(scenes)} 张" if using_ai_images else "；当前使用占位图模式")
                + (f"，{failed_count} 张失败后使用占位图" if failed_count else "")
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
            lyric.copy(update={"text": strip_trailing_speaker_label(lyric.text)})
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
        line.copy(update={"text": strip_trailing_speaker_label(line.text)})
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


@app.post("/api/generate/image")
async def generate_image(request: GenerateImageRequest):
    try:
        seed = stable_seed(request.prompt)
        prompt = append_visual_lock_to_prompt(request.prompt, request.visual_lock)
        image_url, _, _ = await resolve_image_url(
            prompt,
            cache_key=f"single-{request.scene_index}-{request.lyric_id or ''}-{prompt}",
            placeholder_seed=seed,
            config=request.image_provider,
        )
        return {
            "image_url": image_url,
            "scene_index": request.scene_index,
            "lyric_id": request.lyric_id,
            "prompt": prompt,
        }
    except Exception as e:
        print(f"[ERROR] generate_image: {e}")
        return {"image_url": "", "scene_index": request.scene_index, "prompt": request.prompt}


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
    return 5 if duration <= 7.5 else 10


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
    return "5s" if duration <= 7.5 else "9s"


def is_public_https_url(url: str) -> bool:
    return url.startswith("https://")


def base64url_encode(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("utf-8")


def create_kling_jwt(access_key: str, secret_key: str) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": access_key,
        "exp": now + 1800,
        "nbf": now - 5,
    }
    signing_input = ".".join([
        base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    ])
    signature = hmac.new(secret_key.encode("utf-8"), signing_input.encode("utf-8"), hashlib.sha256).digest()
    return f"{signing_input}.{base64url_encode(signature)}"


def get_kling_auth_token(provider_config: VideoProviderConfig) -> str:
    raw_key = (provider_config.api_key or "").strip()
    env_token = os.getenv("KLING_API_TOKEN", "").strip()
    access_key = os.getenv("KLING_ACCESS_KEY", "").strip()
    secret_key = os.getenv("KLING_SECRET_KEY", "").strip()

    if ":" in raw_key:
        access_key, secret_key = raw_key.split(":", 1)
        access_key = access_key.strip()
        secret_key = secret_key.strip()
    elif raw_key:
        return raw_key

    if env_token:
        return env_token

    if access_key and secret_key:
        return create_kling_jwt(access_key, secret_key)

    raise HTTPException(status_code=400, detail="Kling 需要 API Token，或填写 AccessKey:SecretKey")


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
    return "5" if duration <= 7.5 else "10"


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
        f"runway-{request.scene_index}-{request.image_url}-{request.prompt}-{provider_config.model}-{duration}"
    )
    file_path = GENERATED_VIDEO_DIR / f"{cache_key}.mp4"
    if file_path.exists() and file_path.stat().st_size > 0:
        return {
            "video_url": get_public_video_url(file_path),
            "scene_index": request.scene_index,
            "provider": "runway",
            "status": "done",
            "cached": True,
        }

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

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        try:
            create_response = await client.post(f"{base_url}/image_to_video", json=payload, headers=headers)
            create_response.raise_for_status()
            create_data = create_response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=exc.response.status_code,
                detail=f"Runway 创建任务失败：{exc.response.text[:400]}",
            ) from exc

        task_id = create_data.get("id")
        if not task_id:
            raise HTTPException(status_code=502, detail="Runway 未返回任务 id")

        task_data = create_data
        for _ in range(120):
            status = str(task_data.get("status", "")).upper()
            if status in {"SUCCEEDED", "SUCCESS", "COMPLETED"}:
                output = task_data.get("output")
                if not isinstance(output, list) or not output:
                    raise HTTPException(status_code=502, detail="Runway 任务成功但未返回 output")
                video_url = output[0]
                local_video_url = await download_video_to_cache(video_url, file_path)
                return {
                    "video_url": local_video_url,
                    "scene_index": request.scene_index,
                    "provider": "runway",
                    "status": "done",
                    "task_id": task_id,
                }

            if status in {"FAILED", "CANCELLED", "CANCELED"}:
                failure = task_data.get("failure") or task_data.get("error") or task_data
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
        f"luma-{request.scene_index}-{prompt_image_url}-{request.prompt}-{provider_config.model}-{duration}"
    )
    file_path = GENERATED_VIDEO_DIR / f"{cache_key}.mp4"
    if file_path.exists() and file_path.stat().st_size > 0:
        return {
            "video_url": get_public_video_url(file_path),
            "scene_index": request.scene_index,
            "provider": "luma",
            "status": "done",
            "cached": True,
        }

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

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        try:
            create_response = await client.post(f"{base_url}/generations", json=payload, headers=headers)
            create_response.raise_for_status()
            generation_data = create_response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=exc.response.status_code,
                detail=f"Luma 创建任务失败：{exc.response.text[:400]}",
            ) from exc

        generation_id = generation_data.get("id")
        if not generation_id:
            raise HTTPException(status_code=502, detail="Luma 未返回 generation id")

        for _ in range(120):
            state = str(generation_data.get("state", "")).lower()
            if state in {"completed", "succeeded", "success"}:
                assets = generation_data.get("assets") or {}
                video_url = assets.get("video") if isinstance(assets, dict) else None
                if not video_url:
                    raise HTTPException(status_code=502, detail="Luma 任务成功但未返回 assets.video")
                local_video_url = await download_video_to_cache(video_url, file_path)
                return {
                    "video_url": local_video_url,
                    "scene_index": request.scene_index,
                    "provider": "luma",
                    "status": "done",
                    "task_id": generation_id,
                }

            if state in {"failed", "failure", "canceled", "cancelled"}:
                failure = generation_data.get("failure_reason") or generation_data.get("error") or generation_data
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
        f"kling-{request.scene_index}-{request.image_url}-{request.prompt}-{provider_config.model}-{duration}"
    )
    file_path = GENERATED_VIDEO_DIR / f"{cache_key}.mp4"
    if file_path.exists() and file_path.stat().st_size > 0:
        return {
            "video_url": get_public_video_url(file_path),
            "scene_index": request.scene_index,
            "provider": "kling",
            "status": "done",
            "cached": True,
        }

    base_url = (provider_config.base_url or "").strip() or "https://api-singapore.klingai.com/v1"
    base_url = base_url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "model_name": get_kling_model(provider_config.model),
        "image": await get_kling_image_source(request.image_url),
        "prompt": (request.prompt or "")[:2500],
        "duration": get_kling_duration(duration),
        "mode": "std",
        "cfg_scale": 0.5,
    }

    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        try:
            create_response = await client.post(f"{base_url}/videos/image2video", json=payload, headers=headers)
            create_response.raise_for_status()
            create_data = create_response.json()
        except httpx.HTTPStatusError as exc:
            raise HTTPException(
                status_code=exc.response.status_code,
                detail=f"Kling 创建任务失败：{exc.response.text[:400]}",
            ) from exc

        data = create_data.get("data") if isinstance(create_data, dict) else None
        task_id = data.get("task_id") if isinstance(data, dict) else None
        if not task_id and isinstance(create_data, dict):
            task_id = create_data.get("task_id")
        if not task_id:
            raise HTTPException(status_code=502, detail="Kling 未返回 task_id")

        task_data = data if isinstance(data, dict) else create_data
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
                local_video_url = await download_video_to_cache(video_url, file_path)
                return {
                    "video_url": local_video_url,
                    "scene_index": request.scene_index,
                    "provider": "kling",
                    "status": "done",
                    "task_id": task_id,
                }

            if status in {"failed", "failure", "canceled", "cancelled"}:
                reason = task_data.get("task_status_msg") or task_data.get("error") or task_data
                raise HTTPException(status_code=502, detail=f"Kling 任务失败：{reason}")

            await asyncio.sleep(5)
            try:
                task_response = await client.get(f"{base_url}/videos/image2video/{task_id}", headers=headers)
                task_response.raise_for_status()
                query_data = task_response.json()
            except httpx.HTTPStatusError as exc:
                raise HTTPException(
                    status_code=exc.response.status_code,
                    detail=f"Kling 查询任务失败：{exc.response.text[:400]}",
                ) from exc

            task_data = query_data.get("data") if isinstance(query_data, dict) and isinstance(query_data.get("data"), dict) else query_data

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

        headers = {"Content-Type": "application/json"}
        if provider_config.api_key:
            headers["Authorization"] = f"Bearer {provider_config.api_key}"

        payload = {
            "model": provider_config.model,
            "prompt": request.prompt,
            "image_url": request.image_url,
            "duration": duration,
            "camera_motion": request.camera_motion,
            "scene_index": request.scene_index,
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
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

        return {
            "video_url": video_url,
            "scene_index": request.scene_index,
            "provider": provider,
            "status": "done",
            "raw": data,
        }

    if provider == "runway":
        return await generate_runway_video(request, provider_config, duration)

    if provider == "luma":
        return await generate_luma_video(request, provider_config, duration)

    if provider == "kling":
        return await generate_kling_video(request, provider_config, duration)
        if not provider_config.api_key:
            raise HTTPException(status_code=400, detail=f"{provider_config.provider} 需要 API key")
        raise HTTPException(
            status_code=501,
            detail=f"{provider_config.provider} 视频 API 协议尚未接入，请先使用本地动态或自定义 Base URL",
        )

    raise HTTPException(status_code=400, detail=f"未知视频提供商：{provider_config.provider}")


if __name__ == "__main__":
    is_frozen = bool(getattr(sys, "frozen", False))
    reload_enabled = os.getenv("MUSIC_VIDEO_RELOAD", "1") == "1" and not is_frozen
    port = int(os.getenv("MUSIC_VIDEO_BACKEND_PORT", "8000"))
    if reload_enabled:
        uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
    else:
        uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
