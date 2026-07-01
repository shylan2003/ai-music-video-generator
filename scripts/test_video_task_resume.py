from __future__ import annotations

import asyncio
import base64
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import main  # noqa: E402


FAKE_MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + (b"\x00" * (128 * 1024))
IMAGE_DATA_URI = "data:image/png;base64," + base64.b64encode(b"fake-image").decode("ascii")


class MockRunwayHandler(BaseHTTPRequestHandler):
    create_count = 0
    query_count = 0

    def send_payload(self, payload: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length:
            self.rfile.read(content_length)
        if self.path == "/image_to_video":
            type(self).create_count += 1
            self.send_payload(json.dumps({"id": "new-task", "status": "PENDING"}).encode(), "application/json")
            return
        self.send_error(404)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/tasks/"):
            type(self).query_count += 1
            task_id = self.path.rsplit("/", 1)[-1]
            video_url = f"http://127.0.0.1:{self.server.server_port}/video.mp4"
            self.send_payload(
                json.dumps({"id": task_id, "status": "SUCCEEDED", "output": [video_url]}).encode(),
                "application/json",
            )
            return
        if self.path == "/video.mp4":
            self.send_payload(FAKE_MP4, "video/mp4")
            return
        self.send_error(404)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class RunwayTaskResumeTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), MockRunwayHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self) -> None:
        MockRunwayHandler.create_count = 0
        MockRunwayHandler.query_count = 0
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.globals = patch.multiple(
            main,
            GENERATED_VIDEO_DIR=self.temp_path / "videos",
            VIDEO_TASKS_PATH=self.temp_path / "video_tasks.json",
            _video_tasks_lock=asyncio.Lock(),
        )
        self.globals.start()
        main.GENERATED_VIDEO_DIR.mkdir(parents=True, exist_ok=True)
        self.provider = main.VideoProviderConfig(
            provider="runway",
            model="gen-4",
            api_key="test-key",
            base_url=f"http://127.0.0.1:{self.server.server_port}",
        )

    def tearDown(self) -> None:
        self.globals.stop()
        self.temp_dir.cleanup()

    @staticmethod
    async def no_sleep(_seconds: float) -> None:
        return None

    def request(self, scene_index: int) -> main.GenerateVideoRequest:
        return main.GenerateVideoRequest(
            prompt="controlled animation",
            image_url=IMAGE_DATA_URI,
            scene_index=scene_index,
            duration=8,
            style_fingerprint="style-v3",
        )

    def cache_key(self, request: main.GenerateVideoRequest) -> str:
        duration = float(request.duration or self.provider.clip_seconds or 6.0)
        return main.stable_file_stem(
            f"runway-{request.scene_index}-{request.image_url}-{request.last_frame_url}-{request.prompt}-"
            f"{self.provider.model}-{duration}-{request.style_fingerprint}"
        )

    async def test_successful_task_is_not_submitted_twice(self) -> None:
        request = self.request(1)
        with patch.object(main.asyncio, "sleep", self.no_sleep):
            first = await main.generate_runway_video(request, self.provider, 8.0)
            second = await main.generate_runway_video(request, self.provider, 8.0)

        self.assertEqual(MockRunwayHandler.create_count, 1)
        self.assertEqual(MockRunwayHandler.query_count, 1)
        self.assertEqual(first["task_id"], "new-task")
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(main.load_video_tasks()[self.cache_key(request)]["status"], "done")

    async def test_pending_task_resumes_by_task_id_without_new_post(self) -> None:
        request = self.request(2)
        cache_key = self.cache_key(request)
        await main.save_video_task(cache_key, {
            "provider": "runway",
            "task_id": "resume-task",
            "status": "pending",
            "scene_index": 2,
        })

        with patch.object(main.asyncio, "sleep", self.no_sleep):
            result = await main.generate_runway_video(request, self.provider, 8.0)

        self.assertEqual(MockRunwayHandler.create_count, 0)
        self.assertEqual(MockRunwayHandler.query_count, 1)
        self.assertEqual(result["task_id"], "resume-task")
        self.assertEqual(main.load_video_tasks()[cache_key]["status"], "done")


if __name__ == "__main__":
    unittest.main()
