"use client";

import { diffLines } from "diff";
import { Highlight, type PrismTheme } from "prism-react-renderer";
import { sourcePreview } from "@/lib/source-preview";

function downloadSource(code: string, path: string) {
  const url = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = path.split("/").at(-1) || "source.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const lightTheme: PrismTheme = {
  plain: { color: "#344039" },
  styles: [
    {
      types: ["comment", "prolog", "doctype", "cdata"],
      style: { color: "#687267", fontStyle: "italic" },
    },
    { types: ["string", "attr-value"], style: { color: "#a64436" } },
    {
      types: ["property", "attr-name", "keyword", "selector"],
      style: { color: "#66548f" },
    },
    {
      types: ["number", "boolean", "constant", "function", "tag"],
      style: { color: "#357051" },
    },
  ],
};
const darkTheme: PrismTheme = {
  plain: { color: "#eee9df" },
  styles: [
    {
      types: ["comment", "prolog", "doctype", "cdata"],
      style: { color: "#b2b9b5", fontStyle: "italic" },
    },
    { types: ["string", "attr-value"], style: { color: "#f2a58c" } },
    {
      types: ["property", "attr-name", "keyword", "selector"],
      style: { color: "#d6c6f1" },
    },
    {
      types: ["number", "boolean", "constant", "function", "tag"],
      style: { color: "#b7dcc5" },
    },
  ],
};

export function ChangedLines(
  before: string,
  after: string,
  side: "before" | "after",
) {
  const lines = new Set<number>();
  if (before === after || sourcePreview(before).truncated || sourcePreview(after).truncated) return lines;
  let position = 1;
  for (const part of diffLines(before, after)) {
    if ((side === "before" && part.added) || (side === "after" && part.removed))
      continue;
    const count =
      part.value.split("\n").length - (part.value.endsWith("\n") ? 1 : 0);
    if ((side === "before" && part.removed) || (side === "after" && part.added))
      for (let i = 0; i < count; i++) lines.add(position + i);
    position += count;
  }
  return lines;
}

export function CodeView({
  code,
  path,
  label,
  dark,
  changed,
  side,
}: {
  code: string;
  path: string;
  label: string;
  dark: boolean;
  changed?: Set<number>;
  side?: "before" | "after";
}) {
  const preview = sourcePreview(code);
  if (preview.truncated) return (
    <div className="large-source-preview">
      <p>Large file preview. The complete source stays in your export.</p>
      <button type="button" onClick={() => downloadSource(code, path)}>Download complete file</button>
      <pre aria-label={label} className="highlighted-code">{preview.text}</pre>
    </div>
  );
  const ext = path.split(".").pop();
  const language =
    ext === "json"
      ? "json"
      : ext === "css"
        ? "css"
        : ["html", "svg", "xml"].includes(ext ?? "")
          ? "markup"
          : "javascript";
  return (
    <Highlight
      theme={dark ? darkTheme : lightTheme}
      code={code.replace(/\n$/, "")}
      language={language}
    >
      {({ tokens, getTokenProps }) => (
        <pre aria-label={label} className="highlighted-code">
          {tokens.map((line, i) => (
            <div
              key={`line-${i}`}
              className={`code-line ${changed?.has(i + 1) ? (side === "before" ? "line-removed" : "line-added") : ""}`}
            >
              <span className="line-number" aria-hidden="true">
                {i + 1}
              </span>
              <span className="line-source">
                {line.map((token, j) => {
                  const props = getTokenProps({ token });
                  return (
                    <span
                      key={`token-${i}-${j}`}
                      className={props.className}
                      style={props.style}
                    >
                      {token.content}
                    </span>
                  );
                })}
              </span>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

export function UnifiedDiff({
  before,
  after,
  path = "source.txt",
}: {
  before: string;
  after: string;
  path?: string;
}) {
  if (sourcePreview(before).truncated || sourcePreview(after).truncated) return (
    <div className="large-source-preview">
      <p>This file is too large for the inline diff. Download both versions for a complete comparison.</p>
      <button type="button" onClick={() => downloadSource(before, `original-${path.split("/").at(-1)}`)}>Download original</button>{" "}
      <button type="button" onClick={() => downloadSource(after, `proposal-${path.split("/").at(-1)}`)}>Download proposal</button>
    </div>
  );
  return (
    <pre className="unified-diff" aria-label="Unified source diff">
      {diffLines(before, after).flatMap((part, index) =>
        part.value
          .replace(/\n$/, "")
          .split("\n")
          .map((line, i) => (
            <div
              className={`code-line ${part.added ? "line-added" : part.removed ? "line-removed" : ""}`}
              key={`${index}-${i}`}
            >
              <span className="line-number" aria-hidden="true">
                {part.added ? "+" : part.removed ? "−" : " "}
              </span>
              <span className="line-source">{line || " "}</span>
            </div>
          )),
      )}
    </pre>
  );
}
