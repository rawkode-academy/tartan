// A small repository event log for the mock forge's activity page.
import type { Envelope } from "@tartan/contract/events.ts";
import { MOCK_NOW, mockUlid, OWNER_ID, REPO_ID, SHAS } from "./fixtures.ts";

export const EVENTS: readonly Envelope[] = [
	{ before: SHAS.genesis, after: SHAS.c1 },
	{ before: SHAS.c1, after: SHAS.c2 },
	{ before: SHAS.c2, after: SHAS.c3 },
].map(({ before, after }, i) => ({
	id: mockUlid(5001 + i),
	seq: i + 1,
	stream: `repo:${REPO_ID}`,
	type: "push.accepted",
	v: 1,
	source: { kind: "kernel" },
	actor: { kind: "user", id: OWNER_ID },
	node: REPO_ID,
	repo: REPO_ID,
	depth: 0,
	shadow: false,
	at: MOCK_NOW - (3 - i) * 60_000,
	data: {
		pushId: `mock-push-${i + 1}`,
		target: "repo",
		ref: "refs/heads/main",
		before,
		after,
		via: "gateway",
	},
}));

export const EVENTS_HEAD = EVENTS.length;
