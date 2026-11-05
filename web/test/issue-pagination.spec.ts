import { describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";
import { createApi } from "../src/api/client.ts";
import { createHttp, type FetchLike } from "../src/api/http.ts";
import { DEMO_CATALOG } from "../src/api/mock/demo.ts";
import { REPO_ID } from "../src/api/mock/fixtures.ts";
import { createMockFetch, createMockState } from "../src/api/mock/server.ts";
import { createSession } from "../src/auth/session.ts";
import {
	createForgeStore,
	FORGE,
	type Issue,
} from "../src/forge/data/index.ts";
import GroupOverview from "../src/forge/GroupOverview.vue";
import IssueList from "../src/forge/IssueList.vue";
import LeafOverview from "../src/forge/LeafOverview.vue";
import { SESSION } from "../src/app/context.ts";
import { createAppRouter } from "../src/router/index.ts";
import { click, findAll, flush, mount, text } from "./support/renderer.ts";

const REPO = "acme/platform/router";
const PROJECT = `${REPO}:api`;
const issue = (number: number, state: Issue["state"]): Issue => ({
	number,
	title: state === "open" ? "An older open issue" : `Closed issue ${number}`,
	project: "services/api",
	state,
	author: { kind: "user", id: "u_01k6g000000000000000000001" },
	createdAt: number,
	updatedAt: number,
	closedAt: state === "closed" ? number : null,
});

const fixture = async (
	issues: Issue[],
	wrap?: (fetch: FetchLike) => FetchLike,
) => {
	const options = { demoIssues: true, catalog: DEMO_CATALOG };
	const state = createMockState(options);
	state.issues[REPO_ID] = issues;
	const inner = createMockFetch(options, state);
	const api = createApi(createHttp(wrap ? wrap(inner) : inner));
	const session = createSession(api);
	await session.load();
	const store = createForgeStore(api, session);
	await store.reach(PROJECT);
	await store.loadEverything();
	const router = createAppRouter({ history: createMemoryHistory() });
	await router.push("/");
	await router.isReady();
	return { session, store, router };
};

const closedBeforeOpen = () => [
	issue(1, "open"),
	...Array.from({ length: 100 }, (_, i) => issue(i + 2, "closed")),
];

describe("issue lists with more than one page", () => {
	it("loads the project overview independently of the repo-wide 100 newest issues", async () => {
		const { store, router } = await fixture(closedBeforeOpen());
		const node = store.nodeAt(PROJECT)!;
		const repo = store.nodeAt(REPO)!;
		expect(store.openCount(node)).toBeUndefined();
		const app = mount(LeafOverview, {
			props: { node, repo, scope: PROJECT },
			provide: [[FORGE, store]],
			plugins: [router],
		});
		await flush();
		expect(text(app.root)).toContain("An older open issue");
		expect(store.openCount(node)).toBe(1);
		app.unmount();
	});

	it("queries open issues before showing the empty state", async () => {
		const { store, router } = await fixture(closedBeforeOpen());
		const app = mount(IssueList, {
			props: { node: store.nodeAt(REPO)!, scope: REPO },
			provide: [[FORGE, store]],
			plugins: [router],
		});
		await flush();
		expect(text(app.root)).toContain("An older open issue");
		expect(text(app.root)).not.toContain("No open issues here.");
		expect(store.issueState(REPO, "open")).toMatchObject({
			status: "ready",
			list: { state: "open", open: 1, closed: 100 },
		});
		const closedInput = findAll(
			app.root,
			(el) => el.tag === "input" && el.value === "closed",
		)[0]!;
		closedInput.checked = true;
		click(closedInput);
		await flush();
		expect(text(app.root)).toContain("Closed issue 101");
		expect(store.issueState(REPO, "closed")).toMatchObject({
			status: "ready",
			list: { state: "closed", open: 1, closed: 100 },
		});
		app.unmount();
	});

	it("keeps the selector usable after the other state fails", async () => {
		const { store, router, session } = await fixture(
			closedBeforeOpen(),
			(inner) => (path, init) => {
				const body = JSON.parse(String(init?.body ?? "{}")) as {
					args?: { state?: string };
				};
				if (path.endsWith("/tools/list") && body.args?.state === "closed") {
					return Promise.resolve(
						Response.json({
							error: "unavailable",
							message: "Closed list unavailable",
						}, { status: 503 }),
					);
				}
				return inner(path, init);
			},
		);
		const app = mount(IssueList, {
			props: { node: store.nodeAt(REPO)!, scope: REPO },
			provide: [[FORGE, store], [SESSION, session]],
			plugins: [router],
		});
		await flush();
		const choose = async (value: string) => {
			const input = findAll(
				app.root,
				(el) => el.tag === "input" && el.value === value,
			)[0]!;
			input.checked = true;
			click(input);
			await flush();
		};
		await choose("closed");
		expect(text(app.root)).toContain("Closed list unavailable");
		await choose("open");
		expect(text(app.root)).toContain("An older open issue");
		app.unmount();
	});

	it("reports when a state-specific list is cut off", async () => {
		const { store, router } = await fixture(
			Array.from({ length: 101 }, (_, i) => issue(i + 1, "open")),
		);
		const app = mount(IssueList, {
			props: { node: store.nodeAt(PROJECT)!, scope: PROJECT },
			provide: [[FORGE, store]],
			plugins: [router],
		});
		await flush();
		expect(text(app.root)).toContain("Showing the newest 100.");
		app.unmount();
	});

	it("refreshes both state-specific lists after closing an issue", async () => {
		const { store } = await fixture(closedBeforeOpen());
		await Promise.all([
			store.ensureIssueState(PROJECT, "open"),
			store.ensureIssueState(PROJECT, "closed"),
		]);
		await store.setIssueState(PROJECT, 1, "close");
		expect(store.issueState(PROJECT, "open")).toMatchObject({
			status: "ready",
			list: { state: "open", open: 0, closed: 101 },
		});
		expect(store.issueState(PROJECT, "closed")).toMatchObject({
			status: "ready",
			list: { state: "closed", open: 0, closed: 101 },
		});
		expect(store.openCount(store.nodeAt(PROJECT)!)).toBe(0);
	});

	it("refreshes after an in-flight pre-mutation snapshot, coalescing queued reads", async () => {
		let release: (() => void) | undefined;
		let openReads = 0;
		let closeSeen = false;
		const { store } = await fixture(
			closedBeforeOpen(),
			(inner) => (path, init) => {
				const body = JSON.parse(String(init?.body ?? "{}")) as {
					args?: { state?: string };
					project?: string;
				};
				if (path.endsWith("/tools/close")) closeSeen = true;
				if (
					path.endsWith("/tools/list") && body.args?.state === "open" &&
					body.project === "api"
				) {
					openReads += 1;
					if (openReads === 1) {
						const snapshot = inner(path, init);
						return new Promise<Response>((resolve) => {
							release = () => void snapshot.then(resolve);
						});
					}
				}
				return inner(path, init);
			},
		);
		const initial = store.ensureIssueState(PROJECT, "open");
		await vi.waitFor(() => expect(release).toBeDefined());
		const mutation = store.setIssueState(PROJECT, 1, "close");
		await vi.waitFor(() => expect(closeSeen).toBe(true));
		const first = store.ensureIssueState(PROJECT, "open", true);
		const second = store.ensureIssueState(PROJECT, "open", true);
		expect(first).toBe(second);
		release!();
		await Promise.all([initial, mutation, first, second]);
		expect(openReads).toBe(2);
		expect(store.issueState(PROJECT, "open")).toMatchObject({
			status: "ready",
			list: { open: 0, issues: [] },
		});
	});

	it("marks group lists and overview as incomplete instead of claiming no open issues", async () => {
		const { store, router, session } = await fixture(closedBeforeOpen());
		const node = store.state.tree;
		const list = mount(IssueList, {
			props: { node, scope: "" },
			provide: [[FORGE, store]],
			plugins: [router],
		});
		expect(text(list.root)).toContain("No open issues among those shown.");
		expect(text(list.root)).toContain("older issues may be omitted");
		list.unmount();
		const overview = mount(GroupOverview, {
			props: { node, scope: "" },
			provide: [[FORGE, store], [SESSION, session]],
			plugins: [router],
		});
		expect(text(overview.root)).toContain("No open issues among those shown.");
		expect(text(overview.root)).toContain("older issues may be omitted");
		overview.unmount();
	});

	it("shows a loading state until subtree issue reads settle", async () => {
		const options = { demoIssues: true, catalog: DEMO_CATALOG };
		const inner = createMockFetch(options);
		let release: (() => void) | undefined;
		const fetch: FetchLike = (path, init) => {
			if (path === "/-/api/nodes?parent=acme" && !release) {
				const response = inner(path, init);
				return new Promise<Response>((resolve) => {
					release = () => void response.then(resolve);
				});
			}
			return inner(path, init);
		};
		const api = createApi(createHttp(fetch));
		const session = createSession(api);
		await session.load();
		const store = createForgeStore(api, session);
		const load = store.loadEverything();
		await vi.waitFor(() => expect(release).toBeDefined());
		const router = createAppRouter({ history: createMemoryHistory() });
		await router.push("/");
		await router.isReady();
		const node = store.state.tree;
		const list = mount(IssueList, {
			props: { node, scope: "" },
			provide: [[FORGE, store]],
			plugins: [router],
		});
		const overview = mount(GroupOverview, {
			props: { node, scope: "" },
			provide: [[FORGE, store], [SESSION, session]],
			plugins: [router],
		});
		expect(text(list.root)).toContain("Loading issues…");
		expect(text(overview.root)).toContain("Loading issues…");
		expect(text(list.root)).not.toContain("No open issues here.");
		expect(text(overview.root)).not.toContain("No open issues here.");
		release!();
		await load;
		await flush();
		expect(text(list.root)).not.toContain("Loading issues…");
		expect(text(overview.root)).toContain("Add rate limits to the public API");
		list.unmount();
		overview.unmount();
	});

	it("marks an unreadable group as partial instead of showing an empty total", async () => {
		const { store, router, session } = await fixture(
			closedBeforeOpen(),
			(inner) => (path, init) => {
				if (path.endsWith("/tools/list")) {
					return Promise.resolve(
						Response.json({
							error: "unavailable",
							message: "Issue service unavailable",
						}, { status: 503 }),
					);
				}
				return inner(path, init);
			},
		);
		const node = store.state.tree;
		const list = mount(IssueList, {
			props: { node, scope: "" },
			provide: [[FORGE, store]],
			plugins: [router],
		});
		expect(text(list.root)).toContain("No open issues among those shown.");
		expect(text(list.root)).toContain("Some issues could not be loaded.");
		expect(text(list.root)).not.toContain("Open 0");
		list.unmount();
		const overview = mount(GroupOverview, {
			props: { node, scope: "" },
			provide: [[FORGE, store], [SESSION, session]],
			plugins: [router],
		});
		expect(text(overview.root)).toContain("Some issues could not be loaded.");
		expect(text(overview.root)).not.toContain("No open issues here.");
		overview.unmount();
	});
});
