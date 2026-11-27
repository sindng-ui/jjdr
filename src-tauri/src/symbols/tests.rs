use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use crate::symbols::cache::{load_disk_cache, save_disk_cache};
use crate::symbols::interner::StringInterner;
use crate::symbols::parser::{detect_symbol_lang, ReusableSymbolParser, SymbolLang};
use crate::symbols::ranking::{rank_and_finalize, CandidateSymbol, RankingContext};
use crate::symbols::store::ProjectSymbolIndex;
use crate::symbols::types::{CompactSymbol, FileMetaEntry, SymbolKind, FLAG_IS_DEFINITION};

#[test]
fn parses_csharp_cpp_ts_rust_symbols_accurately() {
    let mut parser = ReusableSymbolParser::new();

    let cs_src = br#"
using System.Collections.Generic;
using Game.Inventory;

namespace Game.Core {
    public partial class PlayerController {
        public int Health { get; set; }
        public PlayerController() {}
        public void TakeDamage(int amount) {}
        public event Action OnDied;
    }
    public record DamageEvent(int Amount);
    public interface IDamageable {
        void TakeDamage(int amount);
    }
}
"#;
    let cs = parser.parse(SymbolLang::CSharp, cs_src);
    let cs_names: Vec<&str> = cs.symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(cs_names.contains(&"PlayerController"));
    assert!(cs_names.contains(&"Health"));
    assert!(cs_names.contains(&"TakeDamage"));
    assert!(cs_names.contains(&"DamageEvent"));
    assert!(cs_names.contains(&"IDamageable"));
    assert!(cs.usings.iter().any(|u| u.contains("Game.Inventory")));
    let partial_cls = cs
        .symbols
        .iter()
        .find(|s| s.name == "PlayerController" && s.kind == SymbolKind::Class)
        .unwrap();
    assert!(partial_cls.is_partial);

    let cpp_src = br#"
#include "engine/Player.h"
#define MAX_HP 100

namespace Engine {
    class Player {
    public:
        void Update(float dt);
    };

    void Player::Update(float dt) {
        int localVar = 0;
    }

    using PlayerId = unsigned long long;
}
"#;
    let cpp = parser.parse(SymbolLang::Cpp, cpp_src);
    assert!(cpp.includes.iter().any(|i| i == "engine/Player.h"));
    assert!(cpp
        .symbols
        .iter()
        .any(|s| s.name == "MAX_HP" && s.kind == SymbolKind::Macro));
    assert!(cpp
        .symbols
        .iter()
        .any(|s| s.name == "Player" && s.kind == SymbolKind::Class && s.is_definition));
    assert!(cpp
        .symbols
        .iter()
        .any(|s| s.name == "Update" && s.scope == "Player" && s.is_definition));
    assert!(cpp
        .symbols
        .iter()
        .any(|s| s.name == "Update" && s.scope == "Player" && !s.is_definition));
    assert!(cpp
        .symbols
        .iter()
        .any(|s| s.name == "PlayerId" && s.kind == SymbolKind::TypeAlias));
    assert!(!cpp.symbols.iter().any(|s| s.name == "localVar"));

    let ts_src = br#"
export interface WidgetProps { id: string; }
export class WidgetEngine {
    renderWidget() {}
}
export const buildWidget = () => {};
"#;
    let ts = parser.parse(SymbolLang::TypeScript, ts_src);
    assert!(ts.symbols.iter().any(|s| s.name == "WidgetProps"));
    assert!(ts.symbols.iter().any(|s| s.name == "WidgetEngine"));
    assert!(ts
        .symbols
        .iter()
        .any(|s| s.name == "renderWidget" && s.scope == "WidgetEngine"));
    assert!(ts.symbols.iter().any(|s| s.name == "buildWidget"));

    let rs_src = br#"
pub struct SymbolEngine {}
impl SymbolEngine {
    pub fn lookup(&self) {}
}
pub trait Indexer {}
"#;
    let rs = parser.parse(SymbolLang::Rust, rs_src);
    assert!(rs.symbols.iter().any(|s| s.name == "SymbolEngine"));
    assert!(rs
        .symbols
        .iter()
        .any(|s| s.name == "lookup" && s.scope == "SymbolEngine"));
    assert!(rs.symbols.iter().any(|s| s.name == "Indexer"));
}

#[test]
fn skips_generated_files() {
    assert!(detect_symbol_lang("obj/Debug/Main.g.cs").is_none());
    assert!(detect_symbol_lang("Forms/Form1.Designer.cs").is_none());
    assert!(detect_symbol_lang("proto/msg.pb.h").is_none());
    assert!(detect_symbol_lang("Source/Actor.generated.h").is_none());
    assert!(detect_symbol_lang("dist/app.min.js").is_none());
    assert_eq!(detect_symbol_lang("src/Player.cs"), Some(SymbolLang::CSharp));
    assert_eq!(detect_symbol_lang("src/Player.cpp"), Some(SymbolLang::Cpp));
    assert_eq!(detect_symbol_lang("src/App.tsx"), Some(SymbolLang::Tsx));
    assert_eq!(detect_symbol_lang("src/lib.rs"), Some(SymbolLang::Rust));
}

#[test]
fn disk_cache_roundtrip_preserves_symbols() {
    let tmp = std::env::temp_dir().join(format!("jjdr_sym_cache_test_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let cache_file = tmp.join("test.jjidx");

    let mut interner = StringInterner::new();
    let f_id = interner.intern("src/Player.cs");
    let n_id = interner.intern("TakeDamage");
    let s_id = interner.intern("PlayerController");

    let mut files = HashMap::new();
    files.insert(
        "src/Player.cs".to_string(),
        FileMetaEntry {
            file_id: f_id,
            mtime_secs: 1700000000,
            file_size: 4096,
        },
    );
    let syms = vec![CompactSymbol {
        name_id: n_id,
        file_id: f_id,
        scope_id: s_id,
        line: 42,
        col: 16,
        kind: SymbolKind::Method as u8,
        flags: FLAG_IS_DEFINITION,
    }];

    save_disk_cache(&cache_file, &interner, &files, &syms).unwrap();
    let loaded = load_disk_cache(&cache_file).expect("cache should load");
    assert_eq!(loaded.files.len(), 1);
    assert_eq!(loaded.symbols.len(), 1);
    assert_eq!(loaded.interner.get(loaded.symbols[0].name_id), "TakeDamage");
    assert_eq!(
        loaded.interner.get(loaded.symbols[0].scope_id),
        "PlayerController"
    );
    assert_eq!(loaded.symbols[0].line, 42);

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn ranking_prioritizes_qualifier_and_cpp_pair_definition() {
    let cands = vec![
        CandidateSymbol {
            name: "Update".into(),
            scope: "Enemy".into(),
            kind: SymbolKind::Method,
            relative_path: "src/Enemy.cpp".into(),
            line: 20,
            col: 6,
            is_definition: true,
            is_partial: false,
        },
        CandidateSymbol {
            name: "Update".into(),
            scope: "Player".into(),
            kind: SymbolKind::Method,
            relative_path: "src/Player.h".into(),
            line: 12,
            col: 10,
            is_definition: false,
            is_partial: false,
        },
        CandidateSymbol {
            name: "Update".into(),
            scope: "Player".into(),
            kind: SymbolKind::Method,
            relative_path: "src/Player.cpp".into(),
            line: 45,
            col: 14,
            is_definition: true,
            is_partial: false,
        },
    ];

    let includes = vec!["Player.h".to_string()];
    let ctx = RankingContext {
        current_rel_path: "src/Player.h",
        current_line: 12,
        qualifier: Some("Player"),
        current_includes: &includes,
        current_usings: &[],
    };
    let ranked = rank_and_finalize(cands, &ctx, Path::new("."), 10);
    assert_eq!(ranked[0].relative_path, "src/Player.cpp");
    assert!(ranked[0].is_definition);
}

#[test]
fn stress_synthetic_20k_csharp_and_10k_cpp_memory_budget() {
    let mut parser = ReusableSymbolParser::new();
    let cs_template = br#"
namespace Game.Systems {
    public class EntityService {
        public int Count { get; set; }
        public void Initialize() {}
        public void Update(float dt) {}
        public void Dispose() {}
    }
}
"#;
    let cpp_template = br#"
namespace Engine {
    class RenderNode {
    public:
        void Prepare();
        void Draw();
    };
    void RenderNode::Prepare() {}
    void RenderNode::Draw() {}
}
"#;

    let t0 = Instant::now();
    for _ in 0..500 {
        let _ = parser.parse(SymbolLang::CSharp, cs_template);
        let _ = parser.parse(SymbolLang::Cpp, cpp_template);
    }
    let parse_1k_ms = t0.elapsed().as_millis();

    // 1. 20,000-file C# index (~300,000 symbols)
    let mut cs_interner = StringInterner::with_capacity(60_000);
    let mut cs_files = HashMap::with_capacity(20_000);
    let mut cs_syms = Vec::with_capacity(20_000 * 15);
    for i in 0..20_000u32 {
        let rel = format!("Assets/Scripts/Module{}/Service{}.cs", i / 200, i);
        let cls = format!("Service{}", i);
        let f_id = cs_interner.intern(&rel);
        let s_id = cs_interner.intern(&cls);
        cs_files.insert(
            rel,
            FileMetaEntry {
                file_id: f_id,
                mtime_secs: 1700000000,
                file_size: 2048,
            },
        );
        cs_syms.push(CompactSymbol {
            name_id: s_id,
            file_id: f_id,
            scope_id: 0,
            line: 3,
            col: 18,
            kind: SymbolKind::Class as u8,
            flags: FLAG_IS_DEFINITION,
        });
        for m in [
            "Initialize",
            "Update",
            "LateUpdate",
            "Dispose",
            "GetState",
            "SetState",
            "Validate",
            "Serialize",
            "Reset",
            "OnEnable",
            "OnDisable",
            "HandleEvent",
            "IsReady",
            "Count",
        ] {
            let m_id = cs_interner.intern(m);
            cs_syms.push(CompactSymbol {
                name_id: m_id,
                file_id: f_id,
                scope_id: s_id,
                line: 10,
                col: 12,
                kind: SymbolKind::Method as u8,
                flags: FLAG_IS_DEFINITION,
            });
        }
    }
    let cs_index =
        ProjectSymbolIndex::from_parts("repo_cs".into(), cs_interner, cs_files.len(), cs_syms);
    let cs_ram_mb = cs_index.estimated_ram_bytes as f64 / (1024.0 * 1024.0);

    // 2. 10,000-file C++ index (~120,000 symbols)
    let mut cpp_interner = StringInterner::with_capacity(30_000);
    let mut cpp_files = HashMap::with_capacity(10_000);
    let mut cpp_syms = Vec::with_capacity(10_000 * 12);
    for i in 0..10_000u32 {
        let rel = format!("Source/Engine/Mod{}/Node{}.cpp", i / 100, i);
        let cls = format!("RenderNode{}", i);
        let f_id = cpp_interner.intern(&rel);
        let s_id = cpp_interner.intern(&cls);
        cpp_files.insert(
            rel,
            FileMetaEntry {
                file_id: f_id,
                mtime_secs: 1700000000,
                file_size: 3072,
            },
        );
        cpp_syms.push(CompactSymbol {
            name_id: s_id,
            file_id: f_id,
            scope_id: 0,
            line: 5,
            col: 10,
            kind: SymbolKind::Class as u8,
            flags: FLAG_IS_DEFINITION,
        });
        for m in [
            "Init", "Tick", "Render", "Shutdown", "Bind", "Unbind", "Resize", "Flush",
            "Reset", "Validate", "Destroy",
        ] {
            let m_id = cpp_interner.intern(m);
            cpp_syms.push(CompactSymbol {
                name_id: m_id,
                file_id: f_id,
                scope_id: s_id,
                line: 20,
                col: 8,
                kind: SymbolKind::Method as u8,
                flags: FLAG_IS_DEFINITION,
            });
        }
    }
    let cpp_index =
        ProjectSymbolIndex::from_parts("repo_cpp".into(), cpp_interner, cpp_files.len(), cpp_syms);
    let cpp_ram_mb = cpp_index.estimated_ram_bytes as f64 / (1024.0 * 1024.0);

    println!(
        "[BENCH] 1k real tree-sitter parses: {}ms | C# 20k (300k syms): {:.2} MB | C++ 10k (120k syms): {:.2} MB | Total LRU(2): {:.2} MB",
        parse_1k_ms,
        cs_ram_mb,
        cpp_ram_mb,
        cs_ram_mb + cpp_ram_mb
    );

    assert_eq!(cs_index.symbols.len(), 300_000);
    assert_eq!(cpp_index.symbols.len(), 120_000);
    assert!(cs_ram_mb < 60.0, "C# 20k RAM too high: {:.2} MB", cs_ram_mb);
    assert!(
        cpp_ram_mb < 35.0,
        "C++ 10k RAM too high: {:.2} MB",
        cpp_ram_mb
    );
}
