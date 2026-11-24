/**
 * Ultra-lightweight, zero-dependency GitHub Flavored Markdown (GFM) to HTML renderer.
 * Designed for <5ms rendering in the built-in viewer with strict XSS escaping.
 */

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (
    /^(https?:\/\/|mailto:|#|\/|\.\.?\/)/i.test(trimmed) &&
    !/^javascript:/i.test(trimmed)
  ) {
    return escapeHtml(trimmed);
  }
  return "#";
}

function renderInline(raw: string): string {
  const codeSpans: string[] = [];
  // Extract inline code first so markdown inside backticks is never parsed
  let text = raw.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    const idx = codeSpans.length;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  text = escapeHtml(text);

  // Images ![alt](url)
  text = text.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_m, alt: string, url: string) =>
      `<img src="${sanitizeUrl(url)}" alt="${alt}" loading="lazy" />`
  );

  // Links [label](url)
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, url: string) =>
      `<a href="${sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );

  // Bold + Italic
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
  text = text.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Restore inline code spans
  text = text.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx: string) => {
    return codeSpans[Number(idx)] ?? "";
  });

  return text;
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(trimmed);
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((c) => c.trim());
}

function parseAlignments(sepLine: string): Array<"left" | "center" | "right" | ""> {
  return splitTableRow(sepLine).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

const ALERT_META: Record<string, { label: string; cls: string }> = {
  NOTE: { label: "Note", cls: "md-alert-note" },
  TIP: { label: "Tip", cls: "md-alert-tip" },
  IMPORTANT: { label: "Important", cls: "md-alert-important" },
  WARNING: { label: "Warning", cls: "md-alert-warning" },
  CAUTION: { label: "Caution", cls: "md-alert-caution" },
};

export function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Blank line
    if (!trimmed) {
      i++;
      continue;
    }

    // Fenced code block (``` or ~~~)
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLen = fenceMatch[1].length;
      const lang = fenceMatch[2].trim().split(/\s+/)[0] || "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const closeLine = lines[i].trim();
        if (
          closeLine.startsWith(fenceChar.repeat(fenceLen)) &&
          closeLine.replace(new RegExp(`^\\${fenceChar}+`), "").trim() === ""
        ) {
          i++;
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      const rawCode = codeLines.join("\n");
      const escapedCode = escapeHtml(rawCode);
      const langBadge = lang
        ? `<span class="md-code-lang">${escapeHtml(lang)}</span>`
        : `<span class="md-code-lang">text</span>`;
      out.push(
        `<div class="md-code-block"><div class="md-code-header">${langBadge}<button type="button" class="md-copy-btn" data-copy-code="true">Copy</button></div><pre><code>${escapedCode}</code></pre></div>`
      );
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      out.push("<hr />");
      i++;
      continue;
    }

    // ATX Heading (# .. ######)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const id = slugifyHeading(content);
      out.push(`<h${level} id="${escapeHtml(id)}">${renderInline(content)}</h${level}>`);
      i++;
      continue;
    }

    // GFM Table
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1])
    ) {
      const headers = splitTableRow(lines[i]);
      const aligns = parseAlignments(lines[i + 1]);
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim() !== "") {
        bodyRows.push(splitTableRow(lines[i]));
        i++;
      }
      const ths = headers
        .map((h, idx) => {
          const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "";
          return `<th${align}>${renderInline(h)}</th>`;
        })
        .join("");
      const trs = bodyRows
        .map((row) => {
          const tds = headers
            .map((_h, idx) => {
              const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : "";
              return `<td${align}>${renderInline(row[idx] ?? "")}</td>`;
            })
            .join("");
          return `<tr>${tds}</tr>`;
        })
        .join("");
      out.push(
        `<div class="md-table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`
      );
      continue;
    }

    // Blockquote / GitHub Alert
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      const firstAlert = quoteLines[0]?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i);
      if (firstAlert) {
        const key = firstAlert[1].toUpperCase();
        const meta = ALERT_META[key] ?? ALERT_META.NOTE;
        const innerHtml = renderMarkdownToHtml(quoteLines.slice(1).join("\n"));
        out.push(
          `<div class="md-alert ${meta.cls}"><div class="md-alert-title">${meta.label}</div><div class="md-alert-body">${innerHtml}</div></div>`
        );
      } else {
        const innerHtml = renderMarkdownToHtml(quoteLines.join("\n"));
        out.push(`<blockquote>${innerHtml}</blockquote>`);
      }
      continue;
    }

    // Unordered or Ordered List (with task list checkboxes)
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (ulMatch || olMatch) {
      const isOrdered = Boolean(olMatch);
      const tag = isOrdered ? "ol" : "ul";
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i];
        const m = isOrdered
          ? cur.match(/^\s*\d+\.\s+(.*)$/)
          : cur.match(/^\s*[-*+]\s+(.*)$/);
        if (!m) break;
        const itemText = m[1];
        const taskMatch = !isOrdered && itemText.match(/^\[( |x|X)\]\s+(.*)$/);
        if (taskMatch) {
          const checked = taskMatch[1].toLowerCase() === "x";
          items.push(
            `<li class="md-task-item"><input type="checkbox" disabled ${
              checked ? "checked" : ""
            } /><span>${renderInline(taskMatch[2])}</span></li>`
          );
        } else {
          items.push(`<li>${renderInline(itemText)}</li>`);
        }
        i++;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    // Paragraph (consume consecutive non-block lines)
    const paraLines: string[] = [trimmed];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        !next ||
        /^(`{3,}|~{3,})/.test(next) ||
        /^#{1,6}\s+/.test(next) ||
        next.startsWith(">") ||
        /^[-*+]\s+/.test(next) ||
        /^\d+\.\s+/.test(next) ||
        /^(-{3,}|\*{3,}|_{3,})$/.test(next)
      ) {
        break;
      }
      paraLines.push(next);
      i++;
    }
    out.push(`<p>${paraLines.map((l) => renderInline(l)).join(" ")}</p>`);
  }

  return out.join("\n");
}

export function isMarkdownFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith(".md") ||
    lower.endsWith(".markdown") ||
    lower.endsWith(".mdx")
  );
}
