# Tartan

Tartan is a self-deployable Git forge for Cloudflare. One deployment hosts a
hierarchy of groups and repositories, with Git data backed by Cloudflare
Artifacts. Repositories can contain projects discovered from CUE files. Issues
run as a WebAssembly extension and can be viewed for a repository or a project.

This is an early proof of concept. The first deployment is intended for a
private `dev` or `dev-*` stage. The Cloudflare deployment, real Artifacts push
events, and real identity provider still need live end-to-end verification.

## Try the forge locally

With the dependencies from the Nix development shell installed:

```sh
nix develop -c deno task poc
```

The command starts a local forge, builds and installs the Issues extension,
and seeds example groups, repositories, projects, and issues. It prints the
address and sign-in instructions and stays running until interrupted. Local
repository storage and identity use development fakes; this is not evidence of
a deployed Cloudflare integration. See [Projects](docs/projects.md) for the
project and issue model.

## Prepare a first deployment

See [First deployment](docs/poc-deploy.md) for prerequisites, the `dev-*`
deployment configuration, claiming the forge, installing Issues, and the live
checks to run before trusting it with data. No deployment is performed by the
local preview.

The initial configuration deliberately has no container runner. The owner can
push a fast-forward update to the default branch, but CI and automated landing
are unavailable. Project CUE files are read textually; the Issues switch is a
convenience for project views, not an access-control policy.

## Development

Install the exact npm dependencies once in the main checkout, then use the
tasks in `deno.json`. [Agent guidance](AGENTS.md) describes the repository
conventions and verification commands. [Documentation](docs/README.md) links
the current guides and architecture notes.

Tartan is licensed under the [MIT license](LICENSE).
