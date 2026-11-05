// Where the SPA renders each catalogue slot: the page
// components that mount a `SlotOutlet` for it. Slots no page renders are
// listed with the reason, never silently missing. `test/slot-hosts.spec.ts`
// checks this table against the catalogue and the components; the slot
// conformance workers test renders every hosted contribution through the
// real routes (src/kernel/exthost/api/slot-conformance.workers.test.ts).

import type { SlotId } from "@tartan/contract/slots.ts";

export const SLOT_HOSTS: Readonly<Partial<Record<SlotId, readonly string[]>>> =
	{
		"node.tab": ["views/node/SlotTabView.vue"],
		"repo.tab": ["views/node/SlotTabView.vue"],
		"repo.sidebar": ["components/RepoContent.vue"],
		"file.banner": ["views/repo/RepoFileView.vue"],
	};

/** Catalogue slots no SPA page renders a document for, and why. */
export const SLOTS_NOT_RENDERED: Readonly<Partial<Record<SlotId, string>>> = {
	"nav.global":
		"static: a nav entry, no document; no forge-level view lists it yet (`/-/api/view` needs a node path)",
	"repo.header.action":
		"static+action: RepoContent posts it as a button (`slots/actions.ts`), never rendered",
	"node.section": "not part of the forge overview",
	"blame.annotation": "not part of the forge UI",
	"lane.badge": "not part of the forge UI",
	"lane.sidebar": "not part of the forge UI",
	"work.panel": "not part of the forge UI",
	"work.sidebar": "not part of the forge UI",
	"change.tab": "not part of the forge UI",
	"change.panel": "not part of the forge UI",
	"change.sidebar": "not part of the forge UI",
	"change.gate": "not part of the forge UI",
	"hud.metric": "not part of the forge UI",
	"home.section": "not part of the forge UI",
	"settings.page":
		"rendered by the admin installation page from contributes.settings",
	"agent.context": "markdown for agents (context@1), not a page slot",
};

/**
 * Kernel components a page renders beside its slots: kernel acts and facts,
 * never an extension's contribution, so they are not in the slot catalogue.
 * `test/slot-hosts.spec.ts` checks that each page mounts its component.
 */
export const KERNEL_HOST_COMPONENTS: readonly {
	readonly component: string;
	readonly page: string;
	readonly beside: SlotId;
	readonly why: string;
}[] = [];
