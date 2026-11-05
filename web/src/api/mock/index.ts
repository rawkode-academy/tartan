// Mock services for `VITE_TARTAN_MOCK=1` builds (local demos, screenshots,
// Lighthouse). The mock forge's state survives page loads in sessionStorage,
// so the setup wizard can be walked end to end:
// - `?setup=fresh|unlocked|idp|done` (re)starts the mock forge in that state;
// - a full-page visit to `/-/auth/login` (the claim, "Sign in") signs in as
//   the owner — the mock has no IdP — and returns to `return_to`.

import { sameOriginPath } from "../../ui/links.ts";
import type { FetchLike } from "../http.ts";
import {
	MOCK_NOW,
	OWNER_VIEWER,
	removeRetiredStressNodes,
} from "./fixtures.ts";
import { DEMO_CATALOG, DEMO_ISSUES_INSTALLATION, demoIssues } from "./demo.ts";
import { createMockConnect } from "./live.ts";
import {
	createMockFetch,
	createMockState,
	type MockOptions,
} from "./server.ts";

const STORAGE_KEY = "tartan.mock.state.v2";

type MockLocation = Pick<Location, "pathname" | "search">;
type MockHistory = Pick<History, "replaceState">;

export const mockServices = (location: MockLocation, history: MockHistory) => {
	const params = new URLSearchParams(location.search);
	const setup = params.get("setup");
	const options: MockOptions = {
		setupState: setup === "fresh" || setup === "unlocked" || setup === "idp"
			? setup
			: "done",
		latencyMs: 120,
		timeShiftMs: Date.now() - MOCK_NOW,
		catalog: DEMO_CATALOG,
		demoIssues: true,
	};
	let stored: string | null = null;
	try {
		stored = setup === null
			? globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? null
			: null;
	} catch {
		stored = null;
	}
	const state = stored
		? JSON.parse(stored) as ReturnType<typeof createMockState>
		: createMockState(options);
	// Older stored mock sessions serialized a Set as an object.
	if (!Array.isArray(state.breakerReset)) state.breakerReset = [];
	state.nodes = removeRetiredStressNodes(state.nodes);
	// Preserve the existing mock hierarchy and setup while adding the demo once.
	if (!state.demoInitialized) {
		state.issues ??= demoIssues(Date.now());
		const demoPath = DEMO_ISSUES_INSTALLATION.nodePath;
		if (
			!state.installations.some((item) =>
				item.extId === DEMO_ISSUES_INSTALLATION.extId &&
				(item.nodePath === demoPath ||
					demoPath.startsWith(`${item.nodePath}/`) ||
					item.nodePath.startsWith(`${demoPath}/`))
			)
		) {
			state.installations.push({ ...DEMO_ISSUES_INSTALLATION });
		}
		state.demoInitialized = true;
	}
	state.events = state.events.filter((event) =>
		event.type === "push.accepted" && typeof event.data === "object" &&
		event.data !== null && "target" in event.data &&
		event.data.target === "repo"
	);
	const save = (): void => {
		try {
			globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
		} catch {
			// Storage blocked: the mock forge resets on the next page load.
		}
	};

	if (location.pathname === "/-/auth/login") {
		if (state.setup.state === "idp") {
			state.setup = { ...state.setup, state: "done" };
			state.setupSession = false;
		}
		state.viewer = OWNER_VIEWER;
		const returnTo = sameOriginPath(params.get("return_to")) ?? "/";
		history.replaceState(null, "", returnTo);
	}
	save();

	const inner = createMockFetch(options, state);
	const fetch: FetchLike = async (input, init) => {
		const response = await inner(input, init);
		save();
		return response;
	};
	return { fetch, connect: createMockConnect() };
};
