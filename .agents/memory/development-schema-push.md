---
name: Development schema push prompt
description: Why schema push may need a targeted alternative for unrelated changes
---

When applying a narrow schema change in development, do not accept an unrelated prompt to truncate the standard ingredient library. A push can pause on an existing unique-constraint change rather than applying the intended column.

**Why:** Accepting the truncation option risks deleting ingredient data unrelated to the feature being built.

**How to apply:** Inspect the proposed schema changes; if the push blocks on unrelated destructive changes, apply only the intended, safe DDL to the development database and leave the unrelated constraint for a separately reviewed change. Production schema remains managed by Publish.