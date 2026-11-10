import test from "node:test";
import assert from "node:assert/strict";
import { authorize } from "../src/lib/http";

test("a configured HTTPS workspace accepts same-origin requests through a TLS proxy", () => {
  const previousOrigin = process.env.BRIDGEFOX_PUBLIC_ORIGIN;
  const previousToken = process.env.BRIDGEFOX_ACCESS_TOKEN;
  Object.assign(process.env, { BRIDGEFOX_PUBLIC_ORIGIN: "https://bridgefox.example", BRIDGEFOX_ACCESS_TOKEN: "test-secret" });
  const request = (headers: Record<string, string>) => new Request("http://localhost:3035/api/import", { headers: { host: "bridgefox.example", origin: "https://bridgefox.example", "x-bridgefox-access": "test-secret", ...headers } });
  try {
    authorize(request({}));
    assert.throws(() => authorize(request({ origin: "https://other.example" })), /Cross-origin/);
    assert.throws(() => authorize(request({ host: "other.example" })), /Unexpected workspace host/);
    assert.throws(() => authorize(request({ "x-bridgefox-access": "wrong" })), /access password/);
    delete process.env.BRIDGEFOX_ACCESS_TOKEN;
    assert.throws(() => authorize(request({})), /workspace publicly/);
    process.env.BRIDGEFOX_ACCESS_TOKEN = "test-secret";
    for (const origin of ["invalid", "http://bridgefox.example", "https://bridgefox.example/path", "https://user:secret@bridgefox.example", "https://bridgefox.example?query=1"]) {
      process.env.BRIDGEFOX_PUBLIC_ORIGIN = origin;
      assert.throws(() => authorize(request({})), /public workspace origin/);
    }
    delete process.env.BRIDGEFOX_PUBLIC_ORIGIN;
    assert.throws(() => authorize(request({ "x-forwarded-proto": "https" })), /Cross-origin/);
  } finally {
    if (previousOrigin === undefined) delete process.env.BRIDGEFOX_PUBLIC_ORIGIN; else process.env.BRIDGEFOX_PUBLIC_ORIGIN = previousOrigin;
    if (previousToken === undefined) delete process.env.BRIDGEFOX_ACCESS_TOKEN; else process.env.BRIDGEFOX_ACCESS_TOKEN = previousToken;
  }
});
test("the public local demo keeps Otari access protected and rejects foreign origins", () => {
  const previous = { ...process.env };
  Object.assign(process.env, { BRIDGEFOX_PUBLIC_DEMO: "1", BRIDGEFOX_ACCESS_TOKEN: "test-secret", BRIDGEFOX_PUBLIC_ORIGIN: "https://bridgefox.example" });
  const request = (headers: Record<string, string> = {}) => new Request("http://localhost:3035/api/migrate", { headers: { host: "bridgefox.example", origin: "https://bridgefox.example", ...headers } });
  try {
    authorize(request());
    assert.throws(() => authorize(request(), true), /access password/);
    authorize(request({ "x-bridgefox-access": "test-secret" }), true);
    assert.throws(() => authorize(request({ origin: "https://other.example" })), /Cross-origin/);
    delete process.env.BRIDGEFOX_ACCESS_TOKEN;
    assert.throws(() => authorize(request(), true), /workspace publicly/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
