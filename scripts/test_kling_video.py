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

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import main  # noqa: E402


FAKE_MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + (b"\x00" * (128 * 1024))
IMAGE_DATA_URI = "data:image/png;base64," + base64.b64encode(b"offline-test-image").decode("ascii")


class MockKlingHandler(BaseHTTPRequestHandler):
    mode = "success"
    create_count = 0
    query_count = 0

    def send_payload(self, payload: bytes, content_type: str = "application/json") -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:  # noqa: N802
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length:
            self.rfile.read(content_length)
        if self.path != "/videos/image2video":
            self.send_error(404)
            return

        type(self).create_count += 1
        if type(self).mode == "non_json":
            self.send_payload(b"upstream gateway failure", "text/plain")
            return
        if type(self).mode == "invalid_key":
            self.send_payload(json.dumps({"code": 1002, "message": "api key not found"}).encode())
            return
        if type(self).mode == "missing_task_id":
            self.send_payload(json.dumps({"code": 0, "data": {"task_status": "submitted"}}).encode())
            return

        self.send_payload(
            json.dumps({"code": 0, "data": {"task_id": "offline-kling-task", "task_status": "submitted"}}).encode()
        )

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/videos/image2video/offline-kling-task":
            type(self).query_count += 1
            video_url = f"http://127.0.0.1:{self.server.server_port}/video.mp4"
            self.send_payload(json.dumps({
                "code": 0,
                "data": {
                    "task_id": "offline-kling-task",
                    "task_status": "succeed",
                    "task_result": {"videos": [{"url": video_url}]},
                },
            }).encode())
            return
        if self.path == "/video.mp4":
            self.send_payload(FAKE_MP4, "video/mp4")
            return
        self.send_error(404)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class KlingVideoTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), MockKlingHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def setUp(self) -> None:
        MockKlingHandler.mode = "success"
        MockKlingHandler.create_count = 0
        MockKlingHandler.query_count = 0
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
            provider="kling",
            model="kling-v2-5-turbo",
            api_key="offline-access:offline-secret",
            base_url=f"http://127.0.0.1:{self.server.server_port}",
        )

    def tearDown(self) -> None:
        self.globals.stop()
        self.temp_dir.cleanup()

    @staticmethod
    async def no_sleep(_seconds: float) -> None:
        return None

    @staticmethod
    def request(scene_index: int = 0) -> main.GenerateVideoRequest:
        return main.GenerateVideoRequest(
            prompt="offline controlled animation",
            image_url=IMAGE_DATA_URI,
            scene_index=scene_index,
            duration=5,
            style_fingerprint="offline-style",
        )

    async def test_invalid_single_key_is_rejected_before_http_request(self) -> None:
        self.provider.api_key = "only-an-access-key"
        with self.assertRaises(HTTPException) as caught:
            await main.generate_kling_video(self.request(), self.provider, 5.0)
        self.assertEqual(caught.exception.status_code, 400)
        self.assertIn("AccessKey:SecretKey", caught.exception.detail)
        self.assertEqual(MockKlingHandler.create_count, 0)

    def test_access_secret_pair_creates_standard_jwt(self) -> None:
        token = main.get_kling_auth_token(self.provider)
        self.assertTrue(main.is_valid_jwt_token(token))
        self.assertEqual(len(token.split(".")), 3)

    def test_malformed_jwt_is_rejected_without_decode_error(self) -> None:
        self.provider.api_key = "not-base64.not-base64.signature"
        with self.assertRaises(HTTPException) as caught:
            main.get_kling_auth_token(self.provider)
        self.assertEqual(caught.exception.status_code, 400)

    def test_unexpected_response_structure_is_rejected(self) -> None:
        response = main.httpx.Response(200, json=[{"task_id": "wrong-shape"}])
        with self.assertRaises(HTTPException) as caught:
            main.parse_kling_response(response, "创建任务")
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("JSON 对象", caught.exception.detail)

    async def test_successful_task_is_saved_and_downloaded(self) -> None:
        with patch.object(main.asyncio, "sleep", self.no_sleep):
            result = await main.generate_kling_video(self.request(1), self.provider, 5.0)
        self.assertEqual(result["task_id"], "offline-kling-task")
        self.assertEqual(MockKlingHandler.create_count, 1)
        self.assertEqual(MockKlingHandler.query_count, 1)
        tasks = main.load_video_tasks()
        self.assertEqual(len(tasks), 1)
        self.assertEqual(next(iter(tasks.values()))["status"], "done")

    async def test_provider_code_1002_has_actionable_error_and_is_not_saved(self) -> None:
        MockKlingHandler.mode = "invalid_key"
        with self.assertRaises(HTTPException) as caught:
            await main.generate_kling_video(self.request(2), self.provider, 5.0)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("凭证无效", caught.exception.detail)
        self.assertEqual(main.load_video_tasks(), {})

    async def test_non_json_response_has_actionable_error_and_is_not_saved(self) -> None:
        MockKlingHandler.mode = "non_json"
        with self.assertRaises(HTTPException) as caught:
            await main.generate_kling_video(self.request(3), self.provider, 5.0)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("无法解析", caught.exception.detail)
        self.assertEqual(main.load_video_tasks(), {})

    async def test_missing_task_id_is_not_saved(self) -> None:
        MockKlingHandler.mode = "missing_task_id"
        with self.assertRaises(HTTPException) as caught:
            await main.generate_kling_video(self.request(4), self.provider, 5.0)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("task_id", caught.exception.detail)
        self.assertEqual(main.load_video_tasks(), {})

    async def test_network_error_is_reported_as_kling_connection_error(self) -> None:
        self.provider.base_url = "http://127.0.0.1:1"
        with self.assertRaises(HTTPException) as caught:
            await main.generate_kling_video(self.request(5), self.provider, 5.0)
        self.assertEqual(caught.exception.status_code, 502)
        self.assertIn("无法连接 Kling", caught.exception.detail)
        self.assertEqual(main.load_video_tasks(), {})


if __name__ == "__main__":
    unittest.main()
