// In-browser mock of the kernel API over the fixtures (a `fetch` stand-in),
// with just enough state to walk setup, browse repositories and install
// extensions. Loaded only by `VITE_TARTAN_MOCK=1` builds
// and tests; production bundles never include it (dynamic import in main.ts).

import type {
	ActionRequest,
	InstallationDto,
	InstallationInForce,
	InstallRequest,
	MeResponse,
	NodeDto,
	PermissionSheet,
	SetupStateDto,
	ViewerDto,
} from "@tartan/contract/api.ts";
import type { Envelope } from "@tartan/contract/events.ts";
import type { Issue } from "../../forge/data/index.ts";
import { checkSlotCtxHint, slotCtxRefusal } from "@tartan/contract/slot-ctx.ts";
import { isKnownSlot } from "@tartan/contract/slots.ts";
import type { FetchLike } from "../http.ts";
import { EVENTS } from "./events.ts";
import { EMPTY_CATALOG, type MockCatalog } from "./catalog.ts";
import { DEMO_PROJECTS, demoIssues } from "./demo.ts";
import { handleIssuesTool } from "./issues.ts";
import {
	ANONYMOUS_VIEWER,
	BINARY_FILES,
	commitResponse,
	COMMITS,
	DEFAULT_BRANCH,
	FILE_DIFFS,
	FILES,
	FORGE_SETTINGS,
	HEALTH,
	MOCK_NOW,
	mockUlid,
	NODES,
	OWNER_ID,
	OWNER_VIEWER,
	REPO_ID,
	SETUP_CHECKS,
	SHAS,
	treeEntries,
	viewFor,
} from "./fixtures.ts";

export type MockOptions = {
	/** Start the forge in this setup state (default `done`). */
	readonly setupState?: SetupStateDto["state"];
	/**
	 * Whether the browser holds a setup session (WP2's `__Host-tartan-setup`
	 * cookie). Default: yes for `unlocked` and `idp`, no otherwise.
	 */
	readonly setupSession?: boolean;
	/** True when the deploy set `TARTAN_SETUP_TOKEN` (no claim code is logged). */
	readonly setupTokenDeployed?: boolean;
	readonly signedIn?: boolean;
	/**
	 * Moves fixture event times (fixed at `MOCK_NOW` for tests) by this much.
	 */
	readonly timeShiftMs?: number;
	/** Artificial latency per request (ms). */
	readonly latencyMs?: number;
	/** The extensions in the registry and installed (default: none). */
	readonly catalog?: MockCatalog;
	/** Populate the local preview with the Issues extension and sample data. */
	readonly demoIssues?: boolean;
};

type MockState = {
	setup: SetupStateDto;
	setupSession: boolean;
	setupTokenDeployed: boolean;
	/** A claim code is in the (mock) logs and unused. */
	codeLogged: boolean;
	viewer: ViewerDto;
	events: Envelope[];
	issues: Record<string, Issue[]>;
	demoInitialized: boolean;
	installations: InstallationDto[];
	nodes: NodeDto[];
	seq: number;
	/** Installations whose circuit breaker an Owner reset (mock). */
	breakerReset: string[];
};

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

const error = (
	status: number,
	code: string,
	message: string,
	reason?: string,
): Response =>
	json({ error: code, ...(reason ? { reason } : {}), message }, status);

const notFound = (what: string): Response =>
	error(404, "not_found", `${what} not found`);

const readBody = (init?: RequestInit): Record<string, unknown> => {
	if (!init?.body || typeof init.body !== "string") return {};
	try {
		const parsed = JSON.parse(init.body) as unknown;
		return typeof parsed === "object" && parsed !== null
			? parsed as Record<string, unknown>
			: {};
	} catch {
		return {};
	}
};

const decodeCtx = (value: string | null): unknown => {
	if (!value) return {};
	try {
		const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
};

/** WP2's `MeResponse` for the mock viewer. */
export const meOf = (state: MockState): MeResponse => {
	const p = state.viewer.principal;
	if (!p) return { principal: null };
	return {
		principal: {
			id: p.id,
			kind: p.kind,
			handle: p.handle,
			display: p.display,
			avatar: `/-/avatar/${p.id}`,
		},
		auth: {
			via: "session",
			isAdmin: state.viewer.isAdmin,
			scopes: [],
			nodeId: null,
			laneId: null,
			maxRole: 50,
		},
		forge: {
			...(state.setup.forgeName ? { name: state.setup.forgeName } : {}),
			rootKeyFallback: state.setup.rootKeyFallback,
			devTools: true,
		},
	};
};

export const createMockState = (options: MockOptions = {}): MockState => {
	const phase = options.setupState ?? "done";
	const done = phase === "done";
	return {
		setup: {
			state: phase,
			forgeName: done ? FORGE_SETTINGS.forgeName : undefined,
			canonicalOrigin: done
				? FORGE_SETTINGS.canonicalOrigin ?? undefined
				: undefined,
			rootKeyFallback: true,
		},
		setupSession: options.setupSession ??
			(phase === "unlocked" || phase === "idp"),
		setupTokenDeployed: options.setupTokenDeployed ?? false,
		codeLogged: false,
		viewer: (options.signedIn ?? done) ? OWNER_VIEWER : ANONYMOUS_VIEWER,
		events: EVENTS.map((e) => ({
			...e,
			at: e.at + (options.timeShiftMs ?? 0),
		})),
		issues: options.demoIssues
			? demoIssues(MOCK_NOW + (options.timeShiftMs ?? 0))
			: {},
		demoInitialized: options.demoIssues ?? false,
		installations: [...(options.catalog ?? EMPTY_CATALOG).installations],
		nodes: [...NODES],
		seq: 1000,
		breakerReset: [],
	};
};

const permissionSheet = (
	request: InstallRequest,
	catalog: MockCatalog,
	installations: readonly InstallationDto[],
): PermissionSheet => {
	const pkg = catalog.packages.find((p) => p.extId === request.extId);
	const perms = pkg?.manifest.permissions;
	const lines = [
		perms?.repo === "read"
			? "Read repository content under this node"
			: "No repository access",
		...(perms?.lanes ?? []).map((op) => `Lanes: ${op}`),
		...(perms?.land ?? []).map((ref) => `Land to ${ref}`),
		...(perms?.runs ?? []).map((op) => `CI runs: ${op}`),
		...(perms?.notify ? ["Send notices to people and agents"] : []),
		...(perms?.notes ? ["Write why notes"] : []),
	];
	// The installation in force above the node that provides an interface
	// this package provides too (the nearest one).
	const provided = pkg?.manifest.provides ?? [];
	const replaced = provided.flatMap((iface) =>
		installations
			.filter((i) =>
				i.mode !== "disabled" &&
				(request.node === i.nodePath ||
					request.node.startsWith(`${i.nodePath}/`)) &&
				(catalog.packages.find((p) => p.extId === i.extId)?.manifest
					.provides ?? []).includes(iface)
			)
			.sort((x, y) => y.nodePath.length - x.nodePath.length)
			.slice(0, 1)
			.map((i) => ({ iface, installation: i }))
	)[0];
	return {
		lines,
		needsOwner: (request.backgroundRole ?? 20) > 20 || request.locked === true,
		warnings: pkg?.runtime === "wasm" &&
				(pkg.manifest.gates ?? []).some((gate) => gate.point === "ref.advance")
			? ["Runs a WASM gate; it can veto advances when in enforce mode."]
			: [],
		...(replaced
			? {
				replaces: {
					iface: replaced.iface,
					installation: replaced.installation.id,
					ext: replaced.installation.extId,
					node: replaced.installation.nodePath,
				},
			}
			: {}),
	};
};

/** A `fetch` that answers kernel API paths from fixtures and mock state. */
export const createMockFetch = (
	options: MockOptions = {},
	state: MockState = createMockState(options),
): FetchLike => {
	const catalog = options.catalog ?? EMPTY_CATALOG;
	const packages = catalog.packages;
	const sheet = (request: InstallRequest): PermissionSheet =>
		permissionSheet(request, catalog, state.installations);
	const handle = (input: string, init?: RequestInit): Response => {
		const url = new URL(input, "https://forge.test");
		const path = url.pathname;
		const method = (init?.method ?? "GET").toUpperCase();
		const q = (key: string): string => url.searchParams.get(key) ?? "";
		const signedIn = state.viewer.principal !== undefined;

		// Health and setup.
		if (path === "/-/health") {
			return json({ ...HEALTH, setupState: state.setup.state });
		}
		if (path === "/-/api/me") {
			// Like WP2: the API is gated (503) until the forge is claimed.
			return state.setup.state === "done"
				? json(meOf(state))
				: error(503, "setup_required", "Finish setting up the forge first.");
		}
		if (path === "/-/auth/logout" && method === "POST") {
			state.viewer = ANONYMOUS_VIEWER;
			return json({ ok: true });
		}
		if (path.startsWith("/-/setup/") && method === "POST") {
			const body = readBody(init);
			const needsSession = ![
				"/-/setup/status",
				"/-/setup/code",
				"/-/setup/unlock",
			]
				.includes(path);
			if (needsSession && !state.setupSession) {
				return error(
					401,
					"unauthenticated",
					"a setup session is required: unlock first",
				);
			}
			switch (path) {
				case "/-/setup/status":
					return json({
						...state.setup,
						session: state.setupSession
							? {
								purpose: state.setup.state === "done" ? "recover" : "bootstrap",
								expiresAt: Date.now() + 30 * 60_000,
							}
							: null,
					});
				case "/-/setup/code": {
					const created = !state.setupTokenDeployed &&
						state.setup.state !== "done" && !state.codeLogged;
					if (created) state.codeLogged = true;
					return json({ created });
				}
				case "/-/setup/unlock": {
					const token = typeof body["token"] === "string" ? body["token"] : "";
					if (token.length < 16 || token.includes("bad")) {
						return error(403, "denied", "invalid setup token or code", "setup");
					}
					if (state.setup.state === "done") {
						return error(
							403,
							"denied",
							"setup is complete; recovery needs a new setup token",
							"setup",
						);
					}
					if (state.setup.state === "fresh") {
						state.setup = { ...state.setup, state: "unlocked" };
					}
					state.setupSession = true;
					state.codeLogged = false;
					return json({
						ok: true,
						purpose: "bootstrap",
						expiresAt: Date.now() + 30 * 60_000,
					});
				}
				case "/-/setup/checks":
					return json({ checks: SETUP_CHECKS });
				case "/-/setup/name":
					state.setup = {
						...state.setup,
						forgeName: String(body["forgeName"] ?? ""),
						canonicalOrigin: String(body["canonicalOrigin"] ?? ""),
					};
					return json(state.setup);
				case "/-/setup/idp/register": {
					const issuer = String(body["issuer"] ?? "");
					if (!issuer.startsWith("https://id.")) {
						return error(
							503,
							"unavailable",
							"This issuer has no registration endpoint; enter a client id instead.",
						);
					}
					state.setup = { ...state.setup, state: "idp" };
					return json({ clientId: "tartan-dev-8f2c" });
				}
				case "/-/setup/idp":
					state.setup = { ...state.setup, state: "idp" };
					return json({ ok: true });
				default:
					return notFound("no such setup step");
			}
		}
		if (path === "/-/auth/login") {
			// The mock "IdP": signing in completes the claim (with a setup session).
			if (state.setup.state !== "done" && !state.setupSession) {
				return error(
					403,
					"denied",
					"unlock setup first: this sign-in needs a setup session",
				);
			}
			if (state.setup.state === "idp") {
				state.setup = { ...state.setup, state: "done" };
				state.setupSession = false;
			}
			state.viewer = OWNER_VIEWER;
			return json({ ok: true });
		}

		if (!path.startsWith("/-/api/")) return notFound(path);
		if (state.setup.state !== "done") {
			return error(503, "setup_required", "Finish setting up the forge first.");
		}

		const projectRoute = /^\/-\/api\/repos\/([^/]+)\/projects$/.exec(path);
		if (options.demoIssues && projectRoute && method === "GET") {
			const repo = state.nodes.find((n) =>
				n.id === projectRoute[1] && n.kind === "repo"
			);
			if (!repo) return notFound("repo");
			return json({
				repo: { id: repo.id, path: repo.path },
				sha: SHAS.c3,
				detector: "tartan",
				fidelity: "scan",
				projects: repo.id === REPO_ID ? DEMO_PROJECTS : [],
				layers: [],
				skipped: [],
				warnings: [],
				truncated: false,
				global: [],
			});
		}
		const issueReply = handleIssuesTool(path, method, readBody(init), state);
		if (issueReply) return issueReply;

		// Admin.
		if (path === "/-/api/admin/root-key/export" && method === "POST") {
			if (!state.setup.rootKeyFallback) {
				return error(409, "conflict", "The root key is already a secret.");
			}
			return json({
				value: "mock-root-key-0000000000000000000000000000000000000000",
			});
		}
		// Repository event log.
		if (path === "/-/api/events" && method === "GET") {
			const repoId = q("repo");
			if (!state.nodes.some((n) => n.id === repoId && n.kind === "repo")) {
				return notFound("no such repo");
			}
			const since = Number(q("since") || "0");
			const limit = Math.min(500, Math.max(1, Number(q("limit") || "100")));
			const types = q("types") ? q("types").split(",") : null;
			const matches = (type: string): boolean =>
				types === null || types.some((p) =>
					p === "*" || p === type ||
					(p.endsWith(".*") && type.startsWith(p.slice(0, -1)))
				);
			const events = state.events
				.filter((e) => e.repo === repoId && e.seq > since && matches(e.type))
				.slice(0, limit);
			return json({
				repo: repoId,
				events,
				head: state.events.reduce(
					(h, e) => e.repo === repoId ? Math.max(h, e.seq) : h,
					0,
				),
			});
		}

		// Nodes.
		if (path === "/-/api/nodes" && method === "GET") {
			const parent = q("parent");
			const parentNode = parent
				? state.nodes.find((n) => n.path === parent)
				: null;
			if (parent && !parentNode) return notFound(`node ${parent}`);
			const children = state.nodes.filter((n) =>
				parentNode ? n.parentId === parentNode.id : n.parentId === null
			);
			const offset = Number(q("cursor") || "0");
			const page = children.slice(offset, offset + 20);
			return json({
				nodes: page,
				...(offset + 20 < children.length
					? { cursor: String(offset + 20) }
					: {}),
			});
		}
		if (
			(path === "/-/api/nodes" || path === "/-/api/nodes/repos") &&
			method === "POST"
		) {
			const body = readBody(init);
			const parentPath = typeof body["parent"] === "string"
				? body["parent"]
				: "";
			const parentNode = state.nodes.find((n) => n.path === parentPath) ?? null;
			const slug = String(body["slug"] ?? "");
			if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
				return error(
					400,
					"invalid",
					"Slugs use lowercase letters, digits and dashes.",
				);
			}
			const fullPath = parentNode ? `${parentNode.path}/${slug}` : slug;
			if (state.nodes.some((n) => n.path === fullPath)) {
				return error(409, "conflict", `${fullPath} already exists.`);
			}
			const created: NodeDto = {
				id: mockUlid(900 + state.nodes.length),
				parentId: parentNode?.id ?? null,
				kind: path.endsWith("/repos") ? "repo" : "group",
				slug,
				path: fullPath,
				depth: fullPath.split("/").length - 1,
				visibility: (body["visibility"] as NodeDto["visibility"]) ?? "private",
				archived: false,
				createdAt: Date.now(),
				...(path.endsWith("/repos") ? { defaultBranch: DEFAULT_BRANCH } : {}),
			};
			state.nodes.push(created);
			return json(created, 201);
		}

		// View and slots.
		if (path === "/-/api/view") {
			const view = viewFor(q("path"), q("view"), catalog);
			if (!view) return notFound(`node ${q("path")}`);
			return json({
				...view,
				viewer: state.viewer,
				node: state.nodes.find((n) => n.path === view.node.path) ?? view.node,
			});
		}
		const slot = /^\/-\/api\/slot\/([^/]+)\/([^/]+)(\/action)?$/.exec(path);
		if (slot) {
			const inst = state.installations.find((i) =>
				i.id === decodeURIComponent(slot[1] ?? "")
			);
			if (!inst) return notFound("installation");
			const slotId = decodeURIComponent(slot[2] ?? "");
			// Keys are `<ext>/<catalogue slot>/<contribution id>`; the route
			// carries only the id, unique within a manifest (WP7a).
			const found = Object.entries(catalog.docs).find(([key]) =>
				key.startsWith(`${inst.extId}/`) && key.endsWith(`/${slotId}`)
			);
			const catalogueSlot = found?.[0].split("/")[1] ?? "";
			const body = slot[3] ? readBody(init) as Partial<ActionRequest> : null;
			// The kernel's ctx rule (contract slot-ctx.ts): the strict hint shape,
			// then what this slot takes.
			const hints = body
				? body.ctx ?? {}
				: decodeCtx(url.searchParams.get("ctx"));
			if (hints === null) {
				return error(400, "invalid", "ctx is not base64url JSON");
			}
			const checked = checkSlotCtxHint(hints);
			if (!checked.ok) {
				return json({
					error: "invalid",
					message: "invalid ctx",
					details: { issues: [...checked.issues] },
				}, 400);
			}
			const refusal = isKnownSlot(catalogueSlot)
				? slotCtxRefusal(catalogueSlot, checked.hint)
				: null;
			if (refusal !== null) return error(400, "invalid", refusal);
			if (body) {
				const mirrored = catalog.act?.(inst.extId, body.action, checked.hint);
				if (mirrored) return json(mirrored);
				return json({
					v: 1,
					toast: {
						tone: "success",
						text: `${inst.extId}: ${String(body.action)} done`,
					},
					...(body.action === "move" ? { refresh: [slotId] } : {}),
				});
			}
			return json(
				found?.[1] ??
					{
						v: 1,
						root: { t: "error-chip", text: `${inst.extId}: render failed` },
					},
			);
		}

		// Browse.
		const repo = q("repo");
		const knownRepo = state.nodes.some((n) =>
			n.kind === "repo" && n.path === repo
		);
		if (
			[
				"/-/api/tree",
				"/-/api/blob",
				"/-/api/log",
				"/-/api/commit",
				"/-/api/compare",
			].includes(path) && !knownRepo
		) {
			return notFound(`repo ${repo}`);
		}
		if (path === "/-/api/tree") {
			const dir = q("path");
			const entries = treeEntries(dir);
			if (!entries) return notFound(`path ${dir}`);
			return json({
				repo,
				ref: q("ref") || DEFAULT_BRANCH,
				sha: SHAS.c3,
				path: dir,
				entries,
			});
		}
		if (path === "/-/api/blob") {
			const file = q("path");
			const text = FILES[file];
			if (text === undefined) return notFound(`file ${file}`);
			const binary = BINARY_FILES.has(file);
			return json({
				repo,
				ref: q("ref") || DEFAULT_BRANCH,
				sha: SHAS.c3,
				path: file,
				blob: SHAS.c1,
				size: binary ? 18_204 : new TextEncoder().encode(text).length,
				binary,
				...(binary ? {} : { text }),
				truncated: false,
				rawUrl: `/-/raw/${repo}/${q("ref") || DEFAULT_BRANCH}/${file}`,
			});
		}
		if (path === "/-/api/log") {
			return json({ repo, ref: q("ref") || DEFAULT_BRANCH, commits: COMMITS });
		}
		if (path === "/-/api/commit") {
			const found = commitResponse(q("sha"));
			return found ? json(found) : notFound(`commit ${q("sha")}`);
		}
		if (path === "/-/api/compare") {
			return json({
				repo,
				base: q("base"),
				head: q("head"),
				mergeBase: SHAS.c3,
				commits: COMMITS.slice(0, 1),
				files: FILE_DIFFS,
				truncated: false,
			});
		}

		if (path === "/-/api/invites" && method === "POST") {
			return json({
				inviteId: `inv_${mockUlid(950)}`,
				url: `${FORGE_SETTINGS.canonicalOrigin}/-/invite/mock-invite-code`,
				expiresAt: Date.now() + 7 * 86_400_000,
			}, 201);
		}

		// Extensions.
		if (path === "/-/api/packages") return json({ packages });
		if (path === "/-/api/installations" && method === "GET") {
			// WP7a: what is in force at `node`, inherited too; without `node`, at
			// the viewer's start node (here the mock viewer's own root).
			const at = q("node")
				? state.nodes.find((n) => n.path === q("node"))
				: state.nodes.find((n) => n.parentId === null && n.kind === "user");
			if (!at) return error(404, "not_found", `no node at ${q("node")}`);
			const inForce: InstallationInForce[] = state.installations
				.filter((i) =>
					i.mode !== "disabled" &&
					(at.path === i.nodePath || at.path.startsWith(`${i.nodePath}/`))
				)
				.flatMap((i) => {
					const pkg = packages.find((p) => p.extId === i.extId);
					return pkg
						? [{
							installation: i,
							manifest: pkg.manifest,
							depth: i.nodePath.split("/").length - 1,
						}]
						: [];
				});
			return json({
				node: at,
				installations: inForce,
				...(q("include") === "disabled"
					? {
						disabled: state.installations.filter((i) =>
							i.nodeId === at.id && i.mode === "disabled"
						),
					}
					: {}),
			});
		}
		if (path === "/-/api/installations/sheet" && method === "POST") {
			return json(sheet(readBody(init) as InstallRequest));
		}
		if (path === "/-/api/installations" && method === "POST") {
			const body = readBody(init) as InstallRequest;
			const pkg = packages.find((p) => p.extId === body.extId);
			if (!pkg) return notFound(`package ${body.extId}`);
			if (body.ensure) {
				const related = state.installations.filter((item) =>
					item.extId === body.extId &&
					(body.node === item.nodePath ||
						body.node.startsWith(`${item.nodePath}/`) ||
						item.nodePath.startsWith(`${body.node}/`))
				);
				if (
					related.length === 1 && related[0]!.mode === "enforce" &&
					related[0]!.version === body.version &&
					(body.node === related[0]!.nodePath ||
						body.node.startsWith(`${related[0]!.nodePath}/`))
				) {
					return json(related[0]);
				}
				if (related.length > 0) {
					return error(
						409,
						"conflict",
						`${body.extId} has a conflicting installation on this path`,
					);
				}
			}
			const created: InstallationDto = {
				id: `i_${mockUlid(600 + state.installations.length)}`,
				extId: body.extId,
				version: body.version,
				nodeId: state.nodes.find((n) => n.path === body.node)?.id ??
					mockUlid(11),
				nodePath: body.node,
				mode: body.mode,
				storageScope: pkg.manifest.storage.scope,
				config: body.config ?? {},
				grants: pkg.manifest.permissions,
				backgroundRole: body.backgroundRole ?? 20,
				locked: body.locked ?? false,
				backfill: body.backfill ?? "none",
				installedBy: OWNER_ID,
				installedAt: Date.now(),
			};
			state.installations.push(created);
			return json(created, 201);
		}
		const inst = /^\/-\/api\/installations\/([^/]+)(\/mode|\/breaker)?$/
			.exec(path);
		if (inst) {
			const found = state.installations.find((i) => i.id === inst[1]);
			if (!found) return notFound("installation");
			if (inst[2] === "/breaker") {
				const reset = method === "POST";
				if (reset && !state.breakerReset.includes(found.id)) {
					state.breakerReset.push(found.id);
				}
				return json({
					installation: found.id,
					scope: found.storageScope === "repo"
						? { kind: "repo", repoId: q("repo") ?? "" }
						: { kind: "node" },
					breaker: reset || state.breakerReset.includes(found.id)
						? {
							state: "closed",
							until: null,
							trips: 0,
							recentStrikes: 0,
							strikes: [],
						}
						: {
							state: "closed",
							until: null,
							trips: 0,
							recentStrikes: 1,
							strikes: [{
								seq: 1,
								at: MOCK_NOW - 60_000,
								method: "tool list",
								kind: "timeout",
							}],
						},
				});
			}
			if (inst[2] === "/mode" && method === "PUT") {
				const body = readBody(init);
				const mode = body["mode"];
				if (mode !== "enforce" && mode !== "shadow" && mode !== "disabled") {
					return error(400, "invalid", "Unknown mode.");
				}
				const updated = {
					...found,
					mode,
					modeChangedAt: Date.now(),
				} as InstallationDto;
				state.installations = state.installations.map((i) =>
					i.id === found.id ? updated : i
				);
				return json(updated);
			}
			return json(found);
		}

		if (!signedIn) return error(401, "unauthenticated", "Sign in first.");
		return notFound(path);
	};

	return async (input, init) => {
		if (options.latencyMs) {
			await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
		}
		return handle(input, init);
	};
};
