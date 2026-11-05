<script setup lang="ts">
// Repository content and optional extension contributions inside the forge shell.
import { computed, inject, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import type { StaticContributionDto, ViewResponse } from "@tartan/contract/api.ts";
import type { SlotCtxHint } from "../api/client.ts";
import { API } from "../app/context.ts";
import { nodeHref } from "../router/params.ts";
import { useToasts } from "../shell/toasts.ts";
import { postStaticAction } from "../slots/actions.ts";
import { useSlotRegistry } from "../slots/registry.ts";
import SlotOutlet from "../slots/SlotOutlet.vue";
import TtIcon from "./TtIcon.vue";

const props = defineProps<{
	view: ViewResponse;
	ctx: SlotCtxHint;
	wide?: boolean;
}>();

const api = inject(API, null);
const router = useRouter();
const toasts = useToasts();
const registry = useSlotRegistry();
const actions = computed(() =>
	props.view.static.actions.filter((action) => action.slot === "repo.header.action")
);
const extensionTabs = computed(() =>
	props.view.static.tabs
		.filter((tab) =>
			tab.slot === "repo.tab" && tab.route &&
			tab.route.split("/")[0] !== "issues"
		)
		.slice()
		.sort((a, b) => a.order - b.order)
		.map((tab) => ({
			id: tab.id,
			label: tab.label ?? tab.id,
			to: `${nodeHref(props.view.node.path)}/-/${
				(tab.route ?? tab.id).replace(/\*.*$/, "").replace(/\/$/, "")
			}`,
		}))
);
const showSidebar = computed(() =>
	!props.wide && props.view.slots.some((slot) => slot.slot === "repo.sidebar")
);
const pending = ref<string | null>(null);
const actionKey = (action: StaticContributionDto): string =>
	`${action.installationId}/${action.id}`;

const runAction = async (action: StaticContributionDto): Promise<void> => {
	if (pending.value !== null) return;
	if (!api) {
		toasts.push({ tone: "danger", text: "The API is not available." });
		return;
	}
	pending.value = actionKey(action);
	try {
		await postStaticAction({
			api,
			navigate: (path) => void router.push(path),
			toast: (toast) => toasts.push(toast),
			refreshSlots: (ids) => registry?.refresh(ids),
		}, action, props.ctx);
	} finally {
		pending.value = null;
	}
};
</script>

<template>
	<div class="repo-content">
		<nav v-if="extensionTabs.length" class="repo-content__extensions" aria-label="Extension pages">
			<RouterLink v-for="tab in extensionTabs" :key="tab.id" :to="tab.to">{{ tab.label }}</RouterLink>
		</nav>
		<div class="repo-content__status">
			<span class="chip chip--muted">{{ view.node.visibility }}</span>
			<span v-if="view.node.archived" class="chip chip--warning">archived</span>
			<span v-if="view.repo?.landingPaused" class="chip chip--warning">landing paused</span>
			<button v-for="action in actions" :key="actionKey(action)" type="button"
				class="tt-button tt-button--sm" :title="action.title" :disabled="pending !== null"
				:aria-busy="pending === actionKey(action)" :data-action="action.id" @click="runAction(action)">
				<TtIcon v-if="action.icon" :name="action.icon" />{{ action.label ?? action.id }}
			</button>
		</div>
		<ul v-if="view.banners.length" class="repo-content__banners">
			<li v-for="(banner, index) in view.banners" :key="index" class="chip" :class="`chip--${banner.tone}`">{{ banner.text }}</li>
		</ul>
		<div class="repo-content__body" :class="{ 'repo-content__body--wide': !showSidebar }">
			<div class="repo-content__main"><slot /></div>
			<aside v-if="showSidebar" class="repo-content__side" aria-label="Repository sidebar">
				<SlotOutlet :slots="view.slots" slot-id="repo.sidebar" :ctx="ctx" :repo-id="view.repo?.id" />
			</aside>
		</div>
	</div>
</template>

<style scoped>
.repo-content, .repo-content__main, .repo-content__side {
	display: flex;
	flex-direction: column;
	gap: var(--tt-space-4);
	min-width: 0;
}

.repo-content__status {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: var(--tt-space-2);
}

.repo-content__extensions {
	display: flex;
	flex-wrap: wrap;
	gap: var(--tt-space-4);
	font-size: var(--tt-text-sm);
}

.repo-content__banners {
	display: flex;
	flex-wrap: wrap;
	gap: var(--tt-space-2);
	margin: 0;
	padding: 0;
	list-style: none;
}

.repo-content__body {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: var(--tt-space-6);
}

@media (min-width: 64rem) {
	.repo-content__body:not(.repo-content__body--wide) {
		grid-template-columns: minmax(0, 1fr) 18rem;
	}
}
</style>
