# Clinical Document Toolchain

This server-level environment is shared by the clinical agents that create and review
Word, Excel, and PDF-related deliverables. It lives outside any Session Workspace:

```text
/home/ubuntu/toolchains/clinical-doc/
├── bin/clinical-python
├── bin/clinical-python3
└── site/                   # python-docx and openpyxl
```

`setup.sh` installs the pinned packages and writes `/etc/profile.d/penguin-clinical-doc.sh`.
The profile puts lightweight `python`/`python3`/`clinical-python` wrappers first on PATH;
the wrappers add the package site only for the system Python, so they cannot corrupt a
separate Python 3.11 virtualenv used by the review core. It also exports:

```text
PENGUIN_CLINICAL_DOC_ROOT
PATH=<root>/bin:$PATH
PROTOCOL_REVIEW_CORE=<biostat pack>/packages/protocol-review-core/src
SAP_REVIEW_CORE=<biostat pack>/packages/sap-review-core/src
UV_CACHE_DIR=/tmp/penguin-uv-cache
```

PDF extraction continues to use the system `pdftotext` command; Word-to-PDF conversion uses
the system LibreOffice installation. The sandbox already keeps `~/toolchains` readable while
masking other users' data.
