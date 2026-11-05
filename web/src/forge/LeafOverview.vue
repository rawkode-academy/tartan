<script setup lang="ts">
// A project, or a repo that is a single project.
import { computed, watch } from "vue";
import { css } from "../../styled-system/css";
import {
	detail,
	facts,
	heading,
	line,
	text,
} from "../../styled-system/recipes";
import { blobHref, treeHref } from "../router/params.ts";
import {
	type ForgeNode,
	type PlacedIssue,
	rel,
	urlFor,
	useForge,
} from "./data/index.ts";
import CloneCommand from "./CloneCommand.vue";
import CommitList from "./CommitList.vue";
import IssueRow from "./IssueRow.vue";
import RepoFile from "./RepoFile.vue";
import RepoReadme from "./RepoReadme.vue";

const props = defineProps<{ node: ForgeNode; repo: ForgeNode; scope: string }>();

const store = useForge();

const isProject = computed(() => props.node.kind === "project");
const branch = computed(() => props.repo.defaultBranch ?? "main");
watch(() => props.node.addr, (addr) => void store.ensureIssueState(addr, "open"), { immediate: true });

const ownIssues = computed(() => store.issueState(props.node.addr, "open"));
const issuesOn = computed(() => {
	const known = ownIssues.value;
	return props.node.issuesEnabled !== false && known?.status === "ready";
});
const issues = computed((): PlacedIssue[] => {
	const known = ownIssues.value;
	if (known?.status !== "ready") return [];
	return known.list.issues
		.filter((i) => i.state === "open")
		.map((i) => store.placed(props.repo, i))
		.slice(0, 6);
});
const openTotal = computed(() =>
	ownIssues.value?.status === "ready" ? ownIssues.value.list.open : 0
);
const scanned = computed(() =>
	ownIssues.value?.status === "ready" ? ownIssues.value.list.issues.length : 0
);
const issueWidth = computed(() =>
	issues.value.reduce(
		(max, i) =>
			Math.max(
				max,
				rel(props.scope, i.where).length + String(i.number).length + 1,
			),
		0,
	)
);

const projectUrl = (name: string) => urlFor(`${props.repo.addr}:${name}`);

const page = detail();
const rows = line();
const list = facts();
const label = heading({ size: "rule" });
const muted = text({ tone: "muted", size: "sm" });
const section = css({ display: "flex", flexDirection: "column" });
const refs = css({ display: "flex", flexWrap: "wrap", columnGap: "2" });
</script>

<template>
	<div class="leaf-container">
		<div :class="[page.columns, 'leaf-layout']">
			<div :class="[page.main, 'leaf-layout__main']">
				<section v-if="issuesOn" :class="[section, 'leaf-card']">
					<h2 :class="[label, 'leaf-card__head']">Open issues</h2>
					<IssueRow v-for="issue in issues" :key="issue.number" :issue="issue"
						:scope="scope" :width="issueWidth" />
					<p v-if="!issues.length && openTotal === 0" :class="rows.empty">No open issues here.</p>
					<p v-else-if="!issues.length" :class="rows.empty">No open issues among the newest {{ scanned }}.</p>
				</section>

				<RepoFile v-if="node.manifestPath" :repo="repo"
					:path="node.manifestPath" title="Project file" />
				<RepoReadme :repo="repo" :dir="node.root" />
				<CommitList :repo="repo" :path="node.root" />
			</div>

			<aside aria-label="Details" :class="[page.aside, 'leaf-layout__aside']">
				<section class="leaf-card leaf-details">
					<h2>Details</h2>
					<dl :class="list.root">
						<div :class="list.row">
							<dt :class="list.term">Path</dt>
							<dd :class="list.value">
								<a :href="treeHref(repo.addr, branch, node.root ?? '')">{{ node.root ?? "Repository root" }}</a>
							</dd>
						</div>
						<template v-if="isProject">
							<div :class="list.row">
								<dt :class="list.term">Defined in</dt>
								<dd :class="list.value">
									<a v-if="node.manifestPath"
										:href="blobHref(repo.addr, branch, node.manifestPath)">{{ node.manifestPath }}</a>
								</dd>
							</div>
							<div :class="list.row">
								<dt :class="list.term">Depends on</dt>
								<dd :class="[list.value, refs]">
									<a v-for="dep in node.deps" :key="dep"
										:href="projectUrl(dep)">{{ dep }}</a>
									<template v-if="!node.deps.length">—</template>
								</dd>
							</div>
							<div :class="list.row">
								<dt :class="list.term">Used by</dt>
								<dd :class="[list.value, refs]">
									<a v-for="user in node.dependents" :key="user"
										:href="projectUrl(user)">{{ user }}</a>
									<template v-if="!node.dependents.length">—</template>
								</dd>
							</div>
						</template>
					</dl>
				</section>

				<section class="leaf-card leaf-clone">
					<CloneCommand :repo="repo.addr"
						:note="isProject ? `The whole repo. This project is under ${node.root}.` : undefined" />
				</section>
				<p v-if="!isProject"
					:class="muted">To split this repo into projects, commit a <code>.cue</code> file in <code>package tartan</code> to a directory.</p>
			</aside>
		</div>
	</div>
</template>

<style scoped>
.leaf-container {
	container-type: inline-size;
}

.leaf-layout {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(13rem, 17rem);
	gap: 1.25rem;
	width: 100%;
	max-width: 1280px;
}

.leaf-layout__main,
.leaf-layout__aside {
	gap: 1.25rem;
	padding-block-start: 1.5rem;
}

.leaf-card {
	min-width: 0;
	border: 1px solid var(--colors-academy-border);
	border-radius: 6px;
	background: var(--colors-academy-panel);
}

.leaf-card__head {
	padding: 1rem 1.25rem;
	border-color: var(--colors-academy-border);
}

.leaf-details,
.leaf-clone {
	padding: 1.25rem;
}

.leaf-details h2 {
	margin-bottom: 0.75rem;
	font-family: var(--fonts-academy-display);
	font-size: 1rem;
	font-weight: 700;
}

.leaf-details dl {
	border-top: 0;
}

@container (max-width: 44rem) {
	.leaf-layout {
		grid-template-columns: minmax(0, 1fr);
	}

	.leaf-layout__aside {
		padding-block-start: 0;
	}
}
</style>
