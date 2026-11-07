import { randomUUID } from "node:crypto";
import type { Migration, StreamEvent } from "./types";

export function migrationResponse(
  run: (emit: (event: StreamEvent) => void, signal: AbortSignal) => Promise<Migration>,
  clientSignal?: AbortSignal,
  { heartbeatMs = 10000 } = {},
) {
  const abort = new AbortController();
  const encoder = new TextEncoder();
  let closed = false;
  let work: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = () => {
    clearTimeout(work);
    clearInterval(heartbeat);
    clientSignal?.removeEventListener("abort", disconnect);
  };
  const close = () => {
    cleanup();
    if (!closed) { closed = true; streamController.close(); }
  };
  const disconnect = () => { abort.abort(); close(); };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      if (clientSignal?.aborted) { disconnect(); return; }
      clientSignal?.addEventListener("abort", disconnect, { once: true });
      const emit = (event: StreamEvent) => {
        if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      emit({ type: "activity", activity: {
        id: randomUUID(), label: "Preparing migration", status: "complete", origin: "local",
        timestamp: new Date().toISOString(), detail: "Request accepted. Preparing the imported source for migration.",
      } });
      // Let Next.js send headers and the acknowledgement before synchronous scans.
      work = setTimeout(async () => {
        try {
          if (!abort.signal.aborted) emit({ type: "result", result: await run(emit, abort.signal) });
        } catch (error) {
          emit({ type: "error", message: error instanceof Error ? error.message : "Migration failed" });
        } finally {
          close();
        }
      }, 0);
      // Blank NDJSON lines keep the connection active without inventing progress.
      heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode("\n")); }, heartbeatMs);
    },
    cancel() { closed = true; cleanup(); abort.abort(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no",
  } });
}
