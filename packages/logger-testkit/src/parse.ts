import { parseTree, type Node, type ParseError } from "jsonc-parser";

export type LogRecord = Readonly<Record<string, unknown>>;

function rejectDuplicateKeys(node: Node, line: number): void {
  if (node.type === "object") {
    const names = new Set<string>();
    for (const property of node.children ?? []) {
      const name = property.children?.[0]?.value as string;
      if (names.has(name)) throw new Error(`Log line ${line}: Duplicate JSON fields`);
      names.add(name);
    }
  }
  for (const child of node.children ?? []) rejectDuplicateKeys(child, line);
}

/** Parse strict NDJSON, without echoing raw log content in errors. */
export function parseLogs(output: string): readonly LogRecord[] {
  const records: LogRecord[] = [];
  for (const [index, text] of output.split(/\r?\n/).entries()) {
    if (!text.trim()) continue;
    const line = index + 1;
    const errors: ParseError[] = [];
    const tree = parseTree(text, errors, { disallowComments: true, allowTrailingComma: false });
    if (errors.length || !tree || tree.type !== "object") {
      throw new Error(`Log line ${line}: Expected a valid JSON object; content is not shown`);
    }
    rejectDuplicateKeys(tree, line);
    try {
      records.push(JSON.parse(text) as LogRecord);
    } catch {
      throw new Error(`Log line ${line}: Invalid JSON; content is not shown`);
    }
  }
  return records;
}
