# Tartan runner image.
#
# The Sandbox SDK 0.12.1 base (Ubuntu 22.04, x86_64, node 22, npm, bun; its
# git 2.34.1 cannot run `merge-tree --write-tree`), pinned by digest,
# plus:
#   - git from the git-core PPA, signing key checked by fingerprint, pinned to
#     an exact .deb version: when the PPA drops that build, `apt-get install`
#     fails and the build fails closed until the pin is bumped deliberately;
#   - an assertion that git >= 2.38 and a real `merge-tree --write-tree`;
#   - pnpm installed with npm at an exact version (the base has no corepack);
#   - the unprivileged users of the token split: `tartan-git` runs
#     everything that parses repository content or CI code (read tokens at
#     most), `tartan-push` runs only execs that carry a write token; both are
#     in group `tartan`, which owns the shared mirror root `/srv` (setgid);
#   - `/etc/tartan-runner.json` (base digest, git, pnpm) for `/-/health`.
#
# No secrets are ever built in. Build (x86_64, also on arm64 hosts):
#   docker build --platform linux/amd64 -t tartan-runner containers/runner

ARG BASE=docker.io/cloudflare/sandbox:0.12.1@sha256:ea9b35e61c800eddbc4450fad333e5dd26033a06f7d36624388b0711bef9f8c5
# --- the runner ---------------------------------------------------------------
FROM ${BASE}

ARG BASE
# Exact git-core PPA build for jammy (bump deliberately; the build fails closed).
ARG GIT_DEB=1:2.56.0-0ppa1~ubuntu22.04.2
ARG GIT_PPA_FINGERPRINT=E1DD270288B4E6030699E45FA1715D88E1DF1F24
ARG GIT_MIN=2.38
ARG PNPM_VERSION=10.34.6

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN set -eux; \
	apt-get update; \
	apt-get install -y --no-install-recommends gnupg; \
	mkdir -p /etc/apt/keyrings; \
	curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x${GIT_PPA_FINGERPRINT}" \
		| gpg --dearmor -o /etc/apt/keyrings/git-core.gpg; \
	fpr="$(gpg --show-keys --with-colons /etc/apt/keyrings/git-core.gpg | awk -F: '/^fpr/ { print $10; exit }')"; \
	test "${fpr}" = "${GIT_PPA_FINGERPRINT}"; \
	echo "deb [signed-by=/etc/apt/keyrings/git-core.gpg] https://ppa.launchpadcontent.net/git-core/ppa/ubuntu jammy main" \
		> /etc/apt/sources.list.d/git-core.list; \
	apt-get update; \
	apt-get install -y --no-install-recommends "git=${GIT_DEB}"; \
	apt-mark hold git; \
	apt-get purge -y gnupg; \
	apt-get autoremove -y; \
	rm -rf /var/lib/apt/lists/*

# git >= GIT_MIN and a real merge-tree --write-tree, or the build fails.
RUN set -eux; \
	version="$(git --version | sed -n 's/^git version //p')"; \
	if ! printf '%s\n%s\n' "${GIT_MIN}" "${version}" | sort -V -C; then \
		echo "git ${version} is older than ${GIT_MIN}" >&2; exit 1; \
	fi; \
	dir="$(mktemp -d)"; cd "${dir}"; \
	git init -q -b main .; \
	git -c user.name=t -c user.email=t@t commit -q --allow-empty -m base; \
	git checkout -q -b other; echo o > o; git add o; \
	git -c user.name=t -c user.email=t@t commit -q -m other; \
	git checkout -q main; echo m > m; git add m; \
	git -c user.name=t -c user.email=t@t commit -q -m main; \
	git merge-tree --write-tree main other; \
	cd /; rm -rf "${dir}"

RUN set -eux; \
	npm install -g "pnpm@${PNPM_VERSION}"; \
	npm cache clean --force; \
	test "$(pnpm --version)" = "${PNPM_VERSION}"

RUN set -eux; \
	groupadd --system tartan; \
	useradd --create-home --user-group --groups tartan --shell /bin/bash tartan-git; \
	useradd --create-home --user-group --groups tartan --shell /bin/bash tartan-push; \
	install -d -m 2775 -o root -g tartan /srv; \
	install -d -m 0755 /workspace; \
	git config --system --add safe.directory '/srv/*'; \
	git config --system gc.auto 0; \
	command -v setpriv pkill base64 > /dev/null

RUN set -eux; \
	printf '{"base":"%s","git":"%s","gitDeb":"%s","pnpm":"%s"}\n' \
		"${BASE}" "$(git --version | sed -n 's/^git version //p')" "${GIT_DEB}" "${PNPM_VERSION}" \
		> /etc/tartan-runner.json
