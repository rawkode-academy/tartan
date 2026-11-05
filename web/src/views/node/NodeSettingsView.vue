<script setup lang="ts">
// A node's current metadata and the link to extension installation.
import { RouterLink } from "vue-router";
import AsyncState from "../../components/AsyncState.vue";
import { formatTime } from "../../ui/format.ts";
import { useNodeView } from "../repo/useNodeView.ts";

const node = useNodeView(() => "settings");
</script>

<template>
	<AsyncState
		:loading="node.loading.value"
		:error="node.error.value"
		:status="node.status.value"
		:ready="node.data.value !== null"
		what="these settings"
		@retry="node.reload"
	>
		<div v-if="node.data.value" class="tt-stack">
			<h2>Settings</h2>
			<section class="tt-panel" aria-labelledby="about-title">
				<h3 id="about-title" class="settings-title">About</h3>
				<dl class="settings-kv">
					<dt>Kind</dt><dd>{{ node.data.value.node.kind }}</dd>
					<dt>Visibility</dt><dd>{{ node.data.value.node.visibility }}</dd>
					<template v-if="node.data.value.node.defaultBranch">
						<dt>Default branch</dt><dd><code>{{ node.data.value.node.defaultBranch }}</code></dd>
					</template>
					<dt>Created</dt><dd>{{ formatTime(node.data.value.node.createdAt) }}</dd>
				</dl>
			</section>
			<section class="tt-panel tt-stack" aria-labelledby="extensions-title">
				<h3 id="extensions-title" class="settings-title">Extensions</h3>
				<p>Install or manage extensions, including Issues, at this namespace in <RouterLink :to="{ path: '/-/extensions', query: { node: node.data.value.node.path } }">Extensions</RouterLink>.</p>
			</section>
		</div>
	</AsyncState>
</template>

<style scoped>
.settings-title {
	font-size: var(--tt-text-md);
	margin-bottom: var(--tt-space-3);
}

.settings-kv {
	display: grid;
	grid-template-columns: minmax(8rem, max-content) minmax(0, 1fr);
	gap: var(--tt-space-2) var(--tt-space-4);
	margin: 0;
}

.settings-kv dt {
	color: var(--tt-text-muted);
	font-size: var(--tt-text-sm);
}

.settings-kv dd {
	margin: 0;
	min-width: 0;
	overflow-wrap: anywhere;
}

@media (max-width: 30rem) {
	.settings-kv {
		grid-template-columns: minmax(0, 1fr);
	}

	.settings-kv dd {
		margin-bottom: var(--tt-space-2);
	}
}
</style>
