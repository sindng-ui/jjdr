use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};

use crate::symbols::interner::StringInterner;
use crate::symbols::types::{CompactSymbol, FileMetaEntry};

const CACHE_MAGIC: &[u8; 6] = b"JJIDX\x01";

pub struct LoadedDiskCache {
    pub interner: StringInterner,
    pub files: HashMap<String, FileMetaEntry>,
    pub symbols: Vec<CompactSymbol>,
}

/// Deterministic FNV-1a 64-bit hash for normalized repo paths (no extra crate needed).
pub fn repo_cache_filename(norm_repo_path: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in norm_repo_path.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}.jjidx", hash)
}

pub fn repo_cache_path(cache_dir: &Path, norm_repo_path: &str) -> PathBuf {
    cache_dir.join(repo_cache_filename(norm_repo_path))
}

fn write_u32<W: Write>(w: &mut W, v: u32) -> std::io::Result<()> {
    w.write_all(&v.to_le_bytes())
}

fn write_u16<W: Write>(w: &mut W, v: u16) -> std::io::Result<()> {
    w.write_all(&v.to_le_bytes())
}

fn write_u64<W: Write>(w: &mut W, v: u64) -> std::io::Result<()> {
    w.write_all(&v.to_le_bytes())
}

fn read_u32<R: Read>(r: &mut R) -> std::io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_u16<R: Read>(r: &mut R) -> std::io::Result<u16> {
    let mut b = [0u8; 2];
    r.read_exact(&mut b)?;
    Ok(u16::from_le_bytes(b))
}

fn read_u64<R: Read>(r: &mut R) -> std::io::Result<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

fn read_u8<R: Read>(r: &mut R) -> std::io::Result<u8> {
    let mut b = [0u8; 1];
    r.read_exact(&mut b)?;
    Ok(b[0])
}

/// Atomically persist compact symbol index to disk so subsequent restarts skip unchanged files.
pub fn save_disk_cache(
    path: &Path,
    interner: &StringInterner,
    files: &HashMap<String, FileMetaEntry>,
    symbols: &[CompactSymbol],
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension("jjidx.tmp");
    {
        let file = File::create(&tmp_path)?;
        let mut w = BufWriter::with_capacity(256 * 1024, file);

        w.write_all(CACHE_MAGIC)?;

        // 1. String table
        let strings = interner.strings();
        write_u32(&mut w, strings.len() as u32)?;
        for s in strings {
            let bytes = s.as_bytes();
            write_u32(&mut w, bytes.len() as u32)?;
            w.write_all(bytes)?;
        }

        // 2. File metadata entries
        write_u32(&mut w, files.len() as u32)?;
        for meta in files.values() {
            write_u32(&mut w, meta.file_id)?;
            write_u64(&mut w, meta.mtime_secs)?;
            write_u64(&mut w, meta.file_size)?;
        }

        // 3. CompactSymbol array (20 bytes each)
        write_u32(&mut w, symbols.len() as u32)?;
        for sym in symbols {
            write_u32(&mut w, sym.name_id)?;
            write_u32(&mut w, sym.file_id)?;
            write_u32(&mut w, sym.scope_id)?;
            write_u32(&mut w, sym.line)?;
            write_u16(&mut w, sym.col)?;
            w.write_all(&[sym.kind, sym.flags])?;
        }
        w.flush()?;
    }

    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp_path, path)?;
    Ok(())
}

/// Load a previously saved binary symbol cache. Returns `None` on missing/corrupt/version mismatch.
pub fn load_disk_cache(path: &Path) -> Option<LoadedDiskCache> {
    let file = File::open(path).ok()?;
    let mut r = BufReader::with_capacity(256 * 1024, file);

    let mut magic = [0u8; 6];
    r.read_exact(&mut magic).ok()?;
    if &magic != CACHE_MAGIC {
        return None;
    }

    // 1. String table
    let str_count = read_u32(&mut r).ok()? as usize;
    if str_count > 5_000_000 {
        return None;
    }
    let mut strings = Vec::with_capacity(str_count);
    for _ in 0..str_count {
        let len = read_u32(&mut r).ok()? as usize;
        if len > 4096 {
            return None;
        }
        let mut buf = vec![0u8; len];
        r.read_exact(&mut buf).ok()?;
        let s = String::from_utf8(buf).ok()?;
        strings.push(s);
    }
    let interner = StringInterner::from_strings(strings);

    // 2. File metadata entries
    let file_count = read_u32(&mut r).ok()? as usize;
    if file_count > 500_000 {
        return None;
    }
    let mut files = HashMap::with_capacity(file_count);
    for _ in 0..file_count {
        let file_id = read_u32(&mut r).ok()?;
        let mtime_secs = read_u64(&mut r).ok()?;
        let file_size = read_u64(&mut r).ok()?;
        let rel = interner.get(file_id).to_string();
        if !rel.is_empty() {
            files.insert(
                rel,
                FileMetaEntry {
                    file_id,
                    mtime_secs,
                    file_size,
                },
            );
        }
    }

    // 3. CompactSymbol array
    let sym_count = read_u32(&mut r).ok()? as usize;
    if sym_count > 10_000_000 {
        return None;
    }
    let mut symbols = Vec::with_capacity(sym_count);
    for _ in 0..sym_count {
        let name_id = read_u32(&mut r).ok()?;
        let file_id = read_u32(&mut r).ok()?;
        let scope_id = read_u32(&mut r).ok()?;
        let line = read_u32(&mut r).ok()?;
        let col = read_u16(&mut r).ok()?;
        let kind = read_u8(&mut r).ok()?;
        let flags = read_u8(&mut r).ok()?;
        symbols.push(CompactSymbol {
            name_id,
            file_id,
            scope_id,
            line,
            col,
            kind,
            flags,
        });
    }

    Some(LoadedDiskCache {
        interner,
        files,
        symbols,
    })
}

pub fn measure_disk_cache(cache_dir: &Path) -> (usize, u64) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return (0, 0);
    };
    let mut count = 0usize;
    let mut total = 0u64;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("jjidx") {
            if let Ok(meta) = entry.metadata() {
                count += 1;
                total += meta.len();
            }
        }
    }
    (count, total)
}

pub fn clear_disk_cache_dir(cache_dir: &Path) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext == "jjidx" || ext == "tmp" {
                let _ = fs::remove_file(path);
            }
        }
    }
}
