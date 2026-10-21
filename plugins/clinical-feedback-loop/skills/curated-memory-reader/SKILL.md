---
name: curated-memory-reader
description: Use when an Agent needs approved company-level or capability-level knowledge from the active read-only clinical Memory Pack.
version: 2026.10.21.1
---

# Curated Memory Reader

Read only the active, approved pack.

1. Resolve:

```text
<app_data_dir>/<project>/feedback/active-memory-pack.json
```

2. If no active pointer exists, continue without long-term knowledge.
3. Read the indicated pack's `MEMORY.md`.
4. Open only entries relevant to the current capability and request.
5. Prefer a newer entry when the pack changelog explicitly supersedes an older one.
6. If entries conflict, do not choose silently: report the conflict and continue with the primary
   task.

## Boundaries

- Never modify `active-memory-pack.json`, `MEMORY.md`, entries or manifests.
- Never promote a report or write a new entry.
- Never treat Feedback inbox files as approved knowledge.
- Never treat Workspace-specific facts or another Project's data as shared company knowledge.
