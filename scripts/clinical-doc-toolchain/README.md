# Clinical Document Toolchain

This server-level environment is shared by the clinical agents that create and review
Word, Excel, and PDF-related deliverables. It lives outside any Session Workspace:

```text
/home/ubuntu/toolchains/clinical-doc/
├── bin/clinical-python
├── bin/clinical-python3
└── site/                   # python-docx and openpyxl
```

`setup.sh` installs the pinned packages and writes `/etc/profile.d/penguin-clinical-doc.sh`,
so Agent login shells can use `python3` or `clinical-python` without installing packages
again. The profile exports:

```text
PENGUIN_CLINICAL_DOC_ROOT
PYTHONPATH=<root>/site
PATH=<root>/bin:$PATH
```

PDF extraction continues to use the system `pdftotext` command; Word-to-PDF conversion uses
the system LibreOffice installation. The sandbox already keeps `~/toolchains` readable while
masking other users' data.
