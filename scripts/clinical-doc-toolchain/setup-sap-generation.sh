#!/usr/bin/env bash
set -euo pipefail

source_root="${1:-/home/ubuntu/sap}"
root="${PENGUIN_SAP_GENERATION_ROOT:-/home/ubuntu/toolchains/sap-generation}"
site="${PENGUIN_CLINICAL_DOC_ROOT:-/home/ubuntu/toolchains/clinical-doc}/site"
python="${PYTHON:-/usr/bin/python3}"

if [ ! -d "$source_root/auto_sap" ]; then
  echo "auto_sap source not found under $source_root" >&2
  exit 1
fi

mkdir -p "$root" "$site"
cp -a "$source_root/auto_sap" "$root/"
cp -a "$source_root/pyproject.toml" "$root/"
cp -a "$source_root/requirements.txt" "$root/"

"$python" -m pip install \
  --disable-pip-version-check \
  --no-cache-dir \
  --timeout 120 \
  --retries 5 \
  --index-url https://pypi.tuna.tsinghua.edu.cn/simple \
  --target "$site" \
  "docxtpl==0.20.1" \
  "openai==2.13.0" \
  "PyPDF2==3.0.1" \
  "python-dotenv==1.2.1" \
  "requests" \
  "pypdf==6.14.2" \
  "mistune>=3.3.4,<4"

cd "$root"
"$site/../bin/clinical-python" - <<'PY'
from auto_sap.generate_templates.generate_kcl_template import kcl_template_v02
from auto_sap.classes.protocol_classes import Protocol

print("sap-generation imports ok")
PY

echo "sap_generation_root=$root"
echo "sap_generation_site=$site"
