<script setup lang="ts">
// Step 2: check the products needed to run the forge.
import { computed, onMounted, ref, shallowRef } from "vue";
import type { EnvironmentCheck } from "@tartan/contract/api.ts";
import { useApi } from "../../../app/context.ts";
import { errorMessage } from "../../../api/http.ts";
import CheckList from "../../../components/CheckList.vue";
import { requiredChecksPass } from "../../../setup/checks.ts";

const emit = defineEmits<{ done: [] }>();

const api = useApi();
const checks = shallowRef<readonly EnvironmentCheck[]>([]);
const running = ref(false);
const error = ref<string | null>(null);

const run = async (): Promise<void> => {
	running.value = true;
	error.value = null;
	try {
		checks.value = (await api.setup.checks()).checks;
	} catch (e) {
		error.value = errorMessage(e);
	} finally {
		running.value = false;
	}
};

onMounted(() => void run());
const canContinue = computed(() =>
	!running.value && error.value === null && requiredChecksPass(checks.value)
);
</script>

<template>
	<div class="tt-stack">
		<p class="tt-muted">Tartan checks the Cloudflare products it uses. Optional ones only limit features.</p>
		<p v-if="running && checks.length === 0" aria-live="polite">Running checks…</p>
		<CheckList v-if="checks.length > 0" :checks="checks" />
		<p v-if="error" class="chip chip--danger" role="alert">{{ error }}</p>
		<div class="tt-row">
			<button type="button" class="tt-button tt-button--primary" :disabled="!canContinue" @click="emit('done')">Continue</button>
			<button type="button" class="tt-button" :disabled="running" @click="run">Run checks again</button>
		</div>
	</div>
</template>
