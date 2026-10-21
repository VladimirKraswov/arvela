use std::error::Error;

pub(super) fn failure(code: &str, status: Option<u16>) -> String {
    format!(
        "ENKI_HUB_ERROR:{}",
        serde_json::json!({"code": code, "status": status})
    )
}
pub(super) fn http(status: u16, body: &str) -> String {
    let value: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let message = value["error"].as_str().unwrap_or_default();
    let expired = status == 404 && message == "Заявка не найдена."
        || status == 409
            && matches!(
                message,
                "Срок заявки истёк; запрос агенту не отправлен."
                    | "Заявка отменена; запрос агенту не отправлен."
                    | "Заявка завершена. Создайте новую заявку."
            );
    failure(if expired { "lease_expired" } else { "http" }, Some(status))
}
fn tls_error(mut error: &(dyn Error + 'static)) -> bool {
    for _ in 0..16 {
        if error.is::<rustls::Error>() {
            return true;
        }
        if let Some(inner) = error
            .downcast_ref::<std::io::Error>()
            .and_then(std::io::Error::get_ref)
        {
            error = inner;
            continue;
        }
        match error.source() {
            Some(next) => error = next,
            None => break,
        }
    }
    false
}
pub(super) fn transport(error: reqwest::Error) -> String {
    failure(
        if error.is_timeout() {
            "timeout"
        } else if tls_error(&error) {
            "tls"
        } else if error.is_connect() {
            "network"
        } else if error.is_body() {
            "interrupted"
        } else {
            "transport"
        },
        None,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expired_ticket_is_distinct_from_busy_or_routing_conflict() {
        assert!(http(
            409,
            r#"{"error":"Срок заявки истёк; запрос агенту не отправлен."}"#
        )
        .contains("lease_expired"));
        assert!(
            !http(409, r#"{"error":"Другой клиент уже переключает модель."}"#)
                .contains("lease_expired")
        );
        assert!(!http(409, "invalid response").contains("lease_expired"));
    }
    #[test]
    fn tls_is_classified_by_type_and_envelopes_exclude_raw_details() {
        let tls = rustls::Error::InvalidCertificate(rustls::CertificateError::UnknownIssuer);
        let wrapper = std::io::Error::other(tls);
        assert!(tls_error(&wrapper));
        assert!(!tls_error(&std::io::Error::other(
            "invalid peer certificate secret URL"
        )));
        assert_eq!(
            failure("tls", None),
            "ENKI_HUB_ERROR:{\"code\":\"tls\",\"status\":null}"
        );
    }
}
