# Architecture overview

One Tartan deployment is one Cloudflare Worker, serving the browser app, API,
Git gateway, and setup flow from the same origin. The first deployment uses a
private development stage without a container runner.

```text
Browser and Git client
        |
        v
Worker: authentication, API, Git gateway, static app
        |
        +-- ForgeDO: identity, groups, repositories, extension registry
        +-- RepoDO: repository state and event history
        +-- ExtensionDO + Worker Loader: WASM Issues and its database
        +-- Cloudflare Artifacts: Git repository contents
        +-- R2: extension packages and other blobs
        +-- IngestWorkflow: reconcile Artifacts push events
```

Repositories can contain CUE-described projects. Project discovery reads the
repository tree and caches the result by commit. The Issues extension is
installed at a repository or inherited from an ancestor, with repository-scoped
storage. Its project views filter the repository's issues by project root.

The Worker configuration retains some kernel components used by existing
repository and event flows, including Run and Land workflows. The initial
`--no-containers` deployment does not offer CI or automated landing. Local
preview uses fake Artifacts and identity services; a real Cloudflare deployment
still needs the checks in [First deployment](poc-deploy.md).

The [design overview](design/OVERVIEW.md) specifies the broader kernel
invariants and extension contracts. See [Projects](projects.md) for project
and issue behavior.
