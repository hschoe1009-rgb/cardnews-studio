"""랜딩페이지에 실제로 쓰이는 글자만 남긴 WOFF2 서브셋을 만든다.
앱이 쓰는 app/static/fonts/*.otf 원본은 그대로 둔다."""
import io, re, sys
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from fontTools.subset import Subsetter, Options
from fontTools.ttLib import TTFont

SRC = Path("app/static/fonts")
DST = Path("app/static/landing/fonts"); DST.mkdir(parents=True, exist_ok=True)

# 랜딩 HTML + JS 안의 모든 문자를 모은다
text = ""
for f in [Path("app/templates/landing.html"), Path("app/templates/guide.html"),
          Path("app/static/landing/landing.js"), Path("app/static/landing/landing.css"),
          Path("app/static/landing/guide.css")]:
    text += f.read_text(encoding="utf-8")
# 태그/속성 이름 때문에 과하게 포함돼도 무해하다(라틴은 어차피 가벼움)
chars = set(text)
# 여유분: 숫자·기본 라틴·자주 쓰는 문장부호와 기호
chars |= set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
chars |= set(" .,·…!?~%()[]{}<>:;\"'/\-–—+×=@#&*|←→↑↓✕✓○●▲■□")
chars |= set("가나다라마바사아자차카타파하")  # 흔한 대체 글자 최소 보험
unicodes = sorted({ord(c) for c in chars if ord(c) > 31})

print(f"수집한 글자 {len(unicodes)}자\n")
for name, weight in [("Pretendard-Regular", 400), ("Pretendard-Bold", 700)]:
    src = SRC / f"{name}.otf"
    before = src.stat().st_size
    font = TTFont(str(src))
    opts = Options()
    opts.flavor = "woff2"
    opts.desubroutinize = True
    opts.layout_features = ["kern", "liga", "calt"]
    opts.notdef_outline = True
    sub = Subsetter(options=opts)
    sub.populate(unicodes=unicodes)
    sub.subset(font)
    out = DST / f"{name}-subset.woff2"
    font.flavor = "woff2"
    font.save(str(out))
    after = out.stat().st_size
    print(f"  {name:20} {before//1024:5}KB → {after//1024:4}KB  ({100 - after*100//before}% 감소)")
print("\n원본 OTF는 그대로 두었습니다 (앱 카드 렌더에 계속 사용).")
