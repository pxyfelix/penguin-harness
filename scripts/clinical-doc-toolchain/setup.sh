#!/usr/bin/env bash
set -euo pipefail

root="${PENGUIN_CLINICAL_DOC_ROOT:-/home/ubuntu/toolchains/clinical-doc}"
site="$root/site"
bin="$root/bin"
profile="${PENGUIN_CLINICAL_PROFILE:-/etc/profile.d/penguin-clinical-doc.sh}"
python="${PYTHON:-/usr/bin/python3}"
here="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

mkdir -p "$site" "$bin"

"$python" -m pip install \
  --disable-pip-version-check \
  --no-cache-dir \
  --timeout 120 \
  --retries 5 \
  --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
  --target "$site" \
  "python-docx==1.2.0" \
  "openpyxl==3.1.5" \
  "pypdf==6.14.2" \
  "mistune>=3.3.4,<4"

install -m 0755 "$here/clinical-python" "$bin/clinical-python"
ln -sfn clinical-python "$bin/clinical-python3"
install -m 0755 "$here/clinical-python" "$bin/python3"
install -m 0755 "$here/clinical-python" "$bin/python"

if [ "$(id -u)" -eq 0 ]; then
  install -m 0644 "$here/profile.sh" "$profile"
else
  sudo -n install -m 0644 "$here/profile.sh" "$profile"
fi

"$bin/python3" - <<'PY'
import docx
import openpyxl

print(f"python-docx={getattr(docx, '__version__', 'unknown')}")
print(f"openpyxl={openpyxl.__version__}")
PY

echo "clinical_doc_root=$root"
echo "clinical_profile=$profile"
