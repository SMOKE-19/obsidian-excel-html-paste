use std::env;
use std::io::{self, Read, Write};

use serde::Deserialize;

#[cfg(windows)]
use std::ptr::{copy_nonoverlapping, null_mut};

#[cfg(windows)]
use windows_sys::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard,
    RegisterClipboardFormatW, SetClipboardData, CF_OEMTEXT, CF_TEXT, CF_UNICODETEXT,
};
#[cfg(windows)]
use windows_sys::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE,
};

#[cfg_attr(not(windows), allow(dead_code))]
const START_MARKER: &str = "<!--StartFragment-->";
#[cfg_attr(not(windows), allow(dead_code))]
const END_MARKER: &str = "<!--EndFragment-->";

#[derive(Deserialize)]
struct WritePayload {
    html: String,
    #[serde(default)]
    text: String,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let command = env::args().nth(1).ok_or_else(usage)?;

    match command.as_str() {
        "read-html" => {
            let html = read_html()?;
            io::stdout()
                .write_all(html.as_bytes())
                .map_err(|error| error.to_string())?;
            Ok(())
        }
        "write-html" => {
            let mut input = String::new();
            io::stdin()
                .read_to_string(&mut input)
                .map_err(|error| error.to_string())?;
            let payload: WritePayload =
                serde_json::from_str(&input).map_err(|error| error.to_string())?;
            write_html(&payload.html, &payload.text)
        }
        _ => Err(usage()),
    }
}

fn usage() -> String {
    "usage: excel-html-clipboard <read-html|write-html>".to_string()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn ensure_html_document(html: &str) -> String {
    if html.contains(START_MARKER) && html.contains(END_MARKER) {
        return html.to_string();
    }

    let lower = html.to_lowercase();
    if lower.contains("<html") {
        if let (Some(body_open), Some(body_close)) =
            (find_body_open_end(html), lower.find("</body"))
        {
            if body_open <= body_close {
                return format!(
                    "{}{}{}{}{}",
                    &html[..body_open],
                    START_MARKER,
                    &html[body_open..body_close],
                    END_MARKER,
                    &html[body_close..]
                );
            }
        }

        return format!("{START_MARKER}{html}{END_MARKER}");
    }

    format!(
        "<!DOCTYPE html>\r\n<html>\r\n<head><meta charset=\"utf-8\"></head>\r\n<body>\r\n{START_MARKER}{html}{END_MARKER}\r\n</body>\r\n</html>"
    )
}

#[cfg_attr(not(windows), allow(dead_code))]
fn find_body_open_end(html: &str) -> Option<usize> {
    let lower = html.to_lowercase();
    let body_start = lower.find("<body")?;
    let after_body = &lower[body_start..];
    Some(body_start + after_body.find('>')? + 1)
}

#[cfg_attr(not(windows), allow(dead_code))]
fn build_cf_html(html: &str) -> Vec<u8> {
    let html_doc = ensure_html_document(html);
    let start_marker_index =
        html_doc.find(START_MARKER).expect("start marker") + START_MARKER.len();
    let end_marker_index = html_doc.find(END_MARKER).expect("end marker");
    let header_template = "Version:0.9\r\nStartHTML:{start_html:010}\r\nEndHTML:{end_html:010}\r\nStartFragment:{start_fragment:010}\r\nEndFragment:{end_fragment:010}\r\n";
    let placeholder = header_template
        .replace("{start_html:010}", "0000000000")
        .replace("{end_html:010}", "0000000000")
        .replace("{start_fragment:010}", "0000000000")
        .replace("{end_fragment:010}", "0000000000");
    let start_html = placeholder.len();
    let start_fragment = start_html + html_doc[..start_marker_index].len();
    let end_fragment = start_fragment + html_doc[start_marker_index..end_marker_index].len();
    let end_html = start_html + html_doc.len();
    let header = format!(
        "Version:0.9\r\nStartHTML:{start_html:010}\r\nEndHTML:{end_html:010}\r\nStartFragment:{start_fragment:010}\r\nEndFragment:{end_fragment:010}\r\n"
    );

    let mut bytes = header.into_bytes();
    bytes.extend_from_slice(html_doc.as_bytes());
    bytes
}

#[cfg(not(windows))]
fn read_html() -> Result<String, String> {
    Err("native clipboard helper is only supported on Windows".to_string())
}

#[cfg(not(windows))]
fn write_html(_html: &str, _text: &str) -> Result<(), String> {
    Err("native clipboard helper is only supported on Windows".to_string())
}

#[cfg(windows)]
fn read_html() -> Result<String, String> {
    let format = html_format()?;
    let _clipboard = ClipboardGuard::open()?;

    unsafe {
        if IsClipboardFormatAvailable(format) == 0 {
            return Err("HTML Format is not available".to_string());
        }

        let handle = GetClipboardData(format);
        if handle.is_null() {
            return Err("GetClipboardData failed".to_string());
        }

        let size = GlobalSize(handle);
        if size == 0 {
            return Err("HTML Format data is empty".to_string());
        }

        let ptr = GlobalLock(handle);
        if ptr.is_null() {
            return Err("GlobalLock failed".to_string());
        }

        let bytes = std::slice::from_raw_parts(ptr.cast::<u8>(), size);
        let html = decode_html_bytes(bytes);
        GlobalUnlock(handle);
        Ok(html)
    }
}

#[cfg(windows)]
fn write_html(html: &str, text: &str) -> Result<(), String> {
    let format = html_format()?;
    let raw_html = build_cf_html(html);
    let unicode_text = to_wide_null(text);
    let ansi_text = to_ansi_null(text);
    let _clipboard = ClipboardGuard::open()?;

    unsafe {
        if EmptyClipboard() == 0 {
            return Err("EmptyClipboard failed".to_string());
        }

        set_clipboard_bytes(format, &raw_html)?;
        set_clipboard_bytes(CF_UNICODETEXT, wide_as_bytes(&unicode_text))?;
        set_clipboard_bytes(CF_TEXT, &ansi_text)?;
        let _ = set_clipboard_bytes(CF_OEMTEXT, &ansi_text);
    }

    Ok(())
}

#[cfg(windows)]
fn html_format() -> Result<u32, String> {
    let name = to_wide_null("HTML Format");
    unsafe {
        let format = RegisterClipboardFormatW(name.as_ptr());
        if format == 0 {
            Err("RegisterClipboardFormatW failed".to_string())
        } else {
            Ok(format)
        }
    }
}

#[cfg(windows)]
unsafe fn set_clipboard_bytes(format: u32, bytes: &[u8]) -> Result<(), String> {
    let handle = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
    if handle.is_null() {
        return Err("GlobalAlloc failed".to_string());
    }

    let ptr = GlobalLock(handle);
    if ptr.is_null() {
        return Err("GlobalLock failed".to_string());
    }

    copy_nonoverlapping(bytes.as_ptr(), ptr.cast::<u8>(), bytes.len());
    GlobalUnlock(handle);

    if SetClipboardData(format, handle).is_null() {
        return Err("SetClipboardData failed".to_string());
    }

    Ok(())
}

#[cfg(windows)]
fn decode_html_bytes(bytes: &[u8]) -> String {
    let trimmed = trim_nul_bytes(bytes);
    String::from_utf8_lossy(trimmed).into_owned()
}

#[cfg(windows)]
fn trim_nul_bytes(bytes: &[u8]) -> &[u8] {
    let end = bytes
        .iter()
        .rposition(|byte| *byte != 0)
        .map_or(0, |index| index + 1);
    &bytes[..end]
}

#[cfg(windows)]
fn to_wide_null(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn wide_as_bytes(wide: &[u16]) -> &[u8] {
    unsafe { std::slice::from_raw_parts(wide.as_ptr().cast::<u8>(), wide.len() * 2) }
}

#[cfg(windows)]
fn to_ansi_null(text: &str) -> Vec<u8> {
    let mut bytes = text.as_bytes().to_vec();
    bytes.push(0);
    bytes
}

#[cfg(windows)]
struct ClipboardGuard;

#[cfg(windows)]
impl ClipboardGuard {
    fn open() -> Result<Self, String> {
        unsafe {
            if OpenClipboard(null_mut()) == 0 {
                Err("OpenClipboard failed".to_string())
            } else {
                Ok(Self)
            }
        }
    }
}

#[cfg(windows)]
impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            CloseClipboard();
        }
    }
}
