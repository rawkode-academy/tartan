// Typed client for the kernel HTTP API, built on contract DTOs.
//
// Route prefixes come from `src/router.ts` (WP0). Where a kernel handler is
// merged (setup and identity, events, views, slots and installations) the
// paths, query names and response shapes follow it.

import type {
	ActionRequest,
	ActionResponse,
	BlobResponse,
	CommitResponse,
	CompareResponse,
	EventsResponse,
	HealthResponse,
	IdpConfigRequest,
	IdpRegisterRequest,
	IdpRegisterResponse,
	InstallationDto,
	InstallationsResponse,
	InstallRequest,
	InviteCreated,
	InviteCreateRequest,
	LogResponse,
	MeResponse,
	NodeCreateRequestSchema,
	NodeDto,
	NodesResponse,
	PackagesResponse,
	PermissionSheet,
	ProjectsResponse,
	RepoCreateRequestSchema,
	SetupChecksResponse,
	SetupCodeResponse,
	SetupOkResponse,
	SetupStateDto,
	SetupStatusResponse,
	SetupUnlockResponse,
	SlotRenderResponse,
	TreeResponse,
	ViewResponse,
} from "@tartan/contract/api.ts";
import type { InstallationMode } from "@tartan/contract/common.ts";
import type { BreakerStatus } from "@tartan/contract/do/ext.ts";
import type { SlotCtxHint } from "@tartan/contract/slot-ctx.ts";
import type { z } from "zod";
import { sameOriginPath } from "../ui/links.ts";
import type { Http } from "./http.ts";
import type { RootKeyExport } from "./types.ts";

export const ENDPOINTS = {
	health: "/-/health",
	me: "/-/api/me",
	setupStatus: "/-/setup/status",
	setupCode: "/-/setup/code",
	setupUnlock: "/-/setup/unlock",
	setupChecks: "/-/setup/checks",
	setupName: "/-/setup/name",
	setupIdpRegister: "/-/setup/idp/register",
	setupIdp: "/-/setup/idp",
	login: "/-/auth/login",
	logout: "/-/auth/logout",
	rootKeyExport: "/-/api/admin/root-key/export",
	nodes: "/-/api/nodes",
	repos: "/-/api/nodes/repos",
	view: "/-/api/view",
	slot: "/-/api/slot",
	tree: "/-/api/tree",
	blob: "/-/api/blob",
	log: "/-/api/log",
	commit: "/-/api/commit",
	compare: "/-/api/compare",
	invites: "/-/api/invites",
	packages: "/-/api/packages",
	installations: "/-/api/installations",
	repoApi: "/-/api/repos",
	events: "/-/api/events",
	live: "/-/live",
} as const;

const enc = encodeURIComponent;

/** base64url of a JSON value (slot `ctx` hints). */
export const b64urlJson = (value: unknown): string => {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
		/=+$/,
		"",
	);
};

/**
 * Route-derived hints the SPA sends with slot calls (the contract's type;
 * pages build them with `slots/ctx.ts`); the kernel re-derives them.
 */
export type { SlotCtxHint };

/** `POST /-/api/nodes/repos` body (`RepoCreateRequestSchema`, WP3). */
export type RepoCreate = z.input<typeof RepoCreateRequestSchema>;

/** `POST /-/api/nodes` body (`NodeCreateRequestSchema`, WP3). */
export type GroupCreate = z.input<typeof NodeCreateRequestSchema>;

/** `GET /-/api/commit` and `/-/api/compare` options (WP3, WP8 patches). */
export type DiffQuery = {
	/** Ask for each file's unified patch (`FileDiff.patch`, `patchOmitted`). */
	readonly patch?: boolean;
	/** `/-/api/compare` only: read both sides from this lane (base and head are SHAs). */
	readonly lane?: string;
};

/** `GET /-/api/events?repo=<id>` paging and filters (WP6). */
export type EventsQuery = {
	readonly since?: number;
	readonly limit?: number;
	/** Event-type patterns (`EVENT_PATTERN_RE`), sent comma-separated. */
	readonly types?: readonly string[];
};

const csv = (values: readonly string[] | undefined): string | undefined =>
	values && values.length > 0 ? values.join(",") : undefined;

export const createApi = (http: Http) => ({
	health: () => http.get<HealthResponse>(ENDPOINTS.health),
	me: () => http.get<MeResponse>(ENDPOINTS.me),
	logout: () => http.post<unknown>(ENDPOINTS.logout),

	setup: {
		/** Any setup state; `session` is null without a valid setup cookie. */
		status: () => http.post<SetupStatusResponse>(ENDPOINTS.setupStatus),
		/** Without `TARTAN_SETUP_TOKEN`: writes a claim code to Workers Logs. */
		code: () => http.post<SetupCodeResponse>(ENDPOINTS.setupCode),
		unlock: (token: string) =>
			http.post<SetupUnlockResponse>(ENDPOINTS.setupUnlock, { token }),
		checks: () => http.post<SetupChecksResponse>(ENDPOINTS.setupChecks),
		name: (forgeName: string, canonicalOrigin: string) =>
			http.post<SetupStateDto>(ENDPOINTS.setupName, {
				forgeName,
				canonicalOrigin,
			}),
		registerIdp: (request: IdpRegisterRequest) =>
			http.post<IdpRegisterResponse>(ENDPOINTS.setupIdpRegister, request),
		configureIdp: (request: IdpConfigRequest) =>
			http.post<SetupOkResponse>(ENDPOINTS.setupIdp, request),
	},

	admin: {
		/** Button path: the generated root key, shown once to move into `TARTAN_SECRET`. */
		exportRootKey: () => http.post<RootKeyExport>(ENDPOINTS.rootKeyExport),
	},

	nodes: {
		children: (parent: string | null, cursor?: string) =>
			http.get<NodesResponse>(ENDPOINTS.nodes, {
				parent: parent ?? undefined,
				cursor,
			}),
		createGroup: (request: GroupCreate) =>
			http.post<NodeDto>(ENDPOINTS.nodes, request),
		createRepo: (request: RepoCreate) =>
			http.post<NodeDto>(ENDPOINTS.repos, request),
	},

	/** The graph at the trunk tip (`detector: null` without commits). */
	projects: (repoId: string) =>
		http.get<ProjectsResponse>(
			`${ENDPOINTS.repoApi}/${enc(repoId)}/projects`,
		),

	/**
	 * An extension's tool over the session (`projects/tools.ts`). With `project`,
	 * the kernel resolves it at the trunk tip and scopes the call to its root.
	 */
	tool: async <T>(
		repoId: string,
		extensionId: string,
		toolName: string,
		args: Readonly<Record<string, unknown>>,
		project?: string,
	): Promise<T> =>
		(await http.post<{ readonly result: T }>(
			`${ENDPOINTS.repoApi}/${enc(repoId)}/ext/${enc(extensionId)}/tools/${
				enc(toolName)
			}`,
			{ args, ...(project === undefined ? {} : { project }) },
		)).result,

	view: (path: string, view: string) =>
		http.get<ViewResponse>(ENDPOINTS.view, { path, view }),

	slots: {
		/**
		 * `slotId` is the contribution id (`SlotInstanceDto.id`, unique within
		 * a manifest): the route's `<slotId>` segment (WP7a).
		 */
		render: (installationId: string, slotId: string, ctx: SlotCtxHint) =>
			http.get<SlotRenderResponse>(
				`${ENDPOINTS.slot}/${enc(installationId)}/${enc(slotId)}`,
				{ ctx: b64urlJson(ctx) },
			),
		action: (
			installationId: string,
			slotId: string,
			request: ActionRequest,
		) =>
			http.post<ActionResponse>(
				`${ENDPOINTS.slot}/${enc(installationId)}/${enc(slotId)}/action`,
				request,
			),
	},

	browse: {
		tree: (repo: string, ref: string, path: string) =>
			http.get<TreeResponse>(ENDPOINTS.tree, { repo, ref, path }),
		blob: (repo: string, ref: string, path: string) =>
			http.get<BlobResponse>(ENDPOINTS.blob, { repo, ref, path }),
		log: (repo: string, ref: string, path?: string, cursor?: string) =>
			http.get<LogResponse>(ENDPOINTS.log, { repo, ref, path, cursor }),
		/** `patch`: each file carries its unified patch (`patch=1`), within the kernel's caps. */
		commit: (repo: string, sha: string, options: DiffQuery = {}) =>
			http.get<CommitResponse>(ENDPOINTS.commit, {
				repo,
				sha,
				patch: options.patch ? 1 : undefined,
			}),
		compare: (
			repo: string,
			base: string,
			head: string,
			options: DiffQuery = {},
		) =>
			http.get<CompareResponse>(ENDPOINTS.compare, {
				repo,
				base,
				head,
				patch: options.patch ? 1 : undefined,
				lane: options.lane,
			}),
	},

	events: {
		/** The repo log after `since`, ascending; `head` is the log's head (WP6). */
		list: (repoId: string, query: EventsQuery = {}) =>
			http.get<EventsResponse>(ENDPOINTS.events, {
				repo: repoId,
				since: query.since,
				limit: query.limit,
				types: csv(query.types),
			}),
	},

	invites: {
		create: (request: InviteCreateRequest) =>
			http.post<InviteCreated>(ENDPOINTS.invites, request),
	},

	extensions: {
		packages: () => http.get<PackagesResponse>(ENDPOINTS.packages),
		/** What is in force at a node path (WP7a requires `node`). */
		/** Without `node`: at the viewer's start node (WP7a picks one that exists). */
		installations: (node?: string, includeDisabled = false) =>
			http.get<InstallationsResponse>(ENDPOINTS.installations, {
				node,
				include: includeDisabled ? "disabled" : undefined,
			}),
		installation: (id: string) =>
			http.get<InstallationDto>(`${ENDPOINTS.installations}/${enc(id)}`),
		sheet: (request: InstallRequest) =>
			http.post<PermissionSheet>(`${ENDPOINTS.installations}/sheet`, request),
		/** Also installs a protocol pack and its members. */
		install: (request: InstallRequest) =>
			http.post<InstallationDto>(ENDPOINTS.installations, request),
		/** The circuit breaker of a js/wasm installation scope. */
		breaker: (id: string, repo?: string) =>
			http.get<BreakerResponse>(
				`${ENDPOINTS.installations}/${enc(id)}/breaker`,
				repo ? { repo } : undefined,
			),
		/** An Owner's reset. */
		resetBreaker: (id: string, repo?: string) =>
			http.post<BreakerResponse>(
				`${ENDPOINTS.installations}/${enc(id)}/breaker${
					repo ? `?repo=${encodeURIComponent(repo)}` : ""
				}`,
				{},
			),
		setMode: (id: string, mode: InstallationMode) =>
			http.put<InstallationDto>(
				`${ENDPOINTS.installations}/${enc(id)}/mode`,
				{ mode },
			),
	},
});

/** `GET`/`POST /-/api/installations/<id>/breaker`. */
export type BreakerResponse = {
	readonly installation: string;
	readonly scope: { readonly kind: "node" } | {
		readonly kind: "repo";
		readonly repoId: string;
	};
	readonly breaker: BreakerStatus;
};

export type Api = ReturnType<typeof createApi>;

/** `/-/auth/login` with a same-origin `return_to` (anything else becomes `/`). */
export const loginHref = (
	returnTo: string,
	extra: Readonly<Record<string, string>> = {},
): string => {
	const safe = sameOriginPath(returnTo) ?? "/";
	const params = new URLSearchParams({ return_to: safe, ...extra });
	return `${ENDPOINTS.login}?${params.toString()}`;
};
