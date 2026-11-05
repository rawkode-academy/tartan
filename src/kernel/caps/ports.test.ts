// The optional Workers AI port: an absent binding is a typed failure, while
// a supplied binding receives the same request and response handling.

import { deepStrictEqual, ok, rejects } from "node:assert/strict";
import { TartanError } from "@tartan/contract";
import type { Env } from "../../env.ts";
import { createKernelPorts } from "./ports.ts";

Deno.test("the AI port reports an absent binding as unavailable", async () => {
	const ports = createKernelPorts({} as Env);
	await rejects(ports.ai("model", "prompt", {}), (error: unknown) => {
		ok(error instanceof TartanError);
		deepStrictEqual(error.code, "unavailable");
		deepStrictEqual(error.text, "Workers AI is not configured");
		return true;
	});
});

Deno.test("the AI port forwards requests and parses responses when configured", async () => {
	const calls: unknown[] = [];
	const env = {
		AI: {
			run: (model: string, input: unknown) => {
				calls.push({ model, input });
				return Promise.resolve({ response: '{"answer":42}' });
			},
		},
	} as unknown as Env;
	const schema = { type: "object", properties: { answer: { type: "number" } } };
	const result = await createKernelPorts(env).ai("model", "prompt", schema);
	deepStrictEqual(result, { answer: 42 });
	deepStrictEqual(calls, [{
		model: "model",
		input: {
			messages: [{ role: "user", content: "prompt" }],
			response_format: { type: "json_schema", json_schema: schema },
		},
	}]);
});
