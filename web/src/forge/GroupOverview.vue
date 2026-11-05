<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { line, shell, stats } from "../../styled-system/recipes";
import {
	type ForgeNode,
	projectsUnder,
	reposUnder,
	urlFor,
	useForge,
	walk,
} from "./data/index.ts";
import { useSignInHref } from "./nav.ts";
import IssueRow from "./IssueRow.vue";

const props = defineProps<{ node: ForgeNode; scope: string }>();

const store = useForge();
const signIn = useSignInHref();

const openCount = computed(() => store.openCount(props.node));
const recent = computed(() =>
	store.issuesUnder(props.node).filter((i) => i.state === "open").slice(0, 5)
);
const repos = computed(() => reposUnder(props.node).length);
const projects = computed(() => projectsUnder(props.node).length);
const hierarchyIncomplete = computed(() =>
	walk(props.node).some((node) =>
		(node.kind === "group" || node.kind === "repo") &&
		(!node.loaded || !!node.loadError)
	)
);
const refused = computed(() => store.refusedUnder(props.node).length > 0);
const incomplete = computed(() => store.incompleteUnder(props.node) > 0);
const loading = computed(() => store.pendingUnder(props.node));
const showAllChildren = ref(false);
watch(() => props.scope, () => showAllChildren.value = false);
const children = computed(() =>
	showAllChildren.value ? props.node.children : props.node.children.slice(0, 8)
);

const page = shell();
const number = stats();
const rows = line();
</script>

<template>
	<div :class="page.pad">
		<div :class="number.root">
			<a v-if="openCount !== undefined" :href="urlFor(scope, 'issues')"
				:class="number.stat">
				<span :class="number.numeral">{{ openCount }}</span>
				<span :class="number.unit">Open issues</span>
			</a>
			<a v-if="!hierarchyIncomplete" :href="urlFor(scope, 'projects')" :class="number.stat" data-stat="projects">
				<span :class="number.numeral">{{ projects }}</span>
				<span
					:class="number.unit">{{ projects === 1 ? "Project" : "Projects" }}</span>
			</a>
			<div v-if="!hierarchyIncomplete" :class="number.stat" data-stat="repositories">
				<span :class="number.numeral">{{ repos }}</span>
				<span :class="number.unit">{{ repos === 1 ? "Repo" : "Repos" }}</span>
			</div>
		</div>

		<div class="overview-grid">
			<section class="overview-section">
				<div class="overview-section__head">
					<div>
						<h2>{{ scope ? "Inside this group" : "Namespaces" }}</h2>
						<p>{{ scope ? "Groups and repositories here" : "Groups and personal spaces" }}</p>
					</div>
				</div>
				<a v-for="child in children" :key="child.addr"
					:href="urlFor(child.addr)" class="namespace-row">
					<span class="namespace-row__icon" aria-hidden="true">
						<svg v-if="child.kind === 'group'" width="18" height="18"
							viewBox="0 0 16 16" fill="none" stroke="currentColor"
							stroke-width="1.4" stroke-linejoin="round">
							<path d="M1.5 3.5h4.2l1.4 1.6h7.4v7.4h-13z" />
						</svg>
						<svg v-else width="18" height="18" viewBox="0 0 16 16" fill="none"
							stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
							<circle cx="4.5" cy="3.5" r="1.75" />
							<circle cx="4.5" cy="12.5" r="1.75" />
							<circle cx="11.5" cy="5.5" r="1.75" />
							<path d="M4.5 5.25v5.5M11.5 7.25c0 2.6-7 1.4-7 3.5" />
						</svg>
					</span>
					<span class="namespace-row__text">
						<strong>{{ child.name }}</strong>
						<span v-if="child.description">{{ child.description }}</span>
					</span>
					<span class="namespace-row__arrow" aria-hidden="true">↗</span>
				</a>
				<p v-if="node.loaded && !node.children.length"
					:class="rows.empty">Nothing here yet.</p>
				<p v-if="!node.loaded" role="status"
					:class="rows.empty">{{ node.loadError ?? "Loading…" }}</p>
				<button v-if="node.children.length > 8" type="button" class="namespace-more"
					:aria-expanded="showAllChildren" @click="showAllChildren = !showAllChildren">
					{{ showAllChildren ? "Show fewer" : `Show all ${node.children.length}` }}
				</button>
			</section>
			<section class="overview-section">
				<div class="overview-section__head">
					<div>
						<h2>Recent issues</h2>
						<p>Open issues from the newest issue numbers</p>
					</div>
					<a :href="urlFor(scope, 'issues')">View all <span aria-hidden="true">→</span></a>
				</div>
				<IssueRow v-for="issue in recent" :key="`${issue.repo}#${issue.number}`"
					:issue="issue" :scope="scope" stacked />
				<p v-if="!recent.length && loading" role="status" :class="rows.empty">Loading issues…</p>
				<p v-else-if="!recent.length && !refused"
					:class="rows.empty">{{ incomplete ? "No open issues among those shown." : "No open issues here." }}</p>
				<p v-if="loading && recent.length" role="status" :class="rows.empty">Still loading other repositories…</p>
				<p v-if="incomplete" :class="rows.empty">Showing up to 100 newest issues per repository; older issues may be omitted.</p>
				<p v-if="refused"
					:class="rows.empty">Some issues could not be loaded. <a
						class="anon-only" :href="signIn"
						data-reload>Sign in</a></p>
			</section>
		</div>
	</div>
</template>

<style scoped>
.overview-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(min(19rem, 100%), 1fr));
	gap: 1.25rem;
	align-items: start;
}

.overview-section {
	min-width: 0;
	border: 1px solid var(--colors-academy-border);
	border-radius: 6px;
	background: var(--colors-academy-panel);
}

.overview-section__head {
	display: flex;
	justify-content: space-between;
	align-items: start;
	gap: 1rem;
	padding: 1.25rem;
	border-bottom: 1px solid var(--colors-academy-border);
}

.overview-section__head h2 {
	font-family: var(--fonts-academy-display);
	font-size: 1rem;
	font-weight: 700;
}

.overview-section__head p {
	margin: 0.25rem 0 0;
	color: var(--colors-academy-text-muted);
	font-size: 0.8125rem;
}

.overview-section__head a {
	flex: none;
	font-size: 0.8125rem;
	font-weight: 700;
}

.namespace-row {
	display: flex;
	align-items: center;
	gap: 0.875rem;
	min-height: 4.25rem;
	padding: 0.75rem 1.25rem;
	border-bottom: 1px solid var(--colors-academy-border);
	color: var(--colors-academy-text) !important;
}

.namespace-row:last-child {
	border-bottom: 0;
}

.namespace-row:hover {
	background: var(--colors-academy-ground);
	text-decoration: none !important;
}

.namespace-row__icon {
	display: grid;
	place-items: center;
	flex: none;
	width: 2.25rem;
	height: 2.25rem;
	border: 1px solid var(--colors-academy-border);
	border-radius: 5px;
	color: var(--colors-academy-accent);
	background: var(--colors-academy-ground);
}

.namespace-row__text {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-width: 0;
	overflow-wrap: anywhere;
}

.namespace-row__text strong {
	font-size: 0.9375rem;
}

.namespace-row__text > span,
.namespace-row__arrow {
	color: var(--colors-academy-text-muted);
	font-size: 0.8125rem;
}

.namespace-row__arrow {
	font-size: 1rem;
}

.namespace-more {
	width: 100%;
	padding: 0.875rem 1.25rem;
	border: 0;
	background: transparent;
	color: var(--colors-academy-accent);
	font-size: 0.8125rem;
	font-weight: 700;
	text-align: left;
	cursor: pointer;
}

.namespace-more:hover {
	background: var(--colors-academy-ground);
}
</style>
