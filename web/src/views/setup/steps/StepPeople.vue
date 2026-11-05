<script setup lang="ts">
// Post-claim step (optional): invite links for other people.
import InviteForm from "../../../components/InviteForm.vue";

const emit = defineEmits<{ done: [] }>();
</script>

<template>
	<div class="tt-stack">
		<section class="tt-stack" aria-labelledby="invites-title">
			<h3 id="invites-title" class="people-title">Invite people</h3>
			<InviteForm />
		</section>
		<div class="tt-row">
			<button type="button" class="tt-button tt-button--primary" @click="emit('done')">Continue</button>
		</div>
	</div>
</template>

<style scoped>
.people-title {
	font-size: var(--tt-text-md);
}
</style>
