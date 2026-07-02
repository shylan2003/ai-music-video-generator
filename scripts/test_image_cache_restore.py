from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import main  # noqa: E402


class ImageCacheRestoreTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.cache_dir = Path(self.temp_dir.name) / "generated_images"
        self.cache_dir.mkdir(parents=True)
        self.generated_dir_patch = patch.object(main, "GENERATED_DIR", self.cache_dir)
        self.generated_dir_patch.start()

    def tearDown(self) -> None:
        self.generated_dir_patch.stop()
        self.temp_dir.cleanup()

    @staticmethod
    def scene(scene_index: int, prompt: str) -> main.CachedSceneImageRequest:
        return main.CachedSceneImageRequest(scene_index=scene_index, prompt=prompt)

    def write_image(self, name: str, modified: int) -> Path:
        path = self.cache_dir / name
        path.write_bytes(b"offline-image")
        os.utime(path, (modified, modified))
        return path

    async def test_exact_cache_key_match_is_restored(self) -> None:
        scene = self.scene(2, "exact prompt")
        _prompt, cache_key = main.build_single_image_cache_key(scene)
        expected = self.write_image(f"{main.stable_file_stem(cache_key)}.png", 10)

        result = await main.restore_image_cache(main.RestoreImageCacheRequest(scenes=[scene]))

        self.assertEqual(result["recovered_count"], 1)
        self.assertEqual(result["recovered"][0]["file_name"], expected.name)
        self.assertEqual(result["recovered"][0]["match_mode"], "exact")
        self.assertEqual(result["cloud_requests"], 0)

    async def test_equal_scene_and_cache_counts_allow_ordered_fallback(self) -> None:
        first = self.write_image("old-a.png", 10)
        second = self.write_image("old-b.png", 20)
        scenes = [self.scene(0, "new prompt a"), self.scene(1, "new prompt b")]

        result = await main.restore_image_cache(main.RestoreImageCacheRequest(scenes=scenes))

        self.assertTrue(result["ordered_fallback_used"])
        self.assertEqual([item["file_name"] for item in result["recovered"]], [first.name, second.name])
        self.assertEqual(result["unmatched_scene_indexes"], [])
        self.assertEqual(result["cloud_requests"], 0)

    async def test_extra_cache_file_blocks_unsafe_ordered_fallback(self) -> None:
        self.write_image("old-a.png", 10)
        self.write_image("old-b.png", 20)
        self.write_image("another-project.png", 30)
        scenes = [self.scene(0, "new prompt a"), self.scene(1, "new prompt b")]

        result = await main.restore_image_cache(main.RestoreImageCacheRequest(scenes=scenes))

        self.assertFalse(result["ordered_fallback_used"])
        self.assertEqual(result["recovered_count"], 0)
        self.assertEqual(result["unmatched_scene_indexes"], [0, 1])
        self.assertEqual(result["cloud_requests"], 0)


if __name__ == "__main__":
    unittest.main()
