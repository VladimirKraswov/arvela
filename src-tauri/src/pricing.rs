//! Model price book and USD→RUB rate for usage accounting.
//!
//! DeepSeek publishes per-million token prices with a peak/off-peak schedule in
//! its API docs; no separate JSON price endpoint is known. We therefore try the
//! docs page first and fall back to an embedded snapshot verified by hand, and
//! the frontend always shows where the numbers came from and when they were
//! checked. Closed ledger days are never repriced, so a stale book only affects
//! the unsettled present, not history.

use serde_json::{json, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

fn get(url: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Arvela usage pricing")
        .build()
        .map_err(|_| "Не удалось создать HTTPS-клиент".to_string())?;
    let response = client
        .get(url)
        .send()
        .map_err(|_| "Сеть недоступна: данные цены не получены".to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Ответ сервера цен: HTTP {}", status.as_u16()));
    }
    let body = response
        .text()
        .map_err(|_| "Тело ответа цен не читается".to_string())?;
    if body.len() > 4 * 1024 * 1024 {
        return Err("Ответ сервера цен слишком большой".into());
    }
    Ok(body)
}

/// USD prices per 1M tokens, verified against the official docs page on
/// 2026-10-21. Off-peak is half of peak; peak hours (UTC, Mon–Fri, excluding
/// Chinese public holidays — not modelled) are 01:00–04:00 and 06:00–10:00.
pub fn embedded_price_book() -> Value {
    json!({
        "schema": 1,
        "source": "embedded",
        "checkedAt": 0u64,
        "offPeakFactor": 0.5,
        "peakDays": [1, 2, 3, 4, 5],
        "peakWindows": [{ "startHour": 1, "endHour": 4 }, { "startHour": 6, "endHour": 10 }],
        "models": {
            "flash": {
                "inputCacheHit": { "peak": 0.006, "offPeak": 0.003 },
                "input": { "peak": 0.3, "offPeak": 0.15 },
                "output": { "peak": 1.2, "offPeak": 0.6 }
            },
            "pro": {
                "inputCacheHit": { "peak": 0.044, "offPeak": 0.022 },
                "input": { "peak": 1.32, "offPeak": 0.66 },
                "output": { "peak": 3.96, "offPeak": 1.98 }
            }
        }
    })
}

/// Parse the pricing table from the docs HTML/JS text: after tag stripping the
/// cells appear in a fixed order — cache-hit off-peak (flash, pro), cache-hit
/// peak, cache-miss off/peak, output off/peak. Any deviation aborts parsing so
/// the embedded snapshot stays in charge.
pub fn parse_price_book(text: &str) -> Option<Value> {
    let plain = strip_tags(text);
    let prices: Vec<f64> = plain
        .split('$')
        .skip(1)
        .filter_map(|part| {
            let digits: String = part
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            digits.parse::<f64>().ok()
        })
        .collect();
    // The Search & Fetch table ($0.75 twice) may follow; require the first 12
    // cell values to look like the pricing table and off-peak to be half peak.
    if prices.len() < 12 {
        return None;
    }
    let p = &prices[..12];
    let off_is_half =
        |off: f64, peak: f64| off > 0.0 && peak > 0.0 && (peak / off - 2.0).abs() < 0.01;
    if !(off_is_half(p[0], p[2])
        && off_is_half(p[1], p[3])
        && off_is_half(p[4], p[6])
        && off_is_half(p[5], p[7])
        && off_is_half(p[8], p[10])
        && off_is_half(p[9], p[11]))
    {
        return None;
    }
    let windows = parse_peak_windows(&plain)?;
    let book = embedded_price_book();
    let mut book = book;
    book["source"] = json!("docs");
    book["models"]["flash"]["inputCacheHit"] = json!({ "peak": p[2], "offPeak": p[0] });
    book["models"]["pro"]["inputCacheHit"] = json!({ "peak": p[3], "offPeak": p[1] });
    book["models"]["flash"]["input"] = json!({ "peak": p[6], "offPeak": p[4] });
    book["models"]["pro"]["input"] = json!({ "peak": p[7], "offPeak": p[5] });
    book["models"]["flash"]["output"] = json!({ "peak": p[10], "offPeak": p[8] });
    book["models"]["pro"]["output"] = json!({ "peak": p[11], "offPeak": p[9] });
    book["peakWindows"] = json!(windows);
    Some(book)
}

fn strip_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

/// "Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday"
fn parse_peak_windows(text: &str) -> Option<Vec<Value>> {
    let anchor = text.find("Peak hours are")?;
    let tail = &text[anchor..];
    let end = tail.find('.').unwrap_or(tail.len());
    let sentence = &tail[..end.min(400)];
    let mut windows = Vec::new();
    let bytes = sentence.as_bytes();
    let mut i = 0;
    while i + 4 <= bytes.len() {
        if bytes[i].is_ascii_digit()
            && bytes[i + 1].is_ascii_digit()
            && bytes[i + 2] == b':'
            && bytes[i + 3].is_ascii_digit()
        {
            let start: u32 = sentence[i..i + 2].parse().ok()?;
            // Look for " - HH:MM" right after the window start token.
            let rest = &sentence[i + 5..];
            let dash = rest.find("- ")?;
            let after = &rest[dash + 2..];
            if after.len() < 5
                || !after.as_bytes()[0].is_ascii_digit()
                || !after.as_bytes()[1].is_ascii_digit()
                || after.as_bytes()[2] != b':'
            {
                i += 1;
                continue;
            }
            let finish: u32 = after[0..2].parse().ok()?;
            if start < finish && finish <= 24 {
                windows.push(json!({ "startHour": start, "endHour": finish }));
            }
            i += 12;
        } else {
            i += 1;
        }
    }
    if windows.is_empty() {
        return None;
    }
    Some(windows)
}

fn parse_usd_rate(body: &str) -> Option<f64> {
    let value: Value = serde_json::from_str(body).ok()?;
    if let Some(rate) = value.pointer("/Val/USD/Value").and_then(Value::as_f64) {
        if (0.01..1_000.0).contains(&rate) {
            return Some(rate);
        }
        return None;
    }
    value
        .pointer("/rates/USD")
        .and_then(Value::as_f64)
        .filter(|r| (0.01..1_000.0).contains(r))
}

#[tauri::command]
pub fn fetch_price_book() -> Value {
    let mut book = embedded_price_book();
    let mut problems: Vec<String> = Vec::new();
    match get("https://api-docs.deepseek.com/quick_start/pricing") {
        Ok(html) => match parse_price_book(&html) {
            Some(parsed) => book = parsed,
            None => problems.push("таблица цен на странице документации не распознана".into()),
        },
        Err(error) => problems.push(error),
    }
    book["checkedAt"] = json!(now_ms());
    if !problems.is_empty() {
        book["warning"] = json!(problems.join("; "));
    }
    book
}

#[tauri::command]
pub fn fetch_usd_rate() -> Result<Value, String> {
    let (body, source) = match get("https://www.cbr-xml-daily.ru/daily_json.js") {
        Ok(body) => (body, "cbr"),
        Err(first) => match get("https://open.er-api.com/v6/latest/USD") {
            Ok(body) => (body, "er-api"),
            Err(_) => return Err(first),
        },
    };
    let rate = parse_usd_rate(&body).ok_or("Курс доллара в ответе не распознан")?;
    Ok(json!({ "schema": 1, "source": source, "checkedAt": now_ms(), "rate": rate }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const DOCS_FIXTURE: &str = r#"<html><body>
    <table><tr><td>1M INPUT TOKENS (CACHE HIT)</td><td>OFF-PEAK</td><td>$0.003</td><td>$0.022</td></tr>
    <tr><td>PEAK</td><td>$0.006</td><td>$0.044</td></tr>
    <tr><td>1M INPUT TOKENS (CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td></tr>
    <tr><td>PEAK</td><td>$0.3</td><td>$1.32</td></tr>
    <tr><td>1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.6</td><td>$1.98</td></tr>
    <tr><td>PEAK</td><td>$1.2</td><td>$3.96</td></tr></table>
    <p>(2) Off-peak rates are half of the peak rates. Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays.</p>
    </body></html>"#;

    #[test]
    fn parses_the_docs_pricing_table() {
        let book = parse_price_book(DOCS_FIXTURE).expect("fixture parses");
        assert_eq!(book["source"], "docs");
        assert_eq!(book["models"]["pro"]["input"]["peak"], 1.32);
        assert_eq!(book["models"]["flash"]["output"]["offPeak"], 0.6);
        assert_eq!(book["peakWindows"][1]["startHour"], 6);
    }

    #[test]
    fn rejects_malformed_tables() {
        assert!(parse_price_book("<p>$1 $2 $3</p>").is_none());
        assert!(parse_price_book(&DOCS_FIXTURE.replace("$0.003", "$0.004")).is_none());
        assert!(parse_price_book(&DOCS_FIXTURE.replace("Peak hours are", "No schedule")).is_none());
    }

    #[test]
    fn embedded_book_is_self_consistent() {
        let book = embedded_price_book();
        for model in ["flash", "pro"] {
            for kind in ["input", "inputCacheHit", "output"] {
                let peak = book["models"][model][kind]["peak"].as_f64().unwrap();
                let off = book["models"][model][kind]["offPeak"].as_f64().unwrap();
                assert!(
                    peak > 0.0 && (peak / off - 2.0).abs() < 0.001,
                    "{model}/{kind}"
                );
            }
        }
    }

    #[test]
    fn parses_both_rate_sources() {
        assert_eq!(
            parse_usd_rate(r#"{"Val":{"USD":{"Value":80.5}}}"#).unwrap(),
            80.5
        );
        assert_eq!(parse_usd_rate(r#"{"rates":{"USD":78.25}}"#).unwrap(), 78.25);
        assert!(parse_usd_rate(r#"{"Val":{"USD":{"Value":0}}}"#).is_none());
        assert!(parse_usd_rate("not json").is_none());
    }
}
