export interface SymbolClickTarget {
  kind: "symbol" | "include";
  /** Symbol identifier (e.g. `AddItem`) or raw include path (e.g. `core/Player.h`) */
  token: string;
  /** Optional scope/receiver qualifier before cursor (e.g. `Inventory` in `Inventory::AddItem` or `inv.AddItem`) */
  qualifier: string | null;
  /** 0-based start/end character offsets in the line */
  startCol: number;
  endCol: number;
}

const IDENT_CHAR_RE = /[A-Za-z0-9_]/;
const INCLUDE_RE = /^\s*#\s*include\s*(?:"([^"]+)"|<([^>]+)>)/;

const NON_JUMPABLE_KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "default", "break",
  "continue", "return", "goto", "try", "catch", "finally", "throw", "new",
  "delete", "sizeof", "typeof", "true", "false", "null", "nullptr", "this",
  "super", "base", "void", "bool", "boolean", "int", "uint", "long", "ulong",
  "short", "ushort", "byte", "sbyte", "char", "float", "double", "decimal",
  "string", "object", "var", "let", "const", "auto", "static", "public",
  "private", "protected", "internal", "virtual", "override", "abstract",
  "sealed", "readonly", "async", "await", "using", "namespace", "class",
  "struct", "interface", "enum", "record", "partial", "extern", "inline",
  "typename", "template", "operator", "fn", "pub", "impl", "trait", "mod",
  "use", "mut", "ref", "match", "loop", "in", "as", "is", "of", "from",
  "import", "export", "function", "type", "extends", "implements", "yield",
]);

/**
 * Extract either an `#include "..."` target or a jumpable identifier + optional qualifier
 * from a single line of source code at a 0-based character column.
 */
export function extractSymbolClickTarget(
  line: string,
  col: number
): SymbolClickTarget | null {
  if (!line || col < 0) return null;
  const clamped = Math.min(Math.max(0, col), line.length - 1);

  // 1. Check C/C++ #include "..." or #include <...>
  const incMatch = INCLUDE_RE.exec(line);
  if (incMatch) {
    const rawPath = incMatch[1] ?? incMatch[2] ?? "";
    if (rawPath) {
      const pathIdx = line.indexOf(rawPath);
      if (pathIdx >= 0 && clamped >= pathIdx - 1 && clamped <= pathIdx + rawPath.length) {
        return {
          kind: "include",
          token: rawPath,
          qualifier: null,
          startCol: pathIdx,
          endCol: pathIdx + rawPath.length,
        };
      }
    }
  }

  // 2. Find identifier boundaries around `clamped`
  let pivot = clamped;
  if (!IDENT_CHAR_RE.test(line[pivot] ?? "")) {
    if (pivot > 0 && IDENT_CHAR_RE.test(line[pivot - 1] ?? "")) {
      pivot -= 1;
    } else {
      return null;
    }
  }

  let start = pivot;
  while (start > 0 && IDENT_CHAR_RE.test(line[start - 1])) start--;
  let end = pivot + 1;
  while (end < line.length && IDENT_CHAR_RE.test(line[end])) end++;

  const token = line.slice(start, end);
  if (!token || /^[0-9]/.test(token) || NON_JUMPABLE_KEYWORDS.has(token)) {
    return null;
  }

  // 3. Look backwards for qualifier: `Foo::Bar`, `Foo.Bar`, `ptr->Bar`, `Foo<T>::Bar`
  const qualifier = extractPrecedingQualifier(line, start);

  return {
    kind: "symbol",
    token,
    qualifier,
    startCol: start,
    endCol: end,
  };
}

function extractPrecedingQualifier(line: string, identStart: number): string | null {
  let i = identStart;
  while (i > 0 && (line[i - 1] === " " || line[i - 1] === "\t")) i--;

  // Check operator: `::`, `->`, `.`, `?.`
  if (i >= 2 && line[i - 2] === ":" && line[i - 1] === ":") {
    i -= 2;
  } else if (i >= 2 && line[i - 2] === "-" && line[i - 1] === ">") {
    i -= 2;
  } else if (i >= 2 && line[i - 2] === "?" && line[i - 1] === ".") {
    i -= 2;
  } else if (i >= 1 && line[i - 1] === ".") {
    i -= 1;
  } else {
    return null;
  }

  while (i > 0 && (line[i - 1] === " " || line[i - 1] === "\t")) i--;

  // Skip generic argument list like `List<Foo>.Add` or `std::vector<int>::push_back`
  if (i > 0 && line[i - 1] === ">") {
    let depth = 0;
    while (i > 0) {
      i--;
      if (line[i] === ">") depth++;
      else if (line[i] === "<") {
        depth--;
        if (depth === 0) break;
      }
    }
    while (i > 0 && (line[i - 1] === " " || line[i - 1] === "\t")) i--;
  }

  const qEnd = i;
  while (i > 0 && IDENT_CHAR_RE.test(line[i - 1])) i--;
  const q = line.slice(i, qEnd);
  if (!q || /^[0-9]/.test(q) || q === "this" || q === "self" || q === "base" || q === "super") {
    return null;
  }
  return q;
}

/**
 * Compute 0-based character column inside a rendered code line element from a pointer event.
 * Works across nested syntax-highlight `<span>` nodes using browser caretRangeFromPoint / caretPositionFromPoint.
 */
export function resolveClickColumnInLineElement(
  lineEl: HTMLElement,
  clientX: number,
  clientY: number
): number | null {
  let targetNode: Node | null = null;
  let targetOffset = 0;

  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null;
  };

  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (range) {
      targetNode = range.startContainer;
      targetOffset = range.startOffset;
    }
  } else if (typeof doc.caretPositionFromPoint === "function") {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      targetNode = pos.offsetNode;
      targetOffset = pos.offset;
    }
  }

  if (!targetNode || !lineEl.contains(targetNode)) {
    return null;
  }

  // Sum text lengths of all text nodes preceding `targetNode` inside `lineEl`
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  let total = 0;
  let cur = walker.nextNode();
  while (cur) {
    if (cur === targetNode) {
      return total + targetOffset;
    }
    total += cur.textContent?.length ?? 0;
    cur = walker.nextNode();
  }

  // If targetNode is an element node, walk up to targetOffset children
  if (targetNode.nodeType === Node.ELEMENT_NODE) {
    let prefix = 0;
    const el = targetNode as Element;
    for (let i = 0; i < Math.min(targetOffset, el.childNodes.length); i++) {
      prefix += el.childNodes[i].textContent?.length ?? 0;
    }
    return prefix;
  }

  return null;
}
