pub mod cache;
pub mod indexer;
pub mod interner;
pub mod parser;
pub mod ranking;
pub mod store;
pub mod types;

#[cfg(test)]
mod tests;

pub use store::SymbolIndexStore;
pub use types::{
    IncludeResolveResult, OutlineSymbol, SymbolCacheStats, SymbolIndexProgress, SymbolIndexStatus,
    SymbolKind, SymbolMatch,
};
