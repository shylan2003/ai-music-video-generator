from __future__ import annotations

import asyncio
import base64
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from services.tongyi_image import image_to_data_uri, local_generated_image_path  # noqa: E402


class TongyiReferenceImageTests(unittest.TestCase):
    def test_local_backend_url_reads_generated_file_without_http(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            generated_dir = Path(temp_dir) / "generated_images"
            generated_dir.mkdir()
            expected = b"fake-png-content"
            (generated_dir / "anchor.png").write_bytes(expected)

            with patch.dict(os.environ, {"MUSIC_VIDEO_DATA_DIR": temp_dir}):
                uri = asyncio.run(
                    image_to_data_uri("http://127.0.0.1:8000/generated/anchor.png")
                )

            self.assertTrue(uri.startswith("data:image/png;base64,"))
            self.assertEqual(base64.b64decode(uri.split(",", 1)[1]), expected)

    def test_only_generated_image_urls_are_mapped_to_disk(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch.dict(os.environ, {"MUSIC_VIDEO_DATA_DIR": temp_dir}):
                self.assertIsNone(
                    local_generated_image_path(
                        "http://127.0.0.1:8000/generated-videos/example.mp4"
                    )
                )
                self.assertIsNone(
                    local_generated_image_path("https://example.com/generated/anchor.png")
                )


if __name__ == "__main__":
    unittest.main()
