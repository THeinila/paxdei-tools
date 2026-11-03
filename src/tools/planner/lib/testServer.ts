/** An in-memory stand-in for the /api/lists backend, installed as `fetch`, for
 * client tests (useList, the editor, the directory).
 *
 * It follows the server's rules (server/lists.ts): additive, clamped progress
 * deltas and version-guarded PATCHes that answer 409 with the current state.
 * Tests can hold responses (`hold()`), release them in any order, and inject
 * failures, so ordering and error paths are deterministic. Like testFixtures.ts,
 * nothing in the app imports it. */
import { vi } from "vitest";
import type { ListStateDef, ProgressEntry } from "./api.ts";

interface StoredList {
  version: number;
  state: ListStateDef;
  progress: Map<string, ProgressEntry>;
}

export interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
}

interface Held {
  call: Call;
  release: () => void;
}

export function installFakeServer() {
  const lists = new Map<string, StoredList>();
  const calls: Call[] = [];
  const held: Held[] = [];
  /** Held methods ("*" for all). "request" holds a call before the server sees it;
   * "response" lets the server answer at once and holds only the reply, as a
   * slow network would. */
  let holding: { method: string; stage: "request" | "response" }[] = [];
  const holds = (call: Call, stage: "request" | "response") =>
    holding.some((h) => h.stage === stage && (h.method === "*" || h.method === call.method));
  let nextToken = 0;
  /** Status to answer the next matching request with, instead of handling it. */
  const failures: { method: string; status: number }[] = [];
  /** Responses to answer the next PATCHes with 409, even on a current baseVersion. */
  let forcedConflicts = 0;

  const snapshot = (l: StoredList) => ({
    version: l.version,
    state: structuredClone(l.state),
    progress: [...l.progress.values()].sort((a, b) => a.itemId.localeCompare(b.itemId)),
    updatedAt: new Date(0).toISOString(),
  });

  function handle(call: Call): Response {
    const fail = failures.findIndex((f) => f.method === call.method);
    if (fail !== -1) {
      const { status } = failures.splice(fail, 1)[0]!;
      return Response.json({ error: "injected" }, { status });
    }
    const m = /^\/api\/lists(?:\/([^/]+))?(\/progress)?$/.exec(call.path);
    if (!m) return Response.json({ error: "not found" }, { status: 404 });
    const [, token, progress] = m;

    if (!token && call.method === "POST") {
      const t = `tok${String(nextToken++).padStart(19, "0")}`;
      const state = (call.body?.state ?? { name: "", targets: [], pathChoices: {} }) as ListStateDef;
      lists.set(t, { version: 0, state, progress: new Map() });
      return Response.json({ token: t, ...snapshot(lists.get(t)!) }, { status: 201 });
    }
    const list = token ? lists.get(decodeURIComponent(token)) : undefined;
    if (!list) return Response.json({ error: "not found" }, { status: 404 });

    if (progress && call.method === "POST") {
      const itemId = String(call.body!.itemId);
      const cur = list.progress.get(itemId)?.qty ?? 0;
      const entry: ProgressEntry = {
        itemId,
        qty: Math.min(10_000_000, Math.max(0, cur + Math.trunc(Number(call.body!.delta)))),
        byHandle: (call.body!.handle as string | null) ?? null,
        updatedAt: new Date(0).toISOString(),
      };
      list.progress.set(itemId, entry);
      return Response.json(entry);
    }
    if (call.method === "PATCH") {
      if (forcedConflicts > 0 || call.body!.baseVersion !== list.version) {
        if (forcedConflicts > 0) {
          forcedConflicts--;
          list.version++; // someone else saved in between
        }
        return Response.json({ error: "version conflict", ...snapshot(list) }, { status: 409 });
      }
      list.state = structuredClone(call.body!.state as ListStateDef);
      list.version++;
      return Response.json(snapshot(list));
    }
    return Response.json(snapshot(list));
  }

  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      path: input,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
    };
    calls.push(call);
    if (holds(call, "request")) await new Promise<void>((release) => held.push({ call, release }));
    const res = handle(call);
    if (holds(call, "response")) await new Promise<void>((release) => held.push({ call, release }));
    return res;
  });
  vi.stubGlobal("fetch", fetch);

  return {
    fetch,
    calls,
    /** Seed a list and return its token. */
    seed(token: string, state: Partial<ListStateDef> = {}, progress: Record<string, [number, string | null]> = {}) {
      lists.set(token, {
        version: 0,
        state: { name: "", targets: [], pathChoices: {}, ...state },
        progress: new Map(
          Object.entries(progress).map(([itemId, [qty, byHandle]]) => [
            itemId,
            { itemId, qty, byHandle, updatedAt: new Date(0).toISOString() },
          ]),
        ),
      });
      return token;
    },
    list: (token: string) => lists.get(token)!,
    /** Change server state as if another collaborator had written it. */
    otherClient(token: string, fn: (l: StoredList) => void) {
      const l = lists.get(token)!;
      fn(l);
    },
    /** Queue calls (for one method, or all) until released. */
    hold(method = "*", stage: "request" | "response" = "request") {
      holding.push({ method, stage });
    },
    held: () => held.map((h) => h.call),
    /** Release the i-th held request (in arrival order), or all of them. */
    release(i?: number) {
      if (i === undefined) {
        holding = [];
        for (const h of held.splice(0)) h.release();
      } else held.splice(i, 1)[0]!.release();
    },
    failNext(method: string, status: number) {
      failures.push({ method, status });
    },
    conflictNext(n: number) {
      forcedConflicts = n;
    },
    countOf: (method: string, pathPart = "") =>
      calls.filter((c) => c.method === method && c.path.includes(pathPart)).length,
  };
}
