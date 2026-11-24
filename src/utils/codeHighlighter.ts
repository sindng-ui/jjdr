import { escapeHtml } from "./markdownRenderer";

export type CodeLanguage =
  | "cpp"
  | "rust"
  | "typescript"
  | "python"
  | "go"
  | "java"
  | "json"
  | "toml"
  | "yaml"
  | "css"
  | "html"
  | "shell"
  | "sql"
  | "diff"
  | "plain";

const EXT_LANG_MAP: Record<string, CodeLanguage> = {
  c: "cpp",
  h: "cpp",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  inl: "cpp",
  cs: "java",
  java: "java",
  kt: "java",
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "typescript",
  jsx: "typescript",
  mjs: "typescript",
  cjs: "typescript",
  py: "python",
  pyi: "python",
  go: "go",
  json: "json",
  jsonc: "json",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  scss: "css",
  less: "css",
  html: "html",
  htm: "html",
  xml: "html",
  svg: "html",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "shell",
  psm1: "shell",
  bat: "shell",
  cmd: "shell",
  sql: "sql",
  diff: "diff",
  patch: "diff",
};

const LANG_LABELS: Record<CodeLanguage, string> = {
  cpp: "C / C++",
  rust: "Rust",
  typescript: "TS / JS",
  python: "Python",
  go: "Go",
  java: "Java / C#",
  json: "JSON",
  toml: "TOML",
  yaml: "YAML",
  css: "CSS",
  html: "HTML / XML",
  shell: "Shell",
  sql: "SQL",
  diff: "Diff",
  plain: "Text",
};

export function detectCodeLanguage(path: string): CodeLanguage {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  if (base === "dockerfile" || base === "makefile" || base === "cmakelists.txt") {
    return "shell";
  }
  const dot = base.lastIndexOf(".");
  if (dot === -1) return "plain";
  const ext = base.slice(dot + 1);
  return EXT_LANG_MAP[ext] ?? "plain";
}

export function getLanguageLabel(lang: CodeLanguage): string {
  return LANG_LABELS[lang];
}

const KEYWORDS_BY_LANG: Partial<Record<CodeLanguage, Set<string>>> = {
  cpp: new Set([
    "alignas", "alignof", "auto", "bool", "break", "case", "catch", "char", "class",
    "const", "constexpr", "consteval", "continue", "default", "delete", "do", "double",
    "else", "enum", "explicit", "export", "extern", "false", "float", "for", "friend",
    "goto", "if", "inline", "int", "long", "mutable", "namespace", "new", "noexcept",
    "nullptr", "operator", "override", "private", "protected", "public", "return",
    "short", "signed", "sizeof", "static", "static_cast", "dynamic_cast", "reinterpret_cast",
    "struct", "switch", "template", "this", "throw", "true", "try", "typedef", "typename",
    "union", "unsigned", "using", "virtual", "void", "volatile", "while", "final",
    "size_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "int32_t", "int64_t", "std",
  ]),
  rust: new Set([
    "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else", "enum",
    "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
    "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super",
    "trait", "true", "type", "unsafe", "use", "where", "while", "Option", "Result",
    "Some", "None", "Ok", "Err", "String", "Vec", "Arc", "Box", "bool", "usize", "isize",
    "u8", "u16", "u32", "u64", "i32", "i64", "f32", "f64",
  ]),
  typescript: new Set([
    "as", "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false",
    "finally", "for", "from", "function", "if", "implements", "import", "in", "instanceof",
    "interface", "let", "new", "null", "of", "package", "private", "protected", "public",
    "readonly", "return", "static", "super", "switch", "this", "throw", "true", "try",
    "type", "typeof", "undefined", "var", "void", "while", "yield", "string", "number",
    "boolean", "unknown", "never", "any", "Record", "Promise",
  ]),
  python: new Set([
    "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del",
    "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import",
    "in", "is", "lambda", "None", "nonlocal", "not", "or", "pass", "raise", "return",
    "True", "try", "while", "with", "yield", "self", "int", "str", "float", "bool", "dict", "list",
  ]),
  go: new Set([
    "break", "case", "chan", "const", "continue", "default", "defer", "else", "fallthrough",
    "for", "func", "go", "goto", "if", "import", "interface", "map", "package", "range",
    "return", "select", "struct", "switch", "type", "var", "true", "false", "nil", "error",
    "string", "int", "int64", "uint64", "bool", "byte", "rune", "any",
  ]),
  java: new Set([
    "abstract", "async", "await", "boolean", "bool", "break", "byte", "case", "catch",
    "char", "class", "const", "continue", "default", "do", "double", "else", "enum",
    "extends", "false", "final", "finally", "float", "for", "foreach", "if", "implements",
    "import", "in", "int", "interface", "internal", "long", "namespace", "new", "null",
    "override", "package", "private", "protected", "public", "readonly", "record", "return",
    "sealed", "short", "static", "string", "struct", "super", "switch", "this", "throw",
    "throws", "true", "try", "using", "var", "virtual", "void", "while",
  ]),
  shell: new Set([
    "if", "then", "else", "elif", "fi", "for", "in", "do", "done", "while", "until",
    "case", "esac", "function", "return", "exit", "export", "local", "echo", "set",
    "param", "foreach", "switch", "try", "catch", "finally", "true", "false", "null",
  ]),
  sql: new Set([
    "select", "from", "where", "join", "left", "right", "inner", "outer", "on", "as",
    "and", "or", "not", "in", "is", "null", "order", "by", "group", "having", "limit",
    "insert", "into", "values", "update", "set", "delete", "create", "table", "index",
    "drop", "alter", "distinct", "union", "all", "case", "when", "then", "else", "end",
  ]),
};

function wrapToken(cls: string, raw: string): string {
  return `<span class="${cls}">${escapeHtml(raw)}</span>`;
}

/**
 * Ultra-fast single-line syntax highlighter (zero external parser overhead).
 * Designed to run inside a virtualized row list so only visible ~45 lines are tokenized.
 */
export function highlightCodeLine(line: string, lang: CodeLanguage): string {
  if (!line) return " ";

  if (lang === "diff") {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      return wrapToken("cv-diff-add", line);
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      return wrapToken("cv-diff-del", line);
    }
    if (line.startsWith("@@")) {
      return wrapToken("cv-diff-hunk", line);
    }
    return escapeHtml(line);
  }

  if (lang === "plain") {
    return escapeHtml(line);
  }

  if (lang === "cpp" && /^\s*#\s*\w+/.test(line)) {
    return wrapToken("cv-preproc", line);
  }

  if (lang === "toml") {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("#")) return wrapToken("cv-comment", line);
    if (trimmed.startsWith("[")) return wrapToken("cv-type", line);
  }

  if (lang === "html") {
    return highlightHtmlLine(line);
  }

  const hashComment =
    lang === "python" || lang === "shell" || lang === "toml" || lang === "yaml";
  const slashComment =
    lang === "cpp" ||
    lang === "rust" ||
    lang === "typescript" ||
    lang === "go" ||
    lang === "java" ||
    lang === "css" ||
    lang === "json";
  const dashComment = lang === "sql";

  const keywords = KEYWORDS_BY_LANG[lang];
  const caseInsensitiveKw = lang === "sql";

  let out = "";
  let i = 0;
  const n = line.length;

  while (i < n) {
    const ch = line[i];

    // Line comments
    if (hashComment && ch === "#") {
      out += wrapToken("cv-comment", line.slice(i));
      break;
    }
    if (slashComment && ch === "/" && line[i + 1] === "/") {
      out += wrapToken("cv-comment", line.slice(i));
      break;
    }
    if (dashComment && ch === "-" && line[i + 1] === "-") {
      out += wrapToken("cv-comment", line.slice(i));
      break;
    }
    // Inline block comment /* ... */
    if (slashComment && ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      const sliceEnd = end === -1 ? n : end + 2;
      out += wrapToken("cv-comment", line.slice(i, sliceEnd));
      i = sliceEnd;
      continue;
    }

    // String literals ("...", '...', `...`)
    if (ch === '"' || ch === "'" || (lang === "typescript" && ch === "`")) {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (line[j] === "\\" && j + 1 < n) {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      const rawStr = line.slice(i, j);
      // JSON property key detection ("key":)
      if (lang === "json" && /^\s*:/.test(line.slice(j))) {
        out += wrapToken("cv-prop", rawStr);
      } else {
        out += wrapToken("cv-string", rawStr);
      }
      i = j;
      continue;
    }

    // Numbers
    if (
      (ch >= "0" && ch <= "9") &&
      (i === 0 || !/[A-Za-z0-9_$]/.test(line[i - 1]))
    ) {
      let j = i + 1;
      while (j < n && /[0-9a-fA-FxXoObB._]/.test(line[j])) j++;
      out += wrapToken("cv-number", line.slice(i, j));
      i = j;
      continue;
    }

    // Identifiers / Keywords / Types / YAML-TOML keys
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$-]/.test(line[j])) {
        if (line[j] === "-" && lang !== "css" && lang !== "yaml" && lang !== "toml") {
          break;
        }
        j++;
      }
      const word = line.slice(i, j);
      const lookup = caseInsensitiveKw ? word.toLowerCase() : word;

      if ((lang === "yaml" || lang === "toml") && /^\s*[:=]/.test(line.slice(j))) {
        out += wrapToken("cv-prop", word);
      } else if (lang === "json" && (word === "true" || word === "false" || word === "null")) {
        out += wrapToken("cv-keyword", word);
      } else if (keywords?.has(lookup)) {
        out += wrapToken("cv-keyword", word);
      } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word) && word.length > 1) {
        out += wrapToken("cv-type", word);
      } else if (line[j] === "(") {
        out += wrapToken("cv-fn", word);
      } else {
        out += escapeHtml(word);
      }
      i = j;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
  }

  return out;
}

function highlightHtmlLine(line: string): string {
  // Simple tag / attribute / string highlight for HTML & XML
  const escaped = escapeHtml(line);
  return escaped.replace(
    /(&lt;!--[\s\S]*?--&gt;)|(&lt;\/?[A-Za-z0-9:_-]+)|(\/?&gt;)|(&quot;[^&]*?&quot;)/g,
    (m, comment, tag, close, str) => {
      if (comment) return `<span class="cv-comment">${comment}</span>`;
      if (tag) return `<span class="cv-keyword">${tag}</span>`;
      if (close) return `<span class="cv-keyword">${close}</span>`;
      if (str) return `<span class="cv-string">${str}</span>`;
      return m;
    }
  );
}
