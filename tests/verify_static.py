import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text(encoding="utf-8")
css = (root / "css" / "styles.css").read_text(encoding="utf-8")

# 1. Verify HTML referenced local assets exist
for asset in ["css/styles.css", "js/app.js"]:
    assert asset in html, f"Missing reference to {asset} in index.html"
    assert (root / asset).exists(), f"Missing file {asset}"

# 2. Verify all ES module local imports resolve to existing files
for js in (root / "js").glob("*.js"):
    txt = js.read_text(encoding="utf-8")
    for m in re.finditer(r"""from\s+['"](\./[^'"]+)['"]""", txt):
        target = (js.parent / m.group(1)).resolve()
        assert target.exists(), f"Missing import {target} in {js}"

# 3. Verify every $('id') lookup in app.js & ui-components.js exists in index.html
html_ids = set(re.findall(r"""id=["']([^"']+)["']""", html))
for js_name in ["app.js", "ui-components.js"]:
    txt = (root / "js" / js_name).read_text(encoding="utf-8")
    for m in re.finditer(r"""\$\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)""", txt):
        dom_id = m.group(1)
        assert dom_id in html_ids, f"ID '{dom_id}' referenced in {js_name} not found in index.html"
    for m in re.finditer(r"""getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)""", txt):
        dom_id = m.group(1)
        assert dom_id in html_ids, f"ID '{dom_id}' referenced in {js_name} not found in index.html"

# 4. Verify all required media extensions are present in crypto-ahnu.js and index.html
crypto_js = (root / "js" / "crypto-ahnu.js").read_text(encoding="utf-8")
for ext in [".jpg", ".jpeg", ".png", ".heic", ".mp4", ".mov", ".mkv", ".mp3"]:
    assert ext in crypto_js, f"Missing {ext} in crypto-ahnu.js"
    assert ext in html, f"Missing {ext} in index.html"

# 5. Verify firestore.rules enforces 24h max expiry
rules = (root / "firestore.rules").read_text(encoding="utf-8")
assert "duration.value(24, 'h')" in rules
assert "ttlMinutes <= 1440" in rules

print("All static integrity checks passed!")
