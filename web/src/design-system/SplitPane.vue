<script setup lang="ts">
import { Splitter, useSplitter } from "@ark-ui/vue/splitter";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { split } from "../../styled-system/recipes";

const props = defineProps<{
	// Names the side panel to assistive technology.
	label: string;
	// Remembers the viewer's width under this localStorage key.
	storageKey: string;
	defaultWidth: number;
	minWidth: number;
	maxWidth: number;
	// Close the compact navigation after the address changes.
	locationKey?: string;
}>();

const mainMinWidth = 320;
const sideOpen = ref(false);
const panelId = `${props.label.replace(/\s+/g, "-")}-navigation`;
watch(() => props.locationKey, () => sideOpen.value = false);
const root = ref<{ $el: HTMLElement }>();
const element = () => root.value?.$el;

// The width the viewer asked for. A small window can squeeze the panel below it.
let wanted = props.defaultWidth;

const splitter = useSplitter({
	panels: [
		{
			id: "side",
			minSize: `${props.minWidth}px`,
			maxSize: `${props.maxWidth}px`,
			resizeBehavior: "preserve-pixel-size",
		},
		{ id: "main", minSize: `${mainMinWidth}px` },
	],
	defaultSize: [`${props.defaultWidth}px`, undefined] as unknown as number[],
	keyboardResizeBy: 1,
	onResizeEnd: ({ size }) => {
		wanted = Math.round((size[0] / 100) * (element()?.offsetWidth ?? 0));
		try {
			localStorage.setItem(props.storageKey, String(wanted));
		} catch {}
	},
});

// Give the panel its width back whenever there is room for it.
const restore = () => {
	const total = element()?.offsetWidth ?? 0;
	if (total < wanted + mainMinWidth) return;
	const percent = (wanted / total) * 100;
	if (Math.abs(splitter.value.getSizes()[0] - percent) > 0.1) {
		splitter.value.setSizes([percent, 100 - percent]);
	}
};

let observer: ResizeObserver | undefined;
let restoreFrame: number | undefined;

onMounted(() => {
	try {
		const saved = Number(localStorage.getItem(props.storageKey));
		if (saved >= props.minWidth && saved <= props.maxWidth) wanted = saved;
	} catch {}
	observer = new ResizeObserver(() => {
		if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
		restoreFrame = requestAnimationFrame(() => {
			restoreFrame = undefined;
			restore();
		});
	});
	observer.observe(element()!);
});

onBeforeUnmount(() => {
	observer?.disconnect();
	if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
});

const styles = split();
</script>

<template>
	<Splitter.RootProvider ref="root" :value="splitter" :class="styles.root">
		<Splitter.Panel id="side" :class="styles.side">
			<button type="button" class="split-pane__toggle" :aria-expanded="sideOpen"
				:aria-controls="panelId" @click="sideOpen = !sideOpen">
				<span>Browse {{ label }}</span>
				<span aria-hidden="true">{{ sideOpen ? "−" : "+" }}</span>
			</button>
			<div :id="panelId" class="split-pane__body"
				:class="{ 'split-pane__body--open': sideOpen }"><slot name="side" /></div>
		</Splitter.Panel>
		<Splitter.ResizeTrigger id="side:main" :aria-label="`Resize ${label}`"
			:class="styles.trigger" />
		<Splitter.Panel id="main" :class="styles.main"><slot /></Splitter.Panel>
	</Splitter.RootProvider>
</template>

<style scoped>
.split-pane__toggle {
	display: none;
}

.split-pane__body {
	height: 100%;
}

@media (max-width: 831px) {
	.split-pane__toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		min-height: 3rem;
		padding: 0 1.25rem;
		border: 0;
		background: var(--colors-academy-ground);
		color: var(--colors-academy-text);
		font-weight: 700;
		cursor: pointer;
	}

	.split-pane__body {
		display: none;
		height: auto;
		max-height: 50dvh;
		overflow: auto;
	}

	.split-pane__body--open {
		display: block;
	}
}
</style>
