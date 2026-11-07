export const SOURCE_PREVIEW_CHARS = 50000;
export const SOURCE_PREVIEW_LINES = 500;

export function sourcePreview(code: string) {
  const text = code.slice(0, SOURCE_PREVIEW_CHARS).split("\n").slice(0, SOURCE_PREVIEW_LINES).join("\n");
  return { text, truncated: text.length < code.length };
}
