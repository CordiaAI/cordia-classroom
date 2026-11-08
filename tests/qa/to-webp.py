"""PNG screenshots from tests/qa/use-case-shots.cjs as optimized WebP for the use-case pages.

    python3 tests/qa/to-webp.py <png-dir> web/public/use-cases

Each image is scaled to at most 1600 px wide (2x a 800 px figure), saved as WebP (quality 80),
and its size printed so the page can set width and height.
"""
import json
import sys
from pathlib import Path

from PIL import Image

MAX_WIDTH = 1600


def convert(source: Path, target_dir: Path) -> tuple[str, int, int, int]:
    image = Image.open(source).convert('RGB')
    if image.width > MAX_WIDTH:
        image = image.resize((MAX_WIDTH, round(image.height * MAX_WIDTH / image.width)), Image.LANCZOS)
    target = target_dir / (source.stem + '.webp')
    image.save(target, 'WEBP', quality=80, method=6)
    return target.name, image.width, image.height, target.stat().st_size


if __name__ == '__main__':
    source_dir, target_dir = Path(sys.argv[1]), Path(sys.argv[2])
    target_dir.mkdir(parents=True, exist_ok=True)
    # Only the files the capture script wrote this run (its shots.json), never other PNGs there.
    listed = source_dir / 'shots.json'
    pngs = [Path(item) for item in json.loads(listed.read_text())] if listed.exists() else sorted(source_dir.glob('*.png'))
    for png in pngs:
        name, width, height, size = convert(png, target_dir)
        print(f'{name}\t{width}x{height}\t{size // 1024} KB')
