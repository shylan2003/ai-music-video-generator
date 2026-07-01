from __future__ import annotations

import asyncio
import base64
import mimetypes
import os
import time
from pathlib import Path
from typing import Awaitable, Callable
from urllib.parse import unquote, urlparse

import httpx


DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/api/v1"
DEFAULT_MODEL = "wan2.6-image"
_submit_lock = asyncio.Lock()
_last_submit_time = 0.0
MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024


def normalize_size(size: str) -> str:
    normalized = (size or "").lower().replace("x", "*")
    if normalized in {"1280*720", "1920*1080"}:
        return "1280*720"
    return "1280*720"


def local_generated_image_path(source: str) -> Path | None:
    parsed = urlparse(source)
    if parsed.scheme not in {"http", "https"}:
        return None
    if parsed.hostname not in {"127.0.0.1", "localhost", "0.0.0.0"}:
        return None
    if not parsed.path.startswith("/generated/"):
        return None

    filename = Path(unquote(parsed.path)).name
    if not filename:
        return None
    data_dir = Path(
        os.getenv("MUSIC_VIDEO_DATA_DIR", str(Path(__file__).resolve().parents[1]))
    ).resolve()
    generated_dir = (data_dir / "generated_images").resolve()
    candidate = (generated_dir / filename).resolve()
    if candidate.parent != generated_dir:
        return None
    return candidate if candidate.is_file() else None


def file_to_data_uri(path: Path) -> str:
    if path.stat().st_size > MAX_REFERENCE_IMAGE_BYTES:
        raise ValueError("参考图片超过通义万相 10MB 限制")
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('utf-8')}"


async def image_to_data_uri(source: str) -> str:
    if source.startswith("data:image/"):
        return source
    if Path(source).is_absolute() and Path(source).exists():
        return file_to_data_uri(Path(source))
    local_path = local_generated_image_path(source)
    if local_path:
        return file_to_data_uri(local_path)
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        response = await client.get(source)
        response.raise_for_status()
        if len(response.content) > MAX_REFERENCE_IMAGE_BYTES:
            raise ValueError("参考图片超过通义万相 10MB 限制")
        mime = response.headers.get("content-type", "image/png").split(";", 1)[0]
        return f"data:{mime};base64,{base64.b64encode(response.content).decode('utf-8')}"


async def generate_tongyi_image(
    *,
    prompt: str,
    output_path: Path,
    api_key: str,
    model: str = DEFAULT_MODEL,
    base_url: str = DEFAULT_BASE_URL,
    size: str = "1280x720",
    reference_image: str = "",
    public_url_for_path: Callable[[Path], str],
) -> str:
    global _last_submit_time
    if output_path.exists() and output_path.stat().st_size > 0:
        return public_url_for_path(output_path)
    if not api_key.strip():
        raise ValueError("通义万相需要 API Key")
    content: list[dict[str, str]] = [{"text": prompt}]
    parameters: dict[str, object] = {
        "negative_prompt": "题字, 印章, 落款, 文字, 边框, watermark, signature, logo",
        "prompt_extend": False,
        "watermark": False,
        "n": 1,
        "size": normalize_size(size),
    }
    if reference_image:
        content.append({"image": await image_to_data_uri(reference_image)})
    else:
        parameters.update({"enable_interleave": True, "max_images": 1})
    payload = {
        "model": model or DEFAULT_MODEL,
        "input": {"messages": [{"role": "user", "content": content}]},
        "parameters": parameters,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
    }
    async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
        submit_data: dict | None = None
        for attempt in range(4):
            async with _submit_lock:
                wait = 6.5 - (time.monotonic() - _last_submit_time)
                if wait > 0:
                    await asyncio.sleep(wait)
                response = await client.post(
                    f"{base_url.rstrip('/')}/services/aigc/image-generation/generation",
                    headers=headers,
                    json=payload,
                )
                _last_submit_time = time.monotonic()
            if response.status_code == 200:
                submit_data = response.json()
                break
            if response.status_code == 429:
                await asyncio.sleep(15 * (attempt + 1))
                continue
            raise RuntimeError(f"通义万相创建任务失败 ({response.status_code})：{response.text[:500]}")
        if not submit_data:
            raise RuntimeError("通义万相请求频率过高，请稍后重试")
        task_id = submit_data.get("output", {}).get("task_id")
        if not task_id:
            raise RuntimeError("通义万相未返回 task_id")
        query_headers = {"Authorization": f"Bearer {api_key}"}
        for _ in range(120):
            await asyncio.sleep(3)
            status_response = await client.get(f"{base_url.rstrip('/')}/tasks/{task_id}", headers=query_headers)
            if status_response.status_code != 200:
                continue
            output = status_response.json().get("output", {})
            status = output.get("task_status")
            if status == "FAILED":
                raise RuntimeError(f"通义万相任务失败：{output.get('message') or output}")
            if status != "SUCCEEDED":
                continue
            image_url = ""
            choices = output.get("choices", [])
            if choices:
                for item in choices[0].get("message", {}).get("content", []):
                    if item.get("image"):
                        image_url = item["image"]
                        break
            if not image_url and output.get("results"):
                image_url = output["results"][0].get("url", "")
            if not image_url:
                raise RuntimeError("通义万相任务成功但未返回图片")
            image_response = await client.get(image_url)
            image_response.raise_for_status()
            if len(image_response.content) > 40 * 1024 * 1024:
                raise RuntimeError("生成图片超过 40MB 限制")
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(image_response.content)
            return public_url_for_path(output_path)
    raise TimeoutError("通义万相生成超时")
