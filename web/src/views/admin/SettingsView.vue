<script setup lang="ts">
// Forge identity, health and invite links.
import { computed } from "vue";
import { useApi, useSession } from "../../app/context.ts";
import AsyncState from "../../components/AsyncState.vue";
import InviteForm from "../../components/InviteForm.vue";
import PageHeader from "../../components/PageHeader.vue";
import TtIcon from "../../components/TtIcon.vue";
import { useResource } from "../../composables/resource.ts";

const api = useApi();
const session = useSession();
const signedIn = computed(() => session.state.status === "signed-in");
const forge = computed(() => session.state.me?.forge ?? null);
const health = useResource(() => 0, () => api.health());
</script>

<template>
	<div class="tt-stack">
		<PageHeader as="h2" title="Settings" subtitle="How this forge is configured. Change these through your deploy config or the setup wizard." />
		<p v-if="session.state.status === 'anonymous'" class="tt-panel">
			<a :href="session.loginUrl('/-/settings')">Sign in</a> to see the forge settings.
		</p>
		<template v-else>
			<p v-if="forge?.rootKeyFallback" class="chip chip--warning">
				<TtIcon name="lock" /> Root key held in Durable Object storage.
			</p>
			<section class="tt-panel tt-stack" aria-labelledby="forge-title">
				<h3 id="forge-title" class="set-title">Forge</h3>
				<dl class="set-kv">
					<dt>Name</dt><dd>{{ forge?.name ?? "not set" }}</dd>
					<template v-if="health.data.value">
						<dt>Version</dt><dd>{{ health.data.value.product }} {{ health.data.value.version }}</dd>
						<dt>Stage</dt><dd><code>{{ health.data.value.stage }}</code></dd>
						<dt>Compatibility date</dt><dd>{{ health.data.value.compatDate }}</dd>
					</template>
				</dl>
			</section>

			<section class="tt-panel tt-stack" aria-labelledby="health-title">
				<h3 id="health-title" class="set-title">Health</h3>
				<AsyncState
					:loading="health.loading.value"
					:error="health.error.value"
					:ready="health.data.value !== null"
					what="health"
					@retry="health.reload"
				>
					<ul v-if="health.data.value" class="bindings">
						<li v-for="(status, name) in health.data.value.bindings" :key="name" class="chip" :class="status === 'ok' ? 'chip--success' : status === 'missing' ? 'chip--warning' : 'chip--danger'">
							{{ name }}: {{ status }}
						</li>
					</ul>
				</AsyncState>
			</section>

			<section v-if="signedIn" class="tt-panel tt-stack" aria-labelledby="invite-title">
				<h3 id="invite-title" class="set-title">Invite people</h3>
				<InviteForm />
			</section>
		</template>
	</div>
</template>

<style scoped>
.set-title {
	font-size: var(--tt-text-md);
	margin-bottom: var(--tt-space-2);
}

.set-kv {
	display: grid;
	grid-template-columns: minmax(8rem, max-content) minmax(0, 1fr);
	gap: var(--tt-space-1) var(--tt-space-4);
	margin: 0;
}

.set-kv dt {
	color: var(--tt-text-muted);
	font-size: var(--tt-text-sm);
}

.set-kv dd {
	margin: 0;
	overflow-wrap: anywhere;
}

.bindings {
	display: flex;
	flex-wrap: wrap;
	gap: var(--tt-space-2);
	margin: 0;
	padding: 0;
	list-style: none;
}
</style>
