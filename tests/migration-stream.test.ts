import test from "node:test";
import assert from "node:assert/strict";
import { migrationResponse } from "../src/lib/migration-stream";
import { migrate } from "../src/lib/migrate";
import { DEMO } from "../src/lib/demo";
import type { Migration } from "../src/lib/types";

const result = await migrate(DEMO, "local", () => {});
const decode = (value?: Uint8Array) => new TextDecoder().decode(value);

test("migration acknowledges the request before executing scans or gateway calls", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let calls = 0;
  const response = migrationResponse(async () => { calls++; return result; });
  const reader = response.body!.getReader();
  const acknowledgement = JSON.parse(decode((await reader.read()).value));
  assert.equal(acknowledgement.activity.label, "Preparing migration");
  assert.equal(calls, 0);
  assert.equal(response.headers.get("Cache-Control"), "no-store, no-transform");
  t.mock.timers.tick(0);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(decode((await reader.read()).value)).type, "result");
  assert.equal((await reader.read()).done, true);
  t.mock.timers.tick(30000); // Completed streams must no longer enqueue heartbeats.
});

test("delayed migration stays connected with blank keep-alives until its result", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let complete!: (value: Migration) => void;
  const pending = new Promise<Migration>(resolve => { complete = resolve; });
  const reader = migrationResponse(() => pending, undefined, { heartbeatMs: 10 }).body!.getReader();
  await reader.read();
  t.mock.timers.tick(0);
  for (let i = 0; i < 3; i++) {
    t.mock.timers.tick(10);
    assert.equal(decode((await reader.read()).value), "\n");
  }
  complete(result);
  assert.equal(JSON.parse(decode((await reader.read()).value)).type, "result");
  assert.equal((await reader.read()).done, true);
  t.mock.timers.tick(100);
});

test("cancelling an unread response prevents the queued migration from starting", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  let calls = 0;
  const response = migrationResponse(async () => { calls++; return result; });
  await response.body!.cancel();
  t.mock.timers.tick(30000);
  assert.equal(calls, 0);
});

test("client disconnect closes the stream, aborts running work, and drops late results", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const client = new AbortController();
  let signal!: AbortSignal;
  let complete!: (value: Migration) => void;
  const reader = migrationResponse((_, jobSignal) => {
    signal = jobSignal;
    return new Promise(resolve => { complete = resolve; });
  }, client.signal).body!.getReader();
  await reader.read();
  t.mock.timers.tick(0);
  client.abort();
  assert.equal(signal.aborted, true);
  assert.equal((await reader.read()).done, true);
  t.mock.timers.tick(30000);
  complete(result);
  await Promise.resolve();
  assert.equal((await reader.read()).done, true);
});

test("an already disconnected client never starts work or heartbeat timers", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const client = new AbortController();
  client.abort();
  let calls = 0;
  const response = migrationResponse(async () => { calls++; return result; }, client.signal);
  assert.equal(await response.text(), "");
  t.mock.timers.tick(30000);
  assert.equal(calls, 0);
});

test("migration failure is delivered once and closes the keep-alive stream", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const reader = migrationResponse(async () => { throw new Error("Gateway unavailable"); }).body!.getReader();
  await reader.read();
  t.mock.timers.tick(0);
  assert.deepEqual(JSON.parse(decode((await reader.read()).value)), { type: "error", message: "Gateway unavailable" });
  assert.equal((await reader.read()).done, true);
  t.mock.timers.tick(30000);
});
