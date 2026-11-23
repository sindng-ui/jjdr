use thiserror::Error;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub const MAX_FRAME_PAYLOAD: usize = 16 * 1024 * 1024;
pub const RPC_CHANNEL: u32 = 0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameKind {
    Data = 0,
    Credit = 1,
    Close = 2,
    Resize = 3,
    Focus = 4,
    Facts = 5,
    AutomaticInput = 6,
}

impl FrameKind {
    pub fn from_u8(v: u8) -> Result<Self, ProtocolError> {
        match v {
            0 => Ok(Self::Data),
            1 => Ok(Self::Credit),
            2 => Ok(Self::Close),
            3 => Ok(Self::Resize),
            4 => Ok(Self::Focus),
            5 => Ok(Self::Facts),
            6 => Ok(Self::AutomaticInput),
            other => Err(ProtocolError::UnknownFrameKind(other)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub channel: u32,
    pub kind: FrameKind,
    pub payload: Vec<u8>,
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("unknown frame kind: {0}")]
    UnknownFrameKind(u8),
    #[error("frame payload too large: {0} bytes")]
    PayloadTooLarge(usize),
}

impl Frame {
    pub fn data(channel: u32, payload: Vec<u8>) -> Self {
        Self {
            channel,
            kind: FrameKind::Data,
            payload,
        }
    }

    pub fn credit(channel: u32, bytes_consumed: u32) -> Self {
        Self {
            channel,
            kind: FrameKind::Credit,
            payload: bytes_consumed.to_le_bytes().to_vec(),
        }
    }

    pub fn close(channel: u32) -> Self {
        Self {
            channel,
            kind: FrameKind::Close,
            payload: Vec::new(),
        }
    }

    pub fn resize(channel: u32, cols: u16, rows: u16) -> Self {
        let mut payload = Vec::with_capacity(4);
        payload.extend_from_slice(&cols.to_le_bytes());
        payload.extend_from_slice(&rows.to_le_bytes());
        Self {
            channel,
            kind: FrameKind::Resize,
            payload,
        }
    }

    pub fn focus(channel: u32, focused: bool) -> Self {
        Self {
            channel,
            kind: FrameKind::Focus,
            payload: vec![if focused { 1 } else { 0 }],
        }
    }
}

pub async fn write_frame<W: AsyncWrite + Unpin>(
    writer: &mut W,
    frame: &Frame,
) -> Result<(), ProtocolError> {
    if frame.payload.len() > MAX_FRAME_PAYLOAD {
        return Err(ProtocolError::PayloadTooLarge(frame.payload.len()));
    }
    let mut header = [0u8; 9];
    header[0..4].copy_from_slice(&frame.channel.to_le_bytes());
    header[4] = frame.kind as u8;
    header[5..9].copy_from_slice(&(frame.payload.len() as u32).to_le_bytes());
    writer.write_all(&header).await?;
    if !frame.payload.is_empty() {
        writer.write_all(&frame.payload).await?;
    }
    writer.flush().await?;
    Ok(())
}

pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Frame, ProtocolError> {
    let mut header = [0u8; 9];
    reader.read_exact(&mut header).await?;
    let channel = u32::from_le_bytes([header[0], header[1], header[2], header[3]]);
    let kind = FrameKind::from_u8(header[4])?;
    let len = u32::from_le_bytes([header[5], header[6], header[7], header[8]]) as usize;
    if len > MAX_FRAME_PAYLOAD {
        return Err(ProtocolError::PayloadTooLarge(len));
    }
    let mut payload = vec![0u8; len];
    if len > 0 {
        reader.read_exact(&mut payload).await?;
    }
    Ok(Frame {
        channel,
        kind,
        payload,
    })
}

/// Strip ANSI CSI / OSC escape sequences for lightweight card preview lines.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b {
            i += 1;
            if i >= bytes.len() {
                break;
            }
            match bytes[i] {
                b'[' => {
                    // CSI sequence
                    i += 1;
                    while i < bytes.len() && !(0x40..=0x7e).contains(&bytes[i]) {
                        i += 1;
                    }
                    if i < bytes.len() {
                        i += 1;
                    }
                }
                b']' => {
                    // OSC sequence terminated by BEL or ST (ESC \)
                    i += 1;
                    while i < bytes.len() {
                        if bytes[i] == 0x07 {
                            i += 1;
                            break;
                        }
                        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                }
                _ => {
                    i += 1;
                }
            }
        } else {
            let ch = input[i..].chars().next().unwrap();
            if ch != '\r' {
                out.push(ch);
            }
            i += ch.len_utf8();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::duplex;

    #[tokio::test]
    async fn frame_roundtrip_all_kinds() {
        let (mut tx, mut rx) = duplex(64 * 1024);
        let frames = vec![
            Frame::data(0, br#"{"jsonrpc":"2.0","id":1}"#.to_vec()),
            Frame::credit(3, 8192),
            Frame::resize(7, 120, 40),
            Frame::focus(7, true),
            Frame::close(7),
        ];

        for f in &frames {
            write_frame(&mut tx, f).await.unwrap();
        }
        drop(tx);

        for expected in frames {
            let got = read_frame(&mut rx).await.unwrap();
            assert_eq!(got, expected);
        }
    }

    #[tokio::test]
    async fn frame_large_payload_roundtrip() {
        let (mut tx, mut rx) = duplex(128 * 1024);
        let payload = vec![0xAB; 65_536];
        let f = Frame::data(42, payload.clone());
        let writer = tokio::spawn(async move {
            write_frame(&mut tx, &f).await.unwrap();
        });
        let got = read_frame(&mut rx).await.unwrap();
        writer.await.unwrap();
        assert_eq!(got.channel, 42);
        assert_eq!(got.kind, FrameKind::Data);
        assert_eq!(got.payload, payload);
    }

    #[test]
    fn strip_ansi_removes_csi_and_osc() {
        let raw = "\x1b[32mPASS\x1b[0m \x1b]7501;state=done\x07hello\r\n";
        assert_eq!(strip_ansi(raw), "PASS hello\n");
    }

    #[test]
    fn smart_preview_filters_tui_chrome_and_keeps_answer() {
        let sample = "\
  ████   Antigravity CLI 1.5.15
  ████   simjaejun@gmail.com (Google AI Pro)
         Gemini 3.8 Flash (Medium)
         K:/Antigravity_Projects/gitbase/happytext
──────────────────────────────────────────────
> 현재 브랜치 이름을 말해라

● Ran 2 commands (git branch: failed) (ctrl+o to expand)

형님, 현재 작업 중인 브랜치는 main 브랜치입니다!
──────────────────────────────────────────────
> 
──────────────────────────────────────────────
? for shortcuts
auto · Gemini 3.8 Flash · medium
";
        let lines = extract_smart_preview_lines(sample, 6);
        assert!(lines.iter().any(|l| l.contains("현재 브랜치 이름을 말해라")));
        assert!(lines.iter().any(|l| l.contains("main 브랜치입니다")));
        assert!(!lines.iter().any(|l| l.contains("? for shortcuts")));
        assert!(!lines.iter().any(|l| l.contains("auto · Gemini")));
    }
}

/// Extract meaningful conversation/output lines from interactive AI CLI TUIs
/// by stripping ANSI codes, box-drawing dividers, empty prompts, and footer status bars.
pub fn extract_smart_preview_lines(raw_text: &str, max_lines: usize) -> Vec<String> {
    let clean = strip_ansi(raw_text);
    let mut meaningful = Vec::<String>::new();
    let mut fallback = Vec::<String>::new();

    for raw_line in clean.lines() {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            continue;
        }
        fallback.push(trimmed.to_string());

        if is_tui_chrome_line(trimmed) {
            continue;
        }
        meaningful.push(trimmed.to_string());
    }

    let source = if meaningful.is_empty() {
        &fallback
    } else {
        &meaningful
    };
    let start = source.len().saturating_sub(max_lines);
    source[start..].to_vec()
}

fn is_tui_chrome_line(line: &str) -> bool {
    // 1. Pure divider / box-drawing / block-art lines (e.g. ────────, ████)
    let has_text_char = line.chars().any(|c| {
        c.is_alphanumeric()
            && !matches!(
                c,
                '─' | '━' | '═' | '│' | '┃' | '┌' | '┐' | '└' | '┘' | '╭' | '╮' | '╰' | '╯'
            )
    });
    if !has_text_char {
        return true;
    }

    // 2. Empty interactive prompt markers (">", "❯", "›", "$")
    let stripped_prompt = line.trim_matches(|c: char| {
        c.is_whitespace() || matches!(c, '>' | '❯' | '›' | '»' | '$' | '│' | '┃')
    });
    if stripped_prompt.is_empty() {
        return true;
    }

    // 3. Common AI CLI TUI footer/hint/status bars (agy, claude, gemini, codex)
    let lower = line.to_lowercase();
    if lower.contains("? for shortcuts")
        || lower.contains("for shortcuts")
        || lower.contains("shift+tab")
        || lower.contains("esc to interrupt")
        || lower.contains("esc to dismiss")
        || lower.contains("ctrl+c to exit")
        || lower.contains("type your message")
        || lower.contains("bypass permissions on")
        || lower.contains("yolo mode")
        || lower.starts_with("auto · ")
        || lower.starts_with("plan · ")
        || lower.starts_with("accept-edits · ")
        || lower.contains("ai: out of credit")
        || lower.contains("antigravity cli ")
        || lower.contains("(google ai pro)")
    {
        return true;
    }

    // 4. Lines dominated by block-art logo characters (e.g. "████  Antigravity...")
    let block_count = line
        .chars()
        .filter(|c| matches!(c, '█' | '▀' | '▄' | '▌' | '▐' | '░' | '▒' | '▓' | '■' | '□'))
        .count();
    if block_count >= 3 {
        return true;
    }

    false
}
