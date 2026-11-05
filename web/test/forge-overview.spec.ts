import { describe, expect, it } from "vitest";
import { createMemoryHistory } from "vue-router";
import { reactive } from "vue";
import { createApi } from "../src/api/client.ts";
import { createHttp } from "../src/api/http.ts";
import { createMockFetch } from "../src/api/mock/server.ts";
import { SESSION } from "../src/app/context.ts";
import { createSession } from "../src/auth/session.ts";
import {
	createForgeStore,
	FORGE,
	type ForgeNode,
} from "../src/forge/data/index.ts";
import GroupOverview from "../src/forge/GroupOverview.vue";
import NewNode from "../src/forge/NewNode.vue";
import { createAppRouter } from "../src/router/index.ts";
import { recordingFetch } from "./support/app.ts";
import {
	byAttr,
	byTag,
	byText,
	click,
	findAll,
	flush,
	mount,
	submit,
	text,
	type,
} from "./support/renderer.ts";

const group = (name: string, children: ForgeNode[] = []): ForgeNode => ({
	name,
	kind: "group",
	addr: name,
	id: name,
	description: "",
	children,
	loaded: true,
	deps: [],
	dependents: [],
});

describe("new forge nodes", () => {
	for (const kind of ["group", "repo"] as const) {
		it(`creates a ${kind} as private by default`, async () => {
			const recorder = recordingFetch(createMockFetch());
			const api = createApi(createHttp(recorder.fetch));
			const session = createSession(api);
			const store = createForgeStore(api, session);
			const router = createAppRouter({ history: createMemoryHistory() });
			await router.push("/");
			await router.isReady();
			const app = mount(NewNode, {
				props: { node: group("acme"), kind },
				provide: [[FORGE, store]],
				plugins: [router],
			});
			type(byAttr(app.root, "id", "new-name")[0]!, "new-thing");
			await flush();
			submit(byTag(app.root, "form")[0]!);
			await flush();
			const path = kind === "group" ? "/-/api/nodes" : "/-/api/nodes/repos";
			expect(
				recorder.calls.find((call) =>
					call.method === "POST" && call.path === path
				)?.body,
			)
				.toMatchObject({
					parent: "acme",
					slug: "new-thing",
					visibility: "private",
				});
			app.unmount();
		});
	}

	it("allows an explicit public choice", async () => {
		const recorder = recordingFetch(createMockFetch());
		const api = createApi(createHttp(recorder.fetch));
		const store = createForgeStore(api, createSession(api));
		const router = createAppRouter({ history: createMemoryHistory() });
		await router.push("/");
		await router.isReady();
		const app = mount(NewNode, {
			props: { node: group("acme"), kind: "repo" },
			provide: [[FORGE, store]],
			plugins: [router],
		});
		type(byAttr(app.root, "id", "new-name")[0]!, "public-repo");
		const publicChoice = findAll(
			app.root,
			(el) => el.tag === "input" && el.value === "public",
		)[0]!;
		publicChoice.checked = true;
		click(publicChoice);
		await flush();
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(
			recorder.calls.find((call) =>
				call.method === "POST" && call.path === "/-/api/nodes/repos"
			)?.body,
		)
			.toMatchObject({ slug: "public-repo", visibility: "public" });
		app.unmount();
	});
});

describe("forge group overview", () => {
	it("hides project and repo totals until hierarchy reads succeed", async () => {
		const api = createApi(createHttp(createMockFetch()));
		const session = createSession(api);
		const store = createForgeStore(api, session);
		const router = createAppRouter({ history: createMemoryHistory() });
		await router.push("/");
		await router.isReady();
		const node = reactive(group("acme", [{
			...group("router"),
			kind: "repo",
			addr: "acme/router",
			loaded: false,
		}]));
		const app = mount(GroupOverview, {
			props: { node, scope: "acme" },
			provide: [[SESSION, session], [FORGE, store]],
			plugins: [router],
		});
		expect(byAttr(app.root, "data-stat", "projects")).toEqual([]);
		expect(byAttr(app.root, "data-stat", "repositories")).toEqual([]);
		node.children[0]!.loaded = true;
		await flush();
		expect(byAttr(app.root, "data-stat", "projects")).toHaveLength(1);
		expect(byAttr(app.root, "data-stat", "repositories")).toHaveLength(1);
		expect(text(byAttr(app.root, "data-stat", "projects")[0]!)).toBe(
			"1Project",
		);
		expect(text(byAttr(app.root, "data-stat", "repositories")[0]!)).toBe(
			"1Repo",
		);
		node.loadError = "refresh failed";
		await flush();
		expect(byAttr(app.root, "data-stat", "projects")).toEqual([]);
		expect(byAttr(app.root, "data-stat", "repositories")).toEqual([]);
		delete node.loadError;
		node.children[0]!.loadError = "project scan failed";
		await flush();
		expect(byAttr(app.root, "data-stat", "projects")).toEqual([]);
		expect(byAttr(app.root, "data-stat", "repositories")).toEqual([]);
		app.unmount();
	});

	it("keeps long namespace lists compact and lets viewers expand and collapse them", async () => {
		const api = createApi(createHttp(createMockFetch()));
		const session = createSession(api);
		const store = createForgeStore(api, session);
		const router = createAppRouter({ history: createMemoryHistory() });
		await router.push("/");
		await router.isReady();
		const node = group(
			"acme",
			Array.from({ length: 10 }, (_, i) => group(`team-${i}`)),
		);
		const app = mount(GroupOverview, {
			props: { node, scope: "acme" },
			provide: [[SESSION, session], [FORGE, store]],
			plugins: [router],
		});

		const button = byText(app.root, "button", "Show all 10")!;
		expect(button.attrs["aria-expanded"]).toBe("false");
		expect(byText(app.root, "a", "team-9")).toBeNull();
		click(button);
		await flush();
		expect(button.attrs["aria-expanded"]).toBe("true");
		expect(byText(app.root, "a", "team-9")).not.toBeNull();
		click(button);
		await flush();
		expect(button.attrs["aria-expanded"]).toBe("false");
		expect(byText(app.root, "a", "team-9")).toBeNull();
		app.unmount();
	});
});
