use serde::{Deserialize, Serialize};

pub const FLAG_IS_DEFINITION: u8 = 1 << 0;
pub const FLAG_IS_PARTIAL: u8 = 1 << 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[repr(u8)]
pub enum SymbolKind {
    Namespace = 1,
    Class = 2,
    Struct = 3,
    Interface = 4,
    Record = 5,
    Enum = 6,
    Method = 7,
    Function = 8,
    Constructor = 9,
    Property = 10,
    Delegate = 11,
    Event = 12,
    TypeAlias = 13,
    Macro = 14,
    Trait = 15,
    Module = 16,
    Constant = 17,
}

impl SymbolKind {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Namespace,
            2 => Self::Class,
            3 => Self::Struct,
            4 => Self::Interface,
            5 => Self::Record,
            6 => Self::Enum,
            7 => Self::Method,
            8 => Self::Function,
            9 => Self::Constructor,
            10 => Self::Property,
            11 => Self::Delegate,
            12 => Self::Event,
            13 => Self::TypeAlias,
            14 => Self::Macro,
            15 => Self::Trait,
            16 => Self::Module,
            17 => Self::Constant,
            _ => Self::Function,
        }
    }
}

/// 20-byte packed symbol record designed for 400k-600k symbols (~10-12 MB raw array).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompactSymbol {
    pub name_id: u32,
    pub file_id: u32,
    pub scope_id: u32,
    pub line: u32,
    pub col: u16,
    pub kind: u8,
    pub flags: u8,
}

impl CompactSymbol {
    #[inline]
    pub fn is_definition(&self) -> bool {
        (self.flags & FLAG_IS_DEFINITION) != 0
    }

    #[inline]
    pub fn is_partial(&self) -> bool {
        (self.flags & FLAG_IS_PARTIAL) != 0
    }
}

#[derive(Debug, Clone)]
pub struct RawSymbol {
    pub name: String,
    pub scope: String,
    pub line: u32,
    pub col: u16,
    pub kind: SymbolKind,
    pub is_definition: bool,
    pub is_partial: bool,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedFile {
    pub symbols: Vec<RawSymbol>,
    pub includes: Vec<String>,
    pub usings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMetaEntry {
    pub file_id: u32,
    pub mtime_secs: u64,
    pub file_size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolMatch {
    pub name: String,
    pub scope: String,
    pub kind: SymbolKind,
    pub relative_path: String,
    pub line: u32,
    pub col: u16,
    pub is_definition: bool,
    pub is_partial: bool,
    pub score: i32,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutlineSymbol {
    pub name: String,
    pub scope: String,
    pub kind: SymbolKind,
    pub line: u32,
    pub col: u16,
    pub is_definition: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolIndexProgress {
    pub project_id: String,
    pub state: String,
    pub indexed_files: usize,
    pub total_files: usize,
    pub symbol_count: usize,
    pub from_cache: bool,
    pub estimated_ram_bytes: u64,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

pub type SymbolIndexStatus = SymbolIndexProgress;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SymbolCacheStats {
    pub ram_projects: usize,
    pub ram_symbols: usize,
    pub ram_estimated_bytes: u64,
    pub disk_cache_files: usize,
    pub disk_cache_bytes: u64,
    pub active_jobs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncludeResolveResult {
    pub relative_path: String,
    pub absolute_path: String,
}
