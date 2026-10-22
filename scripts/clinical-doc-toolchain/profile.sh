# Make the shared clinical document toolchain available to every Agent command.
clinical_doc_root="${PENGUIN_CLINICAL_DOC_ROOT:-/home/ubuntu/toolchains/clinical-doc}"

case ":${PATH:-}:" in
  *":$clinical_doc_root/bin:"*) ;;
  *) export PATH="$clinical_doc_root/bin:${PATH:-}" ;;
esac

case ":${PATH:-}:" in
  *":/home/ubuntu/toolchains/biostat-agent-pack/.venv/bin:"*) ;;
  *) export PATH="/home/ubuntu/toolchains/biostat-agent-pack/.venv/bin:${PATH:-}" ;;
esac

export PENGUIN_CLINICAL_DOC_ROOT="$clinical_doc_root"
export PROTOCOL_REVIEW_CORE="/home/ubuntu/toolchains/biostat-agent-pack/packages/protocol-review-core/src"
export SAP_REVIEW_CORE="/home/ubuntu/toolchains/biostat-agent-pack/packages/sap-review-core/src"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/penguin-uv-cache}"
