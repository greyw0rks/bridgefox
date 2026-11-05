export type SourceFile = { path: string; content: string; encoding: "utf8" | "base64" };
export type Project = { name: string; files: SourceFile[] };
export type Finding = {
  id: string; severity: "change" | "warning" | "blocked";
  title: string; detail: string; file: string; line?: number;
  rule: string; automatic: boolean; source?: string;
};
export type ApiUse = { api: string; file: string; line: number; support: "supported" | "review" | "unsupported" };
export type Report = {
  name: string; version: string; manifestVersion: number;
  findings: Finding[]; apis: ApiUse[]; permissions: string[];
  fileCount: number; sizeBytes: number; score: number;
};
export type Patch = { path: string; before: string; after: string; reason: string; origin: "rules" | "otari" };
export type Activity = {
  id: string; label: string; status: "running" | "complete" | "failed" | "skipped";
  origin: "local" | "otari"; detail: string; timestamp: string;
  model?: string; requestId?: string; costUsd?: number;
  fallback?: boolean; attempts?: number; data?: unknown;
};
export type Validation = { name: string; status: "passed" | "failed" | "review"; detail: string };
export type Migration = {
  project: Project; originalReport: Report; report: Report; patches: Patch[];
  validations: Validation[]; activities: Activity[]; summary: string;
  mode: "local" | "otari"; status: "review" | "candidate";
  spentUsd: number; costComplete: boolean; budgetUsd: number;
};
export type StreamEvent = { type: "activity"; activity: Activity } | { type: "result"; result: Migration } | { type: "error"; message: string };
