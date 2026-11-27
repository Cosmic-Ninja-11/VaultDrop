"""Generate gitignored js/firebase-env.js and firestore.rules from .env."""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
OUT_JS = ROOT / "js" / "firebase-env.js"
OUT_RULES = ROOT / "firestore.rules"


def parse_env(text: str) -> dict[str, str]:
    env: dict[str, str] = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        if not stripped or stripped.startswith("#") or "=" not in raw:
            i += 1
            continue

        key, val = raw.split("=", 1)
        key = key.strip()
        val_lstrip = val.lstrip()

        if val_lstrip.startswith('"""'):
            rest = val_lstrip[3:]
            buf: list[str] = []
            if '"""' in rest:
                end_idx = rest.index('"""')
                env[key] = rest[:end_idx]
                i += 1
                continue
            buf.append(rest)
            i += 1
            while i < len(lines):
                line = lines[i]
                if '"""' in line:
                    end_idx = line.index('"""')
                    buf.append(line[:end_idx])
                    break
                buf.append(line)
                i += 1
            env[key] = "\n".join(buf)
        else:
            v = val.strip()
            if (v.startswith('"') and v.endswith('"')) or (
                v.startswith("'") and v.endswith("'")
            ):
                v = v[1:-1].replace("\\n", "\n")
            env[key] = v
        i += 1
    return env


def main() -> int:
    if not ENV_PATH.exists():
        print("Error: .env file not found. Copy .env.example to .env first.", file=sys.stderr)
        return 1

    env = parse_env(ENV_PATH.read_text(encoding="utf-8"))
    cfg = {
        "apiKey": env.get("FIREBASE_API_KEY", ""),
        "authDomain": env.get("FIREBASE_AUTH_DOMAIN", ""),
        "projectId": env.get("FIREBASE_PROJECT_ID", ""),
        "storageBucket": env.get("FIREBASE_STORAGE_BUCKET", ""),
        "messagingSenderId": env.get("FIREBASE_MESSAGING_SENDER_ID", ""),
        "appId": env.get("FIREBASE_APP_ID", ""),
    }

    js_body = (
        "// Auto-generated from .env (gitignored — do not commit)\n"
        f"export const FIREBASE_CONFIG = {json.dumps(cfg, indent=2)};\n"
    )
    OUT_JS.write_text(js_body, encoding="utf-8")
    print(f"Wrote {OUT_JS.relative_to(ROOT)}")

    rules = env.get("FIRESTORE_RULES", "").strip()
    if rules:
        OUT_RULES.write_text(rules + "\n", encoding="utf-8")
        print(f"Wrote {OUT_RULES.relative_to(ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
