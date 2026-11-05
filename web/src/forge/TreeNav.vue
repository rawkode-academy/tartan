<script setup lang="ts">
import { css } from "../../styled-system/css";
import { tree } from "../../styled-system/recipes";
import { Button } from "../design-system/index.ts";
import { type ForgeNode, type Route, urlFor, useForge } from "./data/index.ts";
import TreeLevel from "./TreeLevel.vue";

defineProps<{ scope: string; route: Route }>();

const store = useForge();

const styles = tree();
const issuesHead = css({ marginInlineEnd: "[2.75rem]" });
const footLinks = css({
	display: "grid",
	gridTemplateColumns: "repeat(2, 1fr)",
	gap: "2",
});
</script>

<template>
	<nav aria-label="Tree" class="tree-nav">
		<div
			:class="styles.head"><span>Browse</span><span :class="issuesHead">Issues</span></div>
		<div class="tree-nav__scroll">
			<div :class="styles.row"
				:data-current="scope === '' && !route.detail ? '' : undefined">
				<a href="/"
					:aria-current="scope === '' && !route.detail ? 'page' : undefined"
					:class="styles.link">
					<span :class="styles.text"><span :class="styles.name">~</span></span>
					<span v-if="store.openCount(store.state.tree as ForgeNode) !== undefined"
						:class="styles.count"
						data-dim>{{ store.openCount(store.state.tree as ForgeNode) }}</span>
				</a>
				<span :class="styles.spacer"></span>
			</div>
			<TreeLevel :node="store.state.tree as ForgeNode" :scope="scope"
				:route="route" />
			<div v-if="scope === ''" :class="[styles.actions, 'owner-only']">
				<Button :href="urlFor('', 'new/group')">New group</Button>
				<Button :href="urlFor('', 'new/repo')">New repo</Button>
			</div>
		</div>
		<div :class="styles.foot">
			<p class="tree-nav__label">Forge</p>
			<div :class="footLinks" class="tree-nav__links">
				<a href="/">Overview</a>
				<a class="member-only" href="/-/extensions">Extensions</a>
			</div>
		</div>
	</nav>
</template>

<style scoped>
.tree-nav {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.tree-nav__scroll {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	padding-block: 0.5rem;
	scrollbar-color: var(--colors-academy-border) transparent;
	scrollbar-width: thin;
}

.tree-nav__label {
	margin: 0 0 0.5rem;
	color: var(--colors-academy-text-muted);
	font-size: 0.6875rem;
	font-weight: 700;
	letter-spacing: 0.08em;
	text-transform: uppercase;
}

.tree-nav__links a {
	color: var(--colors-academy-text-soft);
}

.tree-nav__links a:hover {
	color: var(--colors-academy-accent);
}

@media (max-width: 831px) {
	.tree-nav {
		height: auto;
	}

	.tree-nav__scroll {
		overflow: visible;
	}
}
</style>
