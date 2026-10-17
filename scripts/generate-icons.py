from pathlib import Path

from PIL import Image


root = Path(__file__).resolve().parents[1]
assets = root / "apps" / "desktop" / "assets"
source = Image.open(assets / "memo-icon.png").convert("RGBA")
master = source.resize((1024, 1024), Image.Resampling.LANCZOS)
master.save(assets / "memo-icon.icns", format="ICNS")
master.save(
    assets / "memo-icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
