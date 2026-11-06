# First deployment

This guide prepares a private development forge with nested groups,
repositories backed by Cloudflare Artifacts, CUE projects, and the WASM Issues
extension. The deployment and the checks below have not yet been run against
Cloudflare for this branch. Use disposable test data until they pass.

## Prerequisites

- A Cloudflare account with access to Workers and Artifacts, R2, Durable
  Objects, Workflows, and Worker Loader. Check current availability and costs
  in the Cloudflare dashboard and documentation for your account.
- An OpenID Connect provider and a client configured for the forge origin.
  The local development sign-in is not included in deployed Workers.
- Deno 2.9, Node 22, the repository's exact npm dependencies, and the Rust
  WASM toolchain (`wasm32-unknown-unknown`, `wasm-tools`, and jco). The Nix
  development shell supplies the toolchain.
- A clean, reviewed checkout and enough free disk space for the build. Use
  a `dev` or `dev-*` stage; this repository does not authorize production
  deployment.

The example stage is `dev-first`. Choose a different `dev-*` name if those
resource names are already in use. Avoid attaching a custom domain or moving
an existing hostname for the first test.

## Preflight and deploy

Authenticate Wrangler for the intended Cloudflare account. Preflight checks
account access and the resources it knows how to inspect; a pass is not proof
that every Worker binding or the identity provider works.

```sh
nix develop -c deno task preflight -- --stage dev-first --no-containers
nix develop -c deno task deploy -- --stage dev-first --no-containers --projects --build-ext --no-print-url
```

The deploy builds the application and Issues bundle, renders the config,
creates or updates stage resources, and writes the single-use setup URL to
`.wrangler/deploy/setup-url.dev-first.txt` with restricted permissions. Treat
that file and URL as credentials. The deployment command changes the
Cloudflare account; run it only when ready to create the dev-stage forge.

Use `--no-containers --projects` again on every redeploy. Without a container
runner, there is no CI or automated landing; an owner can push fast-forward
to the default branch. `--repo-config` is not part of this first configuration: it needs Go at deploy time
and is separate from project scanning.

## Claim the forge

Open the setup URL, enter the forge name, canonical origin and OpenID Connect
provider details, then sign in as the owner. Confirm that the forge reports
healthy.

Once the claim has succeeded, remove the setup secret and its local URL file:

```sh
npx wrangler secret delete TARTAN_SETUP_TOKEN --name tartan-dev-first
rm .wrangler/deploy/setup-url.dev-first.txt
```

Keep `TARTAN_SECRET` unchanged across redeploys: it protects existing state.

## Install Issues

The build does not publish or install extensions. First create an admin
personal access token while signed in to the claimed forge. There is not yet
a token creation page, so run the following on the forge origin in the browser
console. The response contains a secret token; copy it privately and retain its
ID so you can revoke it. Do not paste it into a shell command or commit it.

```js
await (await fetch("/-/api/tokens", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		name: "issues-setup",
		scopes: ["repo:read", "api", "admin"],
		expiresInDays: 1,
	}),
})).json();
```

Install at the owner's root namespace to make Issues available to repositories
under it. Replace the example origin and node with the actual values. The
prompt reads the token without displaying it; the setup command reads it from
standard input and never prints it. Turn shell tracing off before entering a
secret.

```sh
set +x
read -r -s TARTAN_ISSUES_TOKEN
printf '\n'
printf '%s' "$TARTAN_ISSUES_TOKEN" | deno task issues:setup -- \
  --origin https://tartan-dev-first.example.workers.dev \
  --node owner \
  --bundle extensions/issues/dist/publish.json
unset TARTAN_ISSUES_TOKEN
```

The command validates the local package, publishes it if absent, and ensures
one matching installation at the target or an ancestor. Repeating it is safe:
it refuses a conflicting package or installation rather than replacing it.
In particular, do not uninstall an existing Issues installation to make this
command succeed: uninstalling deletes its data. Revoke the temporary token
from a signed-in browser session when finished:

```js
await fetch("/-/api/tokens/<token-id>", { method: "DELETE" });
```

## Verify the first forge

Create a private group and repository in the browser. To clone and push it,
create a separate short-lived Git token from the signed-in forge's browser
console:

```js
await (await fetch("/-/api/tokens", {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({
		name: "git-verification",
		scopes: ["repo:read", "repo:write"],
		expiresInDays: 1,
	}),
})).json();
```

Copy the secret privately and retain its ID. Use the repository's HTTPS clone
address; when Git prompts for credentials, enter any username and the token as
the password. The empty credential-helper setting below avoids saving it.
Clone before adding commits: the new repository already has an initial
commit. Replace the example URL with the address shown by your forge.

```sh
git -c credential.helper= clone https://tartan-dev-first.example.workers.dev/owner/group/repo.git
cd repo
mkdir -p api
cat > api/forge.cue <<'CUE'
package tartan

name: "api"
CUE
git add api/forge.cue
git commit -m "Add api project"
git -c credential.helper= push origin main
```

Revoke this token from the signed-in browser session when finished, using the
same `DELETE /-/api/tokens/<token-id>` call shown above. Then verify all of
the following on the actual dev-stage forge:

1. The repository can be cloned and its updated files browsed.
2. The `api` project appears after the default-branch push.
3. An issue created in that project appears there and in the repository-wide
   Issues view; closing and reopening it works.
4. The forge stays healthy after the asynchronous Artifacts push event. Wait
   at least three minutes, then check the repository's event log for unexpected
   `ref.tampered` events. From a signed-in browser session, resolve the node
   with `GET /-/api/nodes/resolve?path=<repository-path>`, then read
   `GET /-/api/events?repo=<node-id>&types=ref.tampered`.
5. A private repository is unavailable to an anonymous visitor and sign-in
   uses the intended identity provider.
6. A redeploy with the same flags preserves repository and issue data.

Project configuration is read textually. Setting
`extensions: "rawkode.issues": enabled: false` changes the project view but
is not a security boundary; repository-wide calls can still access issues.
See [Projects](projects.md) for the exact behavior and limitations.

Do not use the local seeded preview, a dry run, or fake-backed tests as proof
of these live checks. If any check fails, stop using the stage for real data
and investigate before proceeding.
