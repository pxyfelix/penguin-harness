# Make the shared clinical document toolchain available to every Agent command.
clinical_doc_root="${PENGUIN_CLINICAL_DOC_ROOT:-/home/ubuntu/toolchains/clinical-doc}"

case ":${PYTHONPATH:-}:" in
  *":$clinical_doc_root/site:"*) ;;
  *) export PYTHONPATH="$clinical_doc_root/site${PYTHONPATH:+:$PYTHONPATH}" ;;
esac

case ":${PATH:-}:" in
  *":$clinical_doc_root/bin:"*) ;;
  *) export PATH="$clinical_doc_root/bin:${PATH:-}" ;;
esac

export PENGUIN_CLINICAL_DOC_ROOT="$clinical_doc_root"
