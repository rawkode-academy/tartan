# Tartan product scope

Tartan is a forge hosted in its owner's Cloudflare account. The current proof
of concept focuses on a nested hierarchy of groups and Git repositories,
repository browsing, projects discovered from CUE files, and repository- and
project-scoped Issues provided by a WebAssembly extension.

The first deployment is a private development stage, without a container
runner. The owner can push fast-forward updates to the default branch. CI and
automated landing are outside this initial configuration. The project-level
Issues switch changes the project view; it does not isolate or protect data.

The wider [design overview](docs/design/OVERVIEW.md) describes kernel
invariants and capabilities beyond this first deployment. See the
[first-deployment guide](docs/poc-deploy.md) for what remains to be verified
against Cloudflare.
