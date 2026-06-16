/// Log injection and sensitive data protection utilities.
///
/// Provides functions to sanitize user-controlled data before logging,
/// preventing log injection attacks (ANSI escape codes, newlines, null bytes)
/// and redacting sensitive information (URLs, tokens, credentials).

/// Characters that can be used for log injection attacks.
const LOG_INJECTION_CHARS: &[char] = &[
    '\x00', // null byte
    '\x01', '\x02', '\x03', '\x04', '\x05', '\x06', '\x07', '\x08',
    '\x0b', '\x0c', // vertical tab, form feed
    '\x0e', '\x0f',
    '\x1b', // ESC (start of ANSI sequences)
    '\x7f', // DEL
];

/// Sanitize user-controlled data for safe logging.
///
/// Strips newlines, carriage returns, ANSI escape sequences, null bytes,
/// and other control characters that could be used for log injection.
///
/// # Examples
/// ```no_run
/// use slasshy_downloader_lib::log_sanitizer::sanitize_for_log;
/// let safe = sanitize_for_log("normal text");
/// assert_eq!(safe, "normal text");
///
/// let safe = sanitize_for_log("line1\nline2\rline3");
/// assert_eq!(safe, "line1 line2 line3");
/// ```
pub fn sanitize_for_log(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            // Replace line breaks with space (handle \r\n as single break)
            '\r' => {
                result.push(' ');
                if chars.peek() == Some(&'\n') {
                    chars.next(); // consume \n after \r
                }
            }
            '\n' => {
                result.push(' ');
            }
            // Skip ANSI escape sequences (ESC[...)
            '\x1b' => {
                // Consume the rest of the ANSI sequence
                if chars.peek() == Some(&'[') {
                    chars.next(); // consume '['
                    while let Some(&next) = chars.peek() {
                        if next.is_ascii_alphabetic() || next == 'm' {
                            chars.next(); // consume terminator
                            break;
                        }
                        chars.next(); // consume parameter bytes
                    }
                }
                // Standalone ESC already skipped
            }
            // Strip dangerous control characters
            c if LOG_INJECTION_CHARS.contains(&c) => {
                // Skip
            }
            // Keep printable characters
            c if !c.is_control() => {
                result.push(c);
            }
            // Replace other control characters with placeholder
            _ => {
                result.push('\u{FFFD}'); // Unicode replacement character
            }
        }
    }

    result
}

/// Redact a URL to only show scheme and host.
///
/// Strips path, query parameters, and fragments to prevent leaking
/// sensitive tokens or credentials that may appear in URLs.
///
/// # Examples
/// ```no_run
/// use slasshy_downloader_lib::log_sanitizer::redact_url;
/// let redacted = redact_url("https://example.com/path?token=secret");
/// assert_eq!(redacted, "https://example.com");
///
/// let redacted = redact_url("http://127.0.0.1:8080/stream");
/// assert_eq!(redacted, "http://127.0.0.1:8080");
/// ```
pub fn redact_url(url: &str) -> String {
    // Find the scheme
    let scheme_end = url.find("://");
    if scheme_end.is_none() {
        return "[invalid url]".to_string();
    }
    let scheme_end = scheme_end.unwrap();

    // Find the host part (after scheme://)
    let after_scheme = &url[scheme_end + 3..];

    // Find where host ends (at /, ?, or #)
    let host_end = after_scheme
        .find('/')
        .or_else(|| after_scheme.find('?'))
        .or_else(|| after_scheme.find('#'))
        .unwrap_or(after_scheme.len());

    let host = &after_scheme[..host_end];

    if host.is_empty() {
        return "[invalid url]".to_string();
    }

    format!("{}://{}", &url[..scheme_end], host)
}

/// Patterns that indicate sensitive data in strings.
const SENSITIVE_PATTERNS: &[&str] = &[
    "token",
    "secret",
    "key",
    "password",
    "passwd",
    "pwd",
    "auth",
    "bearer",
    "credential",
    "session",
    "cookie",
    "pin_hash",
    "pin_salt",
    "access_token",
    "refresh_token",
    "id_token",
    "api_key",
    "apikey",
    "private_key",
];

/// Redact sensitive patterns found in key=value pairs.
///
/// Looks for known sensitive key names and replaces their values with `[REDACTED]`.
/// Handles JSON-like `key: value` and query parameter `key=value` formats.
///
/// # Examples
/// ```no_run
/// use slasshy_downloader_lib::log_sanitizer::redact_sensitive;
/// let safe = redact_sensitive("token=abc123&user=test");
/// assert!(safe.contains("[REDACTED]"));
/// assert!(safe.contains("user=test"));
/// ```
pub fn redact_sensitive(input: &str) -> String {
    let mut result = input.to_string();

    for pattern in SENSITIVE_PATTERNS {
        // Handle key=value (query params, env vars)
        let kv_pattern = format!("{}=", pattern);
        if let Some(start) = result.find(&kv_pattern) {
            let value_start = start + kv_pattern.len();
            if value_start < result.len() {
                let after_value = &result[value_start..];
                let value_end = after_value
                    .find('&')
                    .or_else(|| after_value.find(' '))
                    .or_else(|| after_value.find('"'))
                    .or_else(|| after_value.find(','))
                    .or_else(|| after_value.find('}'))
                    .unwrap_or(after_value.len());
                let full_range = start..(value_start + value_end);
                result.replace_range(full_range, &format!("{}[REDACTED]", kv_pattern));
            }
        }

        // Handle "key": "value" (JSON)
        let json_pattern_dq = format!("\"{}\":\"", pattern);
        let json_pattern_sp = format!("\"{}\": \"", pattern);
        for json_pattern in &[json_pattern_dq.as_str(), json_pattern_sp.as_str()] {
            if let Some(start) = result.find(json_pattern) {
                let value_start = start + json_pattern.len();
                if value_start < result.len() {
                    let after_value = &result[value_start..];
                    let value_end = after_value.find('"').unwrap_or(after_value.len());
                    let full_range = start..(value_start + value_end + 1);
                    let replacement = format!("\"{}\":\"[REDACTED]\"", pattern);
                    result.replace_range(full_range, &replacement);
                }
            }
        }
    }

    result
}

/// Combined sanitization: sanitize for log injection and redact sensitive data.
///
/// This is the recommended function for logging any user-controlled or
/// potentially sensitive data.
///
/// # Examples
/// ```no_run
/// use slasshy_downloader_lib::log_sanitizer::safe_log;
/// let safe = safe_log("token=abc\nInjected line");
/// assert!(!safe.contains("\n"));
/// assert!(safe.contains("[REDACTED]"));
/// ```
pub fn safe_log(input: &str) -> String {
    let sanitized = sanitize_for_log(input);
    redact_sensitive(&sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_normal_text() {
        assert_eq!(sanitize_for_log("hello world"), "hello world");
    }

    #[test]
    fn test_sanitize_strips_newlines() {
        let result = sanitize_for_log("line1\nline2\rline3\r\nline4");
        assert_eq!(result, "line1 line2 line3 line4");
    }

    #[test]
    fn test_sanitize_strips_ansi_escape() {
        let result = sanitize_for_log("before\x1b[31mred\x1b[0mafter");
        assert_eq!(result, "beforeredafter");
    }

    #[test]
    fn test_sanitize_strips_null_bytes() {
        let result = sanitize_for_log("hello\x00world");
        assert_eq!(result, "helloworld");
    }

    #[test]
    fn test_sanitize_strips_control_chars() {
        // Characters in LOG_INJECTION_CHARS are stripped entirely
        let result = sanitize_for_log("test\x01\x02\x03\x04\x05\x06\x07\x08end");
        assert_eq!(result, "testend");
    }

    #[test]
    fn test_sanitize_preserves_unicode() {
        let result = sanitize_for_log("héllo wörld 🦀");
        assert_eq!(result, "héllo wörld 🦀");
    }

    #[test]
    fn test_redact_url_basic() {
        assert_eq!(redact_url("https://example.com/path?q=1#frag"), "https://example.com");
    }

    #[test]
    fn test_redact_url_with_port() {
        assert_eq!(redact_url("http://127.0.0.1:8080/stream"), "http://127.0.0.1:8080");
    }

    #[test]
    fn test_redact_url_no_path() {
        assert_eq!(redact_url("https://example.com"), "https://example.com");
    }

    #[test]
    fn test_redact_url_with_query_only() {
        assert_eq!(redact_url("https://example.com?token=abc"), "https://example.com");
    }

    #[test]
    fn test_redact_url_invalid() {
        assert_eq!(redact_url("not-a-url"), "[invalid url]");
    }

    #[test]
    fn test_redact_url_empty_host() {
        assert_eq!(redact_url("https://"), "[invalid url]");
    }

    #[test]
    fn test_redact_sensitive_token() {
        let result = redact_sensitive("token=abc123&user=test");
        assert!(result.contains("token=[REDACTED]"));
        assert!(result.contains("user=test"));
    }

    #[test]
    fn test_redact_sensitive_password() {
        let result = redact_sensitive("password=secret123");
        assert!(result.contains("password=[REDACTED]"));
    }

    #[test]
    fn test_redact_sensitive_api_key_json() {
        let result = redact_sensitive("{\"api_key\": \"sk-12345\"}");
        assert!(result.contains("[REDACTED]"));
        assert!(!result.contains("sk-12345"));
    }

    #[test]
    fn test_redact_sensitive_pin_hash() {
        let result = redact_sensitive("pin_hash=$argon2id$v=19$...");
        assert!(result.contains("pin_hash=[REDACTED]"));
    }

    #[test]
    fn test_redact_sensitive_no_false_positives() {
        let result = redact_sensitive("the message was authentic");
        assert_eq!(result, "the message was authentic");
    }

    #[test]
    fn test_safe_log_combined() {
        let result = safe_log("token=abc\nInjected\x1b[31m line");
        assert!(!result.contains("\n"));
        assert!(!result.contains("\x1b"));
        assert!(result.contains("token=[REDACTED]"));
    }

    #[test]
    fn test_safe_log_empty() {
        assert_eq!(safe_log(""), "");
    }

    #[test]
    fn test_sanitize_all_control_chars() {
        // Test each dangerous control character individually
        for &c in LOG_INJECTION_CHARS {
            let input = format!("before{}after", c);
            let result = sanitize_for_log(&input);
            if c == '\x1b' || c == '\x00' {
                // These are stripped entirely
                assert_eq!(result, "beforeafter", "char {:?} should be stripped", c);
            }
        }
    }
}
