# Deploying Tartan

Use the [first-deployment guide](poc-deploy.md) for the current private
`dev-*` configuration and its verification steps. Each deployment is one
forge, with stage-specific resource names. `wrangler.jsonc` is the source for
bindings; the deploy script renders a stage configuration without changing it.

The first configuration uses `--no-containers --projects`. Repeat both flags
on every deploy: switches are rendered per deployment. The former omits the
runner, so CI and automated landing are unavailable; the owner can still make
fast-forward pushes to the default branch. The latter enables project
scanning and project pages. Do not add `--repo-config` to this configuration:
it requires a container and is separate from project discovery.

`--build-ext` builds the Issues WASM package locally. It does not publish or
install the package; do that after claiming the forge, as described in the
first-deployment guide. The generated package is not committed.

The deploy command runs preflight, builds and deploys the Worker and SPA,
sets initial secrets, and checks health. On first deploy, `--no-print-url`
writes the single-use setup URL to a mode-0600 file under `.wrangler/deploy/`.
That URL is a credential. After the forge is claimed, remove the setup secret
and the local URL file as described in the guide. Preserve `TARTAN_SECRET`:
replacing it can make existing encrypted state and credentials unusable.

A dry run validates the local bundle and rendered configuration only; it does
not validate Cloudflare resources, account entitlement, identity, Artifacts
pushes, or the WASM runtime at the edge. Until those checks succeed on a dev
stage, do not treat this forge as production-ready.
