use base64::Engine;
use reqwest::{multipart, Url};
use std::time::Duration;

fn endpoint_url(endpoint: &str) -> Result<Url, String> {
    let u = Url::parse(endpoint).map_err(|_| "Некорректный адрес ASR".to_string())?;
    let local = match u.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback() || ip.is_private(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain("localhost")) => true,
        _ => false,
    };
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || !u.path().ends_with("/audio/transcriptions")
        || !(u.scheme() == "https" || (u.scheme() == "http" && local))
    {
        return Err(
            "ASR: используйте HTTPS или HTTP локальной сети и путь /audio/transcriptions".into(),
        );
    }
    Ok(u)
}

async fn transcribe(
    endpoint: String,
    model: String,
    language: String,
    api_key: String,
    audio: String,
    mime: String,
    filename: String,
) -> Result<String, String> {
    let url = endpoint_url(&endpoint)?;
    if model.trim().is_empty()
        || model.len() > 256
        || language.len() > 32
        || api_key.len() > 8192
        || audio.len() > 35_000_000
    {
        return Err("Некорректные параметры ASR или слишком большая запись".into());
    }
    if !["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"].contains(&mime.as_str()) {
        return Err("Неподдерживаемый формат аудио".into());
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(audio)
        .map_err(|_| "Некорректная запись".to_string())?;
    if data.is_empty() || data.len() > 25 * 1024 * 1024 {
        return Err("Запись пуста или превышает 25 МБ".into());
    }
    if filename.len() > 64 || filename.contains(['/', '\\', '\r', '\n']) {
        return Err("Некорректное имя записи".into());
    }
    let part = multipart::Part::bytes(data)
        .file_name(filename)
        .mime_str(&mime)
        .map_err(|_| "Некорректный формат".to_string())?;
    let mut form = multipart::Form::new()
        .part("file", part)
        .text("model", model)
        .text("response_format", "json");
    if !language.trim().is_empty() {
        form = form.text("language", language);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Не удалось создать ASR соединение".to_string())?;
    let mut request = client.post(url).multipart(form);
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "ASR недоступен или превышено время ожидания".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "ASR HTTP {}. Проверьте адрес, модель и ключ.",
            response.status().as_u16()
        ));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "ASR: ответ оборван".to_string())?
    {
        if body.len() + chunk.len() > 1024 * 1024 {
            return Err("Слишком большой ответ ASR".into());
        }
        body.extend_from_slice(&chunk);
    }
    let value: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|_| "ASR должен вернуть JSON с полем text".to_string())?;
    value["text"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| "ASR не вернул распознанный текст".into())
}

#[tauri::command]
pub async fn transcribe_audio(
    window: tauri::WebviewWindow,
    endpoint: String,
    model: String,
    language: String,
    api_key: String,
    audio: String,
    mime: String,
    filename: String,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Недоступно в этом окне".into());
    }
    transcribe(endpoint, model, language, api_key, audio, mime, filename).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn endpoints_are_explicit_and_credentials_cannot_hide_in_urls() {
        for s in [
            "https://asr.example/v1/audio/transcriptions",
            "http://192.168.31.71:8000/v1/audio/transcriptions",
            "http://127.0.0.1:8100/audio/transcriptions",
        ] {
            assert!(endpoint_url(s).is_ok());
        }
        for s in [
            "http://example.com/audio/transcriptions",
            "https://u:p@a.com/audio/transcriptions",
            "https://a.com/audio/transcriptions?key=secret",
            "file:///audio/transcriptions",
            "https://a.com/other",
        ] {
            assert!(endpoint_url(s).is_err());
        }
    }
    #[tokio::test]
    async fn sends_multipart_and_parses_text_with_synthetic_audio() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut data = Vec::new();
            let mut buf = [0; 4096];
            loop {
                let n = stream.read(&mut buf).unwrap();
                data.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&data);
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text[..end]
                        .lines()
                        .find_map(|l| {
                            l.to_lowercase()
                                .strip_prefix("content-length: ")
                                .and_then(|v| v.parse::<usize>().ok())
                        })
                        .unwrap();
                    if data.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let request = String::from_utf8_lossy(&data);
            assert!(request.contains("name=\"model\""));
            assert!(request.contains("name=\"file\""));
            assert!(request.contains("Bearer fixture-key"));
            let body = r#"{"text":"Привет из ASR"}"#;
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        });
        let result = transcribe(
            format!("http://{address}/v1/audio/transcriptions"),
            "whisper-1".into(),
            "ru".into(),
            "fixture-key".into(),
            base64::engine::general_purpose::STANDARD.encode(b"RIFF synthetic test"),
            "audio/wav".into(),
            "dictation.wav".into(),
        )
        .await
        .unwrap();
        assert_eq!(result, "Привет из ASR");
        server.join().unwrap();
    }
}
