// Scan only new chunks. A large result line is joined once, rather than copied
// and rescanned each time another network chunk arrives.
export function lineReader(consume: (line: string) => void, maxChars: number) {
  let parts: string[] = [];
  let length = 0;
  function append(part: string) {
    length += part.length;
    if (length > maxChars) throw new Error("Migration response exceeds the supported size. Keep the source and download the available report.");
    if (part) parts.push(part);
  }
  function flush() {
    const line = parts.join("");
    parts = [];
    length = 0;
    if (line.trim()) consume(line);
  }
  return {
    push(chunk: string) {
      let start = 0;
      for (let end = chunk.indexOf("\n", start); end !== -1; end = chunk.indexOf("\n", start)) {
        append(chunk.slice(start, end));
        flush();
        start = end + 1;
      }
      append(chunk.slice(start));
    },
    finish: flush,
  };
}
