<script setup lang="ts">
const isDemo = import.meta.env.VITE_TARTAN_MOCK === "1";
</script>

<template>
	<span v-if="isDemo" class="demo-indicator">Demo data</span>
</template>

<style scoped>
.demo-indicator {
	flex: none;
	padding: 0.15rem 0.45rem;
	border: 1px solid var(--colors-academy-ink-border);
	border-radius: 0.35rem;
	color: var(--colors-academy-ink-text-soft);
	font-size: 0.7rem;
	font-weight: 600;
	line-height: 1.4;
	white-space: nowrap;
}
</style>
