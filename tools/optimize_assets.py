"""캡처와 완성 카드를 WebP로 최적화. 원본 PNG는 지운다(용량)."""
import io, sys, shutil
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from PIL import Image

SHOTS = Path("app/static/landing/shots")
CARDS = Path("app/static/landing/cards")
CARDS.mkdir(parents=True, exist_ok=True)

def to_webp(src: Path, dst: Path, max_w: int, quality: int = 82):
    im = Image.open(src).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    im.save(dst, "WEBP", quality=quality, method=6)
    return dst, im.size

print("=== 앱 화면 ===")
for png in sorted(SHOTS.glob("*.png")):
    # 인스펙터/캔버스 확대 컷은 좁게, 전체 화면은 넓게
    max_w = 900 if png.name.startswith("04") else 1600
    dst, size = to_webp(png, png.with_suffix(".webp"), max_w)
    print(f"  {dst.name:20} {size[0]}x{size[1]}  {dst.stat().st_size//1024}KB")
    png.unlink()

print("\n=== 완성 카드 (실제 출력물) ===")
SRC = Path("data/projects/260817-202513-집사-옷-냄새가-주는-안정감/cards")
for png in sorted(SRC.glob("card-*.png")):
    dst, size = to_webp(png, CARDS / f"{png.stem}.webp", 720)
    print(f"  {dst.name:20} {size[0]}x{size[1]}  {dst.stat().st_size//1024}KB")

# OG 이미지용 원본 1장 확보
to_webp(SRC / "card-01.png", CARDS / "card-01-lg.webp", 1080, 88)
print("\n최적화 완료")
