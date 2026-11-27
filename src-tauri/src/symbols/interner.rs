use std::collections::{HashMap, HashSet};

/// Compact string interner that maps unique strings to `u32` IDs.
/// ID `0` is always reserved for the empty string `""`.
///
/// After indexing finishes, call `freeze_for_lookup(symbol_name_ids)` to drop all
/// file paths and scope strings from the reverse hash map (avoiding duplicate copies
/// of 20,000+ file paths in RAM) while keeping O(1) lookup for symbol names.
#[derive(Debug, Clone)]
pub struct StringInterner {
    strings: Vec<String>,
    map: HashMap<String, u32>,
    strings_bytes: u64,
    map_bytes: u64,
}

impl Default for StringInterner {
    fn default() -> Self {
        Self::new()
    }
}

impl StringInterner {
    pub fn new() -> Self {
        let mut map = HashMap::new();
        map.insert(String::new(), 0);
        Self {
            strings: vec![String::new()],
            map,
            strings_bytes: 0,
            map_bytes: 0,
        }
    }

    pub fn with_capacity(cap: usize) -> Self {
        let mut strings = Vec::with_capacity(cap.max(1));
        strings.push(String::new());
        let mut map = HashMap::with_capacity(cap.max(1));
        map.insert(String::new(), 0);
        Self {
            strings,
            map,
            strings_bytes: 0,
            map_bytes: 0,
        }
    }

    pub fn intern(&mut self, value: &str) -> u32 {
        if value.is_empty() {
            return 0;
        }
        if let Some(&id) = self.map.get(value) {
            return id;
        }
        let id = self.strings.len() as u32;
        let owned = value.to_string();
        let entry_bytes = owned.len() as u64 + std::mem::size_of::<String>() as u64;
        self.strings_bytes += entry_bytes;
        self.map_bytes += entry_bytes;
        self.strings.push(owned.clone());
        self.map.insert(owned, id);
        id
    }

    #[inline]
    pub fn get(&self, id: u32) -> &str {
        self.strings
            .get(id as usize)
            .map(String::as_str)
            .unwrap_or("")
    }

    #[inline]
    pub fn lookup(&self, value: &str) -> Option<u32> {
        self.map.get(value).copied()
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.strings.len()
    }

    pub fn strings(&self) -> &[String] {
        &self.strings
    }

    /// Reconstruct from an ordered table (index 0 must be "").
    pub fn from_strings(mut strings: Vec<String>) -> Self {
        if strings.is_empty() || !strings[0].is_empty() {
            strings.insert(0, String::new());
        }
        let mut map = HashMap::with_capacity(strings.len());
        let mut total_bytes = 0u64;
        for (idx, s) in strings.iter().enumerate() {
            total_bytes += s.len() as u64 + std::mem::size_of::<String>() as u64;
            map.insert(s.clone(), idx as u32);
        }
        Self {
            strings,
            map,
            strings_bytes: total_bytes,
            map_bytes: total_bytes,
        }
    }

    /// Reclaim ~40% RAM after indexing by retaining ONLY symbol-name IDs in `self.map`
    /// (dropping 20k+ file path & scope duplicates from the reverse lookup hash map)
    /// and shrinking internal capacities to fit.
    pub fn freeze_for_lookup(&mut self, keep_ids: &HashSet<u32>) {
        self.strings.shrink_to_fit();
        self.map.retain(|_, id| keep_ids.contains(id));
        self.map.shrink_to_fit();
        self.map_bytes = self
            .map
            .keys()
            .map(|k| k.len() as u64 + std::mem::size_of::<String>() as u64)
            .sum();
    }

    /// Approximate heap memory footprint (string table + retained reverse map).
    pub fn estimated_bytes(&self) -> u64 {
        let map_overhead = (self.map.capacity() as u64) * 16;
        self.strings_bytes + self.map_bytes + map_overhead
    }
}
