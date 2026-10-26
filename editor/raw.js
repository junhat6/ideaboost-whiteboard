// CodeMirror positions count a CRLF pair as one newline. Patch the original
// source so editing one paragraph cannot normalize untouched mixed line endings.
export function patchRaw(raw, changes, lineBreak = "\n") {
  const offsets = [0];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\r" && raw[i + 1] === "\n") i++;
    offsets.push(i + 1);
  }
  const edits = [];
  changes.iterChanges((from, to, _fromB, _toB, insert) => {
    edits.push({
      from: offsets[from],
      to: offsets[to],
      text: insert.toString().replaceAll("\n", lineBreak),
    });
  });
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    raw = raw.slice(0, e.from) + e.text + raw.slice(e.to);
  }
  return raw;
}
