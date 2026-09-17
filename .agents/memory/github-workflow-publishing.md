---
name: GitHub workflow publishing
description: Permission and authentication constraints for publishing GitHub Actions workflow changes.
---

GitHub credentials used to update files under `.github/workflows/` must include explicit workflow-write permission in addition to ordinary repository write access. A classic PAT needs both `repo` and `workflow`.

**Why:** A repository-scoped OAuth connection could create ordinary Git objects but GitHub returned a misleading 404 when a tree update referenced a workflow file. The attached GitHub App also did not become available to the shell credential helper in that agent session.

**How to apply:** Before pushing workflow changes, verify repository authentication and inspect reported OAuth scopes without printing credentials. If workflow permission is absent, repair access through the secure secrets flow rather than retrying repository-only credentials.