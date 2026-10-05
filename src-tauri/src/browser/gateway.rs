//! Desktop's client for the private loopback gateway of the browser daemon.
//! The readiness record is the only rendezvous. Its token leaves this module
//! only as an Authorization header: never in a URL, log or error message.
use serde_json::Value;
use std::{fs, path::Path, time::Duration};

pub(super) const STOPPED: &str = "Браузер остановлен. Запустите его в настройках Desktop.";

/// A validated `ready.json` written atomically by the daemon.
pub(super) struct Ready {
    port: u16,
    token: String,
    pub instance_id: String,
}

pub(super) fn ready(root: &Path) -> Option<Ready> {
    let value: Value = serde_json::from_slice(&fs::read(root.join("ready.json")).ok()?).ok()?;
    parse_ready(&value)
}

fn parse_ready(value: &Value) -> Option<Ready> {
    let port = u16::try_from(value["port"].as_u64()?)
        .ok()
        .filter(|port| *port != 0)?;
    let token = value["token"].as_str()?;
    if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let instance_id = value["instanceId"].as_str().filter(|id| !id.is_empty())?;
    Some(Ready {
        port,
        token: token.to_owned(),
        instance_id: instance_id.to_owned(),
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Endpoint {
    Health,
    Rpc,
    Stop,
    View,
}

impl Endpoint {
    fn path(self) -> &'static str {
        match self {
            Endpoint::Health => "health",
            Endpoint::Rpc => "rpc",
            Endpoint::Stop => "stop",
            Endpoint::View => "view",
        }
    }
    /// Tool calls may legitimately take a navigation timeout; lifecycle
    /// endpoints must answer quickly or be treated as unavailable.
    fn timeout(self) -> Duration {
        match self {
            Endpoint::Rpc => Duration::from_secs(90),
            Endpoint::Health | Endpoint::Stop | Endpoint::View => Duration::from_secs(3),
        }
    }
}

pub(super) fn request(
    root: &Path,
    endpoint: Endpoint,
    body: Option<&Value>,
) -> Result<Value, String> {
    let ready = ready(root).ok_or(STOPPED)?;
    request_to(&ready, endpoint, body)
}

/// Health of the daemon named by the current readiness record. The record and
/// the answering process must agree on the instance, so a stale record whose
/// port was reused by another daemon is never reported as running.
pub(super) fn health(root: &Path) -> Result<(Ready, Value), String> {
    let ready = ready(root).ok_or(STOPPED)?;
    let value = request_to(&ready, Endpoint::Health, None)?;
    if value["instanceId"].as_str() != Some(ready.instance_id.as_str()) {
        return Err("Браузер перезапущен; повторите подключение.".into());
    }
    Ok((ready, value))
}

fn request_to(ready: &Ready, endpoint: Endpoint, body: Option<&Value>) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(endpoint.timeout())
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("http://127.0.0.1:{}/{}", ready.port, endpoint.path());
    let builder = match body {
        Some(body) => client.post(url).json(body),
        None => client.get(url),
    };
    let response = builder.bearer_auth(&ready.token).send().map_err(|error| {
        if error.is_timeout() && endpoint == Endpoint::Rpc {
            "Браузер не завершил действие за 90 секунд. Проверьте окно браузера и повторите."
        } else {
            "Браузер не отвечает. Перезапустите его в настройках Desktop."
        }
    })?;
    if !response.status().is_success() {
        return Err("Браузер отклонил запрос. Проверьте URL и состояние окна.".into());
    }
    response
        .json()
        .map_err(|_| "Некорректный ответ браузера.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn readiness_requires_port_token_and_instance() {
        let token = "a".repeat(64);
        assert!(parse_ready(&json!({"port": 4100, "token": token, "instanceId": "one"})).is_some());
        for bad in [
            json!({"port": 0, "token": token, "instanceId": "one"}),
            json!({"port": 70000, "token": token, "instanceId": "one"}),
            json!({"port": 4100, "token": "short", "instanceId": "one"}),
            json!({"port": 4100, "token": "z".repeat(64), "instanceId": "one"}),
            json!({"port": 4100, "token": token}),
            json!({"port": 4100, "token": token, "instanceId": ""}),
            json!(["not", "an", "object"]),
        ] {
            assert!(parse_ready(&bad).is_none(), "{bad}");
        }
    }
}
