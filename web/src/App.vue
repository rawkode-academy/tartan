<script setup lang="ts">
// Every forge page shares one shell. Setup and authentication are standalone
// because the forge hierarchy may not exist until setup is complete.
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import ForgeApp from "./forge/ForgeApp.vue";
import ToastRegion from "./shell/ToastRegion.vue";

const route = useRoute();
const matched = computed(() => route.matched.length > 0);
const forgeRoute = computed(() => route.meta["forge"] === true);
const forgeContent = computed(() => route.meta["forgeContent"] === true);
</script>

<template>
	<a class="visually-hidden skip-link" href="#main">Skip to content</a>
	<ForgeApp v-if="forgeRoute">
		<RouterView v-if="forgeContent" />
	</ForgeApp>
	<main v-else-if="matched" id="main" class="standalone" tabindex="-1">
		<RouterView />
	</main>
	<ToastRegion />
</template>

<style scoped>
.standalone {
	max-width: var(--tt-content-max);
	margin: 0 auto;
	padding: var(--tt-space-6) var(--tt-gutter);
}

.standalone:focus {
	outline: none;
}

.skip-link:focus {
	position: absolute;
	top: var(--tt-space-2);
	left: var(--tt-space-2);
	padding: var(--tt-space-2) var(--tt-space-3);
	background: var(--tt-surface);
	z-index: 30;
}
</style>
