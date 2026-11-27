use std::collections::HashMap;

/// Compact string interner that maps unique strings to `u32` IDs.
/// ID `0` is always reserved for the empty string `""`.
#[derive(Debug, Clone)]
pub struct StringInterner {
    strings: Vec<String>,
    map: HashMap<String, u32>,
    bytes_used: u64,
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
            bytes_used: 0,
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
            bytes_used: 0,
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
        self.bytes_used += owned.len() as u64 + std::mem::size_of::<String>() as u64;
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
        let mut bytes_used = 0u64;
        for (idx, s) in strings.iter().enumerate() {
            bytes_used += s.len() as u64 + std::mem::size_of::<String>() as u64;
            map.insert(s.clone(), idx as u32);
        }
        Self {
            strings,
            map,
            bytes_used,
        }
    }

    /// Approximate heap memory footprint (string table + hash map overhead).
    pub fn estimated_bytes(&self) -> u64 {
        let map_overhead = (self.map.capacity() as u64) * 32;
        self.bytes_used * 2 + map_overhead
    }
}
