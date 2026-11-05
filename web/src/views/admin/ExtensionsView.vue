<script setup lang="ts">
// Install extensions after reviewing their permissions.
import { computed, reactive, ref, shallowRef, useId, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import type { PackageDto, PermissionSheet } from "@tartan/contract/api.ts";
import { useApi, useSession } from "../../app/context.ts";
import { errorMessage } from "../../api/http.ts";
import AsyncState from "../../components/AsyncState.vue";
import PageHeader from "../../components/PageHeader.vue";
import { useResource } from "../../composables/resource.ts";
import { useToasts } from "../../shell/toasts.ts";
import { formatTime } from "../../ui/format.ts";

const api = useApi();
const session = useSession();
const toasts = useToasts();
const id = useId();
const route = useRoute();
const router = useRouter();
const NODE_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;

const signedIn = computed(() => session.state.status === "signed-in");

/**
 * WP7a answers "what is in force at this node" (inherited installations
 * included, nearest first). The page starts where the kernel says (`shownAt`
 * empty: no `node`): the viewer's first readable node with a grant. An
 * invited user has no namespace of their own, so the handle is no default.
 */
const initialNode = typeof route.query.node === "string" && NODE_RE.test(route.query.node)
	? route.query.node
	: "";
const viewAt = ref(initialNode);
const shownAt = ref(initialNode);
watch(() => route.query.node, (value) => {
	const node = typeof value === "string" && NODE_RE.test(value) ? value : "";
	if (node !== shownAt.value) {
		viewAt.value = node;
		shownAt.value = node;
	}
});
const installations = useResource(
	() => (signedIn.value ? shownAt.value : null),
	(node) =>
		node === null
			? Promise.resolve(null)
			: api.extensions.installations(node === "" ? undefined : node),
);
watch(installations.data, (answer) => {
	if (answer && shownAt.value === "" && viewAt.value === "") {
		viewAt.value = answer.node.path;
	}
});
const current = computed(() =>
	installations.loadedKey.value === shownAt.value ? installations.data.value : null
);
// Disabled rows require installation permission. Load them separately so a
// reader can still see the effective installations when this request is denied.
const disabledAt = computed(() => signedIn.value ? current.value?.node.path ?? null : null);
const disabledInstallations = useResource(disabledAt, (node) =>
	node === null ? Promise.resolve(null) : api.extensions.installations(node, true));
const disabledReady = computed(() =>
	disabledAt.value !== null && disabledInstallations.loadedKey.value === disabledAt.value &&
	disabledInstallations.data.value !== null
);
/** The start-node answer found nothing the viewer may read: not an error. */
const noStart = computed(() =>
	shownAt.value === "" && installations.status.value === 404
);
const inForce = computed(() =>
	(current.value?.installations ?? [])
		.slice()
		.sort((a, b) => b.depth - a.depth)
		.map((i) => i.installation)
);
const disabled = computed(() =>
	disabledReady.value ? disabledInstallations.data.value?.disabled ?? [] : []
);
const showAt = (): void => {
	const node = viewAt.value.trim();
	if (!NODE_RE.test(node)) return;
	shownAt.value = node;
	void router.replace({ query: { ...route.query, node } });
};
const packages = useResource(signedIn, (yes) =>
	yes ? api.extensions.packages() : Promise.resolve(null));

const install = reactive({
	pkg: null as PackageDto | null,
	node: "",
});
const sheet = shallowRef<PermissionSheet | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);

const request = computed(() =>
	install.pkg
		? {
			extId: install.pkg.extId,
			version: install.pkg.version,
			node: install.node.trim(),
			mode: "enforce" as const,
			...(install.pkg.extId === "rawkode.issues" ? { ensure: true } : {}),
		}
		: null
);

const start = (pkg: PackageDto): void => {
	install.pkg = pkg;
	sheet.value = null;
	error.value = null;
};

const review = async (): Promise<void> => {
	if (!request.value || !NODE_RE.test(request.value.node)) {
		error.value = "Enter the group or repository to install into, for example acme.";
		return;
	}
	busy.value = true;
	error.value = null;
	try {
		sheet.value = await api.extensions.sheet(request.value);
	} catch (e) {
		error.value = errorMessage(e);
	} finally {
		busy.value = false;
	}
};

const approve = async (): Promise<void> => {
	if (!request.value || !sheet.value) return;
	busy.value = true;
	error.value = null;
	try {
		const created = await api.extensions.install(request.value);
		toasts.push({ tone: "success", text: `${created.extId} installed at ${created.nodePath}.` });
		install.pkg = null;
		sheet.value = null;
		await installations.reload();
	} catch (e) {
		error.value = errorMessage(e);
	} finally {
		busy.value = false;
	}
};
</script>

<template>
	<div class="tt-stack">
		<PageHeader as="h2" title="Extensions" subtitle="Install and manage extensions for your forge." />
		<p v-if="session.state.status === 'anonymous'" class="tt-panel">
			<a :href="session.loginUrl('/-/extensions')">Sign in</a> to manage extensions.
		</p>
		<template v-else>
			<section class="tt-stack" aria-labelledby="installed-title">
				<h3 id="installed-title" class="ext-title">Installed</h3>
				<form class="tt-row ext-at" @submit.prevent="showAt">
					<label :for="`${id}-at`" class="tt-field__label">In force at</label>
					<input
						:id="`${id}-at`"
						v-model="viewAt"
						class="tt-input ext-at__input"
						name="installed-at"
						autocomplete="off"
						spellcheck="false"
					/>
					<button type="submit" class="tt-button tt-button--sm">Show</button>
				</form>
				<p v-if="noStart" class="tt-muted">Enter a namespace to see the extensions in force there.</p>
				<AsyncState
					v-else
					:loading="installations.loading.value"
					:error="installations.error.value"
					:status="installations.status.value"
					:ready="current !== null"
					what="installations"
					@retry="installations.reload"
				>
					<h3 class="ext-title">In force</h3>
					<p v-if="inForce.length === 0" class="tt-muted">No extensions are in force here.</p>
					<div v-else class="tt-scroll-x tt-panel ext-table">
						<table class="tt-table" aria-label="Extensions in force">
							<thead>
								<tr>
									<th scope="col">Extension</th>
									<th scope="col">Node</th>
									<th scope="col">Mode</th>
									<th scope="col">Version</th>
									<th scope="col">Installed</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="inst in inForce" :key="inst.id">
									<td>
										<RouterLink :to="{ path: `/-/extensions/${encodeURIComponent(inst.id)}`, query: { node: current?.node.path } }">{{ inst.extId }}</RouterLink>
										<span v-if="inst.locked" class="chip chip--muted">locked</span>
										<span v-if="inst.pack" class="chip chip--muted">pack {{ inst.pack }}</span>
									</td>
									<td><code>{{ inst.nodePath }}</code></td>
									<td>
										<span class="chip" :class="inst.mode === 'enforce' ? 'chip--success' : inst.mode === 'shadow' ? 'chip--warning' : 'chip--muted'">{{ inst.mode }}</span>
									</td>
									<td>{{ inst.version }}</td>
									<td>{{ formatTime(inst.installedAt) }}</td>
								</tr>
							</tbody>
						</table>
					</div>
					<section class="tt-stack" aria-labelledby="disabled-title">
						<h3 id="disabled-title" class="ext-title">Disabled here</h3>
						<p class="tt-muted">Disabled extensions are listed at the namespace where they were installed. To manage one from a parent namespace, select that namespace above.</p>
						<p v-if="disabledInstallations.status.value === 403" class="tt-muted">Only maintainers can manage disabled extensions here.</p>
						<AsyncState v-else :loading="disabledInstallations.loading.value" :error="disabledInstallations.error.value" :status="disabledInstallations.status.value" :ready="disabledReady" what="disabled extensions" @retry="disabledInstallations.reload">
						<p v-if="disabled.length === 0" class="tt-muted">No extensions are disabled here.</p>
						<div v-else class="tt-scroll-x tt-panel ext-table">
							<table class="tt-table" aria-label="Disabled extensions">
								<thead><tr><th scope="col">Extension</th><th scope="col">Namespace</th><th scope="col">Version</th></tr></thead>
								<tbody>
									<tr v-for="inst in disabled" :key="inst.id">
										<td><RouterLink :to="{ path: `/-/extensions/${encodeURIComponent(inst.id)}`, query: { node: current?.node.path } }">{{ inst.extId }}</RouterLink></td>
										<td><code>{{ inst.nodePath }}</code></td>
										<td>{{ inst.version }}</td>
									</tr>
								</tbody>
							</table>
						</div>
						</AsyncState>
					</section>
				</AsyncState>
			</section>

			<section class="tt-stack" aria-labelledby="registry-title">
				<h3 id="registry-title" class="ext-title">Available packages</h3>
				<AsyncState
					:loading="packages.loading.value"
					:error="packages.error.value"
					:status="packages.status.value"
					:ready="packages.data.value !== null"
					what="packages"
					@retry="packages.reload"
				>
					<p v-if="packages.data.value?.packages.length === 0" class="tt-muted">No extensions are available yet.</p>
					<ul class="pkg-list">
						<li v-for="pkg in packages.data.value?.packages ?? []" :key="`${pkg.extId}@${pkg.version}`" class="pkg tt-panel">
							<div class="pkg__head">
								<strong>{{ pkg.manifest.name }}</strong>
								<code class="pkg__id">{{ pkg.extId }}@{{ pkg.version }}</code>
								<span class="chip chip--muted">{{ pkg.runtime }}</span>
								<span v-if="pkg.bundled" class="chip chip--muted">bundled</span>
							</div>
							<p v-if="pkg.manifest.description" class="pkg__desc">{{ pkg.manifest.description }}</p>
							<div class="tt-row">
								<button type="button" class="tt-button tt-button--sm" @click="start(pkg)">Install…</button>
							</div>

							<form
								v-if="install.pkg?.extId === pkg.extId && install.pkg.version === pkg.version"
								class="tt-stack install"
								novalidate
								@submit.prevent="sheet ? approve() : review()"
							>
								<div class="install__grid">
									<div class="tt-field">
										<label :for="`${id}-node`" class="tt-field__label">Install at</label>
										<input :id="`${id}-node`" v-model="install.node" class="tt-input" name="node" placeholder="acme" spellcheck="false" @input="sheet = null" />
									</div>
								</div>
								<div v-if="sheet" class="sheet" role="region" aria-label="Permission sheet">
									<p class="sheet__title">{{ pkg.manifest.name }} will be able to:</p>
									<ul class="sheet__lines">
										<li v-for="(line, i) in sheet.lines" :key="i">{{ line }}</li>
									</ul>
									<p v-if="sheet.replaces" class="chip chip--warning">
										Replaces {{ sheet.replaces.ext }} as the {{ sheet.replaces.iface }} provider at {{ sheet.replaces.node }}.
									</p>
									<p v-for="(warning, i) in sheet.warnings" :key="`w${i}`" class="chip chip--warning">{{ warning }}</p>
									<p v-if="sheet.needsOwner" class="tt-hint">This install needs an Owner of the node.</p>
								</div>
								<p v-if="error" class="chip chip--danger" role="alert">{{ error }}</p>
								<div class="tt-row">
									<button type="submit" class="tt-button tt-button--primary" :disabled="busy">
										{{ busy ? "Working…" : sheet ? "Approve and install" : "Review permissions" }}
									</button>
									<button type="button" class="tt-button" @click="install.pkg = null">Cancel</button>
								</div>
							</form>
						</li>
					</ul>
				</AsyncState>
			</section>
		</template>
	</div>
</template>

<style scoped>
.ext-title {
	font-size: var(--tt-text-md);
}

.ext-at {
	align-items: center;
}

.ext-at__input {
	flex: 1 1 12rem;
	min-width: 0;
	max-width: 24rem;
}

.ext-table {
	padding: 0;
}

.pkg-list {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: var(--tt-space-3);
	margin: 0;
	padding: 0;
	list-style: none;
}

@media (min-width: 64rem) {
	.pkg-list {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

.pkg {
	display: flex;
	flex-direction: column;
	gap: var(--tt-space-2);
}

.pkg__head {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--tt-space-2);
}

.pkg__id {
	color: var(--tt-text-muted);
}

.pkg__desc {
	margin: 0;
	color: var(--tt-text-muted);
}

.install {
	padding-top: var(--tt-space-3);
	border-top: 1px solid var(--tt-border);
}

.install__grid {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: var(--tt-space-3);
}

.sheet {
	padding: var(--tt-space-3);
	background: var(--tt-surface-sunken);
	border-radius: var(--tt-radius);
}

.sheet__title {
	margin: 0 0 var(--tt-space-2);
	font-weight: 600;
}

.sheet__lines {
	margin: 0 0 var(--tt-space-2);
	padding-inline-start: 1.25rem;
}
</style>
