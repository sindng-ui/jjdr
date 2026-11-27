use tree_sitter::{Node, Parser};

use crate::symbols::types::{OutlineSymbol, ParsedFile, RawSymbol, SymbolKind};

pub const MAX_INDEXABLE_FILE_BYTES: u64 = 512 * 1024; // 512 KB cap
const MAX_AST_DEPTH: usize = 96;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymbolLang {
    CSharp,
    Cpp,
    TypeScript,
    Tsx,
    Rust,
}

/// Detect whether a relative path is eligible for symbol indexing.
/// Skips generated/minified artifacts so 20k+ repos stay lean and accurate.
pub fn detect_symbol_lang(rel_path: &str) -> Option<SymbolLang> {
    let lower = rel_path.to_ascii_lowercase();
    let file_name = lower.rsplit('/').next().unwrap_or(&lower);

    // Skip auto-generated / bundled artifacts
    if file_name.ends_with(".g.cs")
        || file_name.ends_with(".g.i.cs")
        || file_name.ends_with(".designer.cs")
        || file_name.ends_with(".pb.h")
        || file_name.ends_with(".pb.cc")
        || file_name.ends_with(".pb.cpp")
        || file_name.ends_with(".generated.h")
        || file_name.ends_with(".generated.cpp")
        || file_name.ends_with(".min.js")
        || file_name.ends_with(".bundle.js")
    {
        return None;
    }

    let ext = file_name.rsplit('.').next()?;
    match ext {
        "cs" => Some(SymbolLang::CSharp),
        "c" | "h" | "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" | "inl" => Some(SymbolLang::Cpp),
        "ts" | "mts" | "cts" | "js" | "mjs" | "cjs" => Some(SymbolLang::TypeScript),
        "tsx" | "jsx" => Some(SymbolLang::Tsx),
        "rs" => Some(SymbolLang::Rust),
        _ => None,
    }
}

/// Reusable per-thread parser pool to avoid re-initializing tree-sitter parsers 20,000 times.
pub struct ReusableSymbolParser {
    parser: Parser,
    current_lang: Option<SymbolLang>,
}

impl Default for ReusableSymbolParser {
    fn default() -> Self {
        Self::new()
    }
}

impl ReusableSymbolParser {
    pub fn new() -> Self {
        Self {
            parser: Parser::new(),
            current_lang: None,
        }
    }

    fn ensure_lang(&mut self, lang: SymbolLang) -> Result<(), String> {
        if self.current_lang == Some(lang) {
            return Ok(());
        }
        let ts_lang = match lang {
            SymbolLang::CSharp => tree_sitter_c_sharp::LANGUAGE.into(),
            SymbolLang::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            SymbolLang::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            SymbolLang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            SymbolLang::Rust => tree_sitter_rust::LANGUAGE.into(),
        };
        self.parser
            .set_language(&ts_lang)
            .map_err(|e| format!("Failed to set tree-sitter language: {}", e))?;
        self.current_lang = Some(lang);
        Ok(())
    }

    pub fn parse(&mut self, lang: SymbolLang, source: &[u8]) -> ParsedFile {
        if source.is_empty() || source.len() as u64 > MAX_INDEXABLE_FILE_BYTES {
            return ParsedFile::default();
        }
        if self.ensure_lang(lang).is_err() {
            return ParsedFile::default();
        }
        let Some(tree) = self.parser.parse(source, None) else {
            return ParsedFile::default();
        };

        let mut out = ParsedFile::default();
        let mut scope_stack: Vec<String> = Vec::with_capacity(8);
        let root = tree.root_node();

        match lang {
            SymbolLang::CSharp => walk_csharp(root, source, &mut scope_stack, &mut out, 0),
            SymbolLang::Cpp => walk_cpp(root, source, &mut scope_stack, &mut out, 0),
            SymbolLang::TypeScript | SymbolLang::Tsx => {
                walk_typescript(root, source, &mut scope_stack, &mut out, 0)
            }
            SymbolLang::Rust => walk_rust(root, source, &mut scope_stack, &mut out, 0),
        }

        out
    }
}

pub fn parse_file_outline(rel_path: &str, source: &[u8]) -> Vec<OutlineSymbol> {
    let Some(lang) = detect_symbol_lang(rel_path) else {
        return Vec::new();
    };
    let mut parser = ReusableSymbolParser::new();
    let parsed = parser.parse(lang, source);
    parsed
        .symbols
        .into_iter()
        .map(|s| OutlineSymbol {
            name: s.name,
            scope: s.scope,
            kind: s.kind,
            line: s.line,
            col: s.col,
            is_definition: s.is_definition,
        })
        .collect()
}

fn node_text<'a>(node: Node<'a>, src: &'a [u8]) -> &'a str {
    node.utf8_text(src).unwrap_or("").trim()
}

fn current_scope(stack: &[String]) -> String {
    if stack.is_empty() {
        String::new()
    } else {
        stack.last().cloned().unwrap_or_default()
    }
}

fn push_symbol(
    out: &mut ParsedFile,
    name: &str,
    scope: String,
    node: Node,
    kind: SymbolKind,
    is_definition: bool,
    is_partial: bool,
) {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 160 {
        return;
    }
    let pos = node.start_position();
    out.symbols.push(RawSymbol {
        name: trimmed.to_string(),
        scope,
        line: (pos.row + 1) as u32,
        col: pos.column.min(u16::MAX as usize) as u16,
        kind,
        is_definition,
        is_partial,
    });
}

fn has_child_text(node: Node, src: &[u8], expected: &str) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if node_text(child, src) == expected {
            return true;
        }
    }
    false
}

fn find_name_node<'a>(node: Node<'a>) -> Option<Node<'a>> {
    if let Some(n) = node.child_by_field_name("name") {
        return Some(n);
    }
    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        if matches!(
            child.kind(),
            "identifier" | "qualified_name" | "generic_name" | "type_identifier"
        ) {
            return Some(child);
        }
    }
    None
}

fn first_identifier_text<'a>(node: Node<'a>, src: &'a [u8]) -> Option<&'a str> {
    if matches!(
        node.kind(),
        "identifier" | "type_identifier" | "property_identifier" | "field_identifier"
    ) {
        return Some(node_text(node, src));
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(
            child.kind(),
            "identifier" | "type_identifier" | "property_identifier" | "field_identifier"
        ) {
            return Some(node_text(child, src));
        }
    }
    None
}

// ============================================================================
// C# AST Walker
// ============================================================================
fn walk_csharp(
    node: Node,
    src: &[u8],
    scope: &mut Vec<String>,
    out: &mut ParsedFile,
    depth: usize,
) {
    if depth >= MAX_AST_DEPTH {
        return;
    }

    let kind = node.kind();
    let mut pushed_scope = false;

    match kind {
        "using_directive" => {
            if let Some(name_node) = node.child_by_field_name("name").or_else(|| node.named_child(0))
            {
                let text = node_text(name_node, src);
                if !text.is_empty() && out.usings.len() < 128 {
                    out.usings.push(text.to_string());
                }
            }
            return;
        }
        "namespace_declaration" | "file_scoped_namespace_declaration" => {
            if let Some(name_node) = find_name_node(node) {
                let ns = node_text(name_node, src);
                if !ns.is_empty() {
                    let short = ns.rsplit('.').next().unwrap_or(ns);
                    push_symbol(
                        out,
                        short,
                        current_scope(scope),
                        name_node,
                        SymbolKind::Namespace,
                        true,
                        false,
                    );
                    scope.push(short.to_string());
                    pushed_scope = true;
                }
            }
        }
        "class_declaration"
        | "struct_declaration"
        | "interface_declaration"
        | "record_declaration"
        | "enum_declaration" => {
            if let Some(name_node) = find_name_node(node) {
                let name = node_text(name_node, src);
                let sym_kind = match kind {
                    "class_declaration" => SymbolKind::Class,
                    "struct_declaration" => SymbolKind::Struct,
                    "interface_declaration" => SymbolKind::Interface,
                    "record_declaration" => SymbolKind::Record,
                    _ => SymbolKind::Enum,
                };
                let is_partial = has_child_text(node, src, "partial");
                push_symbol(
                    out,
                    name,
                    current_scope(scope),
                    name_node,
                    sym_kind,
                    true,
                    is_partial,
                );
                if !name.is_empty() {
                    scope.push(name.to_string());
                    pushed_scope = true;
                }
            }
        }
        "method_declaration" => {
            if let Some(name_node) = find_name_node(node) {
                let has_body = node.child_by_field_name("body").is_some();
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::Method,
                    has_body,
                    false,
                );
            }
            return; // skip method body internals for speed and memory
        }
        "constructor_declaration" => {
            if let Some(name_node) = find_name_node(node) {
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::Constructor,
                    true,
                    false,
                );
            }
            return;
        }
        "property_declaration" => {
            if let Some(name_node) = find_name_node(node) {
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::Property,
                    true,
                    false,
                );
            }
            return;
        }
        "delegate_declaration" => {
            if let Some(name_node) = find_name_node(node) {
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::Delegate,
                    true,
                    false,
                );
            }
            return;
        }
        "event_declaration" => {
            if let Some(name_node) = find_name_node(node) {
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::Event,
                    true,
                    false,
                );
            }
            return;
        }
        "event_field_declaration" => {
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if child.kind() == "variable_declaration" {
                    let mut c2 = child.walk();
                    for v in child.named_children(&mut c2) {
                        if v.kind() == "variable_declarator" {
                            if let Some(id) = v.child_by_field_name("name").or_else(|| v.named_child(0)) {
                                push_symbol(
                                    out,
                                    node_text(id, src),
                                    current_scope(scope),
                                    id,
                                    SymbolKind::Event,
                                    true,
                                    false,
                                );
                            }
                        }
                    }
                }
            }
            return;
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        walk_csharp(child, src, scope, out, depth + 1);
    }

    if pushed_scope && kind != "file_scoped_namespace_declaration" {
        scope.pop();
    }
}

// ============================================================================
// C / C++ AST Walker
// ============================================================================
fn extract_cpp_declarator_name<'a>(
    node: Node<'a>,
    src: &'a [u8],
    depth: usize,
) -> Option<(Option<String>, String, Node<'a>)> {
    if depth > 16 {
        return None;
    }
    match node.kind() {
        "identifier" | "field_identifier" | "type_identifier" | "destructor_name" => {
            return Some((None, node_text(node, src).to_string(), node));
        }
        "qualified_identifier" => {
            let scope_text = node.child_by_field_name("scope").map(|s| {
                let raw = node_text(s, src);
                raw.rsplit("::").next().unwrap_or(raw).trim().to_string()
            });
            if let Some(name_node) = node.child_by_field_name("name") {
                if let Some((inner_scope, name, anchor)) =
                    extract_cpp_declarator_name(name_node, src, depth + 1)
                {
                    return Some((inner_scope.or(scope_text), name, anchor));
                }
            }
        }
        "function_declarator"
        | "pointer_declarator"
        | "reference_declarator"
        | "parenthesized_declarator"
        | "attributed_declarator" => {
            if let Some(decl) = node.child_by_field_name("declarator") {
                return extract_cpp_declarator_name(decl, src, depth + 1);
            }
            let mut cursor = node.walk();
            for child in node.named_children(&mut cursor) {
                if let Some(found) = extract_cpp_declarator_name(child, src, depth + 1) {
                    return Some(found);
                }
            }
        }
        "template_function" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                return extract_cpp_declarator_name(name_node, src, depth + 1);
            }
        }
        _ => {}
    }
    None
}

fn contains_function_declarator(node: Node, depth: usize) -> bool {
    if depth > 8 {
        return false;
    }
    if node.kind() == "function_declarator" {
        return true;
    }
    if let Some(d) = node.child_by_field_name("declarator") {
        return contains_function_declarator(d, depth + 1);
    }
    false
}

fn walk_cpp(
    node: Node,
    src: &[u8],
    scope: &mut Vec<String>,
    out: &mut ParsedFile,
    depth: usize,
) {
    if depth >= MAX_AST_DEPTH {
        return;
    }

    let kind = node.kind();
    let mut pushed_scope = false;

    match kind {
        "preproc_include" => {
            if let Some(path_node) = node.child_by_field_name("path") {
                let raw = node_text(path_node, src);
                let cleaned = raw
                    .trim_start_matches(['"', '<'])
                    .trim_end_matches(['"', '>'])
                    .trim();
                if !cleaned.is_empty() && out.includes.len() < 128 {
                    out.includes.push(cleaned.to_string());
                }
            }
            return;
        }
        "preproc_def" | "preproc_function_def" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::Macro,
                    true,
                    false,
                );
            }
            return;
        }
        "namespace_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let ns = node_text(name_node, src);
                let short = ns.rsplit("::").next().unwrap_or(ns);
                if !short.is_empty() {
                    push_symbol(
                        out,
                        short,
                        current_scope(scope),
                        name_node,
                        SymbolKind::Namespace,
                        true,
                        false,
                    );
                    scope.push(short.to_string());
                    pushed_scope = true;
                }
            }
        }
        "class_specifier" | "struct_specifier" | "enum_specifier" | "union_specifier" => {
            let has_body = node.child_by_field_name("body").is_some();
            if let Some(name_node) = node.child_by_field_name("name") {
                let raw = node_text(name_node, src);
                let short = raw.rsplit("::").next().unwrap_or(raw).trim();
                let sym_kind = match kind {
                    "class_specifier" => SymbolKind::Class,
                    "enum_specifier" => SymbolKind::Enum,
                    _ => SymbolKind::Struct,
                };
                if !short.is_empty() {
                    push_symbol(
                        out,
                        short,
                        current_scope(scope),
                        name_node,
                        sym_kind,
                        has_body,
                        false,
                    );
                    if has_body {
                        scope.push(short.to_string());
                        pushed_scope = true;
                    }
                }
            }
            if !has_body {
                return;
            }
        }
        "function_definition" => {
            if let Some(decl) = node.child_by_field_name("declarator") {
                if let Some((qual_scope, name, anchor)) = extract_cpp_declarator_name(decl, src, 0) {
                    let effective_scope = qual_scope.unwrap_or_else(|| current_scope(scope));
                    let sym_kind = if effective_scope.is_empty() {
                        SymbolKind::Function
                    } else {
                        SymbolKind::Method
                    };
                    push_symbol(out, &name, effective_scope, anchor, sym_kind, true, false);
                }
            }
            return; // skip function body internals
        }
        "declaration" | "field_declaration" => {
            if let Some(decl) = node.child_by_field_name("declarator") {
                if contains_function_declarator(decl, 0) {
                    if let Some((qual_scope, name, anchor)) =
                        extract_cpp_declarator_name(decl, src, 0)
                    {
                        let effective_scope = qual_scope.unwrap_or_else(|| current_scope(scope));
                        let sym_kind = if effective_scope.is_empty() {
                            SymbolKind::Function
                        } else {
                            SymbolKind::Method
                        };
                        push_symbol(out, &name, effective_scope, anchor, sym_kind, false, false);
                    }
                    return;
                }
            }
        }
        "type_definition" => {
            if let Some(decl) = node.child_by_field_name("declarator") {
                if let Some((_, name, anchor)) = extract_cpp_declarator_name(decl, src, 0) {
                    push_symbol(
                        out,
                        &name,
                        current_scope(scope),
                        anchor,
                        SymbolKind::TypeAlias,
                        true,
                        false,
                    );
                }
            }
        }
        "alias_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::TypeAlias,
                    true,
                    false,
                );
            }
            return;
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        walk_cpp(child, src, scope, out, depth + 1);
    }

    if pushed_scope {
        scope.pop();
    }
}

// ============================================================================
// TypeScript / JavaScript AST Walker
// ============================================================================
fn walk_typescript(
    node: Node,
    src: &[u8],
    scope: &mut Vec<String>,
    out: &mut ParsedFile,
    depth: usize,
) {
    if depth >= MAX_AST_DEPTH {
        return;
    }

    let kind = node.kind();
    let mut pushed_scope = false;

    match kind {
        "class_declaration" | "abstract_class_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, src);
                push_symbol(
                    out,
                    name,
                    current_scope(scope),
                    name_node,
                    SymbolKind::Class,
                    true,
                    false,
                );
                if !name.is_empty() {
                    scope.push(name.to_string());
                    pushed_scope = true;
                }
            }
        }
        "interface_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, src);
                push_symbol(
                    out,
                    name,
                    current_scope(scope),
                    name_node,
                    SymbolKind::Interface,
                    true,
                    false,
                );
            }
            return;
        }
        "type_alias_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::TypeAlias,
                    true,
                    false,
                );
            }
            return;
        }
        "enum_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::Enum,
                    true,
                    false,
                );
            }
            return;
        }
        "function_declaration" | "generator_function_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                push_symbol(
                    out,
                    node_text(name_node, src),
                    current_scope(scope),
                    name_node,
                    SymbolKind::Function,
                    true,
                    false,
                );
            }
            return;
        }
        "method_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, src);
                let sym_kind = if name == "constructor" {
                    SymbolKind::Constructor
                } else {
                    SymbolKind::Method
                };
                push_symbol(
                    out,
                    name,
                    current_scope(scope),
                    name_node,
                    sym_kind,
                    true,
                    false,
                );
            }
            return;
        }
        "variable_declarator" => {
            if let (Some(name_node), Some(val_node)) = (
                node.child_by_field_name("name"),
                node.child_by_field_name("value"),
            ) {
                if name_node.kind() == "identifier" {
                    let vk = val_node.kind();
                    if matches!(vk, "arrow_function" | "function_expression")
                        || (vk == "call_expression"
                            && node_text(val_node, src).starts_with("React.memo"))
                    {
                        push_symbol(
                            out,
                            node_text(name_node, src),
                            current_scope(scope),
                            name_node,
                            SymbolKind::Function,
                            true,
                            false,
                        );
                        return;
                    }
                }
            }
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        walk_typescript(child, src, scope, out, depth + 1);
    }

    if pushed_scope {
        scope.pop();
    }
}

// ============================================================================
// Rust AST Walker
// ============================================================================
fn walk_rust(
    node: Node,
    src: &[u8],
    scope: &mut Vec<String>,
    out: &mut ParsedFile,
    depth: usize,
) {
    if depth >= MAX_AST_DEPTH {
        return;
    }

    let kind = node.kind();
    let mut pushed_scope = false;

    match kind {
        "struct_item" | "enum_item" | "trait_item" | "type_item" | "mod_item" | "const_item"
        | "macro_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = node_text(name_node, src);
                let sym_kind = match kind {
                    "struct_item" => SymbolKind::Struct,
                    "enum_item" => SymbolKind::Enum,
                    "trait_item" => SymbolKind::Trait,
                    "type_item" => SymbolKind::TypeAlias,
                    "mod_item" => SymbolKind::Module,
                    "const_item" => SymbolKind::Constant,
                    _ => SymbolKind::Macro,
                };
                push_symbol(
                    out,
                    name,
                    current_scope(scope),
                    name_node,
                    sym_kind,
                    true,
                    false,
                );
                if matches!(kind, "mod_item" | "trait_item") && !name.is_empty() {
                    scope.push(name.to_string());
                    pushed_scope = true;
                } else {
                    return;
                }
            }
        }
        "impl_item" => {
            if let Some(ty_node) = node.child_by_field_name("type") {
                if let Some(ty_name) = first_identifier_text(ty_node, src) {
                    scope.push(ty_name.to_string());
                    pushed_scope = true;
                }
            }
        }
        "function_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let sc = current_scope(scope);
                let sym_kind = if sc.is_empty() {
                    SymbolKind::Function
                } else {
                    SymbolKind::Method
                };
                push_symbol(
                    out,
                    node_text(name_node, src),
                    sc,
                    name_node,
                    sym_kind,
                    true,
                    false,
                );
            }
            return;
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.named_children(&mut cursor) {
        walk_rust(child, src, scope, out, depth + 1);
    }

    if pushed_scope {
        scope.pop();
    }
}
