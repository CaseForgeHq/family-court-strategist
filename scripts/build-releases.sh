#!/usr/bin/env bash
# Rebuild both legacy downloads from the current source. The vault includes the
# same runnable tools and agent guidance as the website toolkit download.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_TMP="$(mktemp -d)"
trap 'rm -rf "$BUILD_TMP"' EXIT
node "$ROOT/cli/case-forge.mjs" init "$BUILD_TMP/vault"
python3 - "$ROOT" "$BUILD_TMP" <<'PY'
import pathlib, sys, zipfile
root, temp = map(pathlib.Path, sys.argv[1:])
out = root / 'releases'
out.mkdir(exist_ok=True)
for source, name in [(root / 'plugin', 'family-court-strategist.plugin'), (temp / 'vault', 'family-court-vault-template.zip')]:
    target = temp / name
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob('*')):
            if path.is_symlink():
                raise RuntimeError(f'Unexpected symlink: {path}')
            if not path.is_file() or path.name == '.DS_Store':
                continue
            relative = path.relative_to(source).as_posix()
            if any(c in relative for c in '{}'):
                raise RuntimeError(f'Unexpected brace path: {relative}')
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100600 << 16
            archive.writestr(info, path.read_bytes())
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise RuntimeError(f'Archive integrity failed: {name}')
    target.replace(out / name)
    print(f'Built and checked {name}')
PY
