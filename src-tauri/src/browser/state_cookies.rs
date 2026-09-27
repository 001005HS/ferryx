use crate::browser::BrowserError;
use cookie::{Cookie, SameSite};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedCookie {
    pub name: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default = "default_cookie_path", skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_unix: Option<i64>,
    #[serde(default)]
    pub secure: bool,
    #[serde(default)]
    pub http_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub same_site: Option<String>,
}

fn default_cookie_path() -> Option<String> {
    Some("/".to_string())
}

pub fn derive_cookie_host_from_url(raw_url: &str) -> Result<String, BrowserError> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err(BrowserError::InvalidUrl("saved URL cannot be empty".into()));
    }

    let parsed = url::Url::parse(trimmed)
        .map_err(|e| BrowserError::InvalidUrl(format!("malformed URL '{trimmed}': {e}")))?;

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(BrowserError::InvalidUrl(
            "URLs with embedded credentials are not allowed for cookie restoration".into(),
        ));
    }

    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(BrowserError::InvalidUrl(format!(
            "unsupported scheme '{scheme}' for cookie domain derivation (only http/https supported)"
        )));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| BrowserError::InvalidUrl(format!("URL '{trimmed}' has no host")))?;

    let host = host.trim().trim_start_matches('.');
    if host.is_empty() {
        return Err(BrowserError::InvalidUrl(format!(
            "URL '{trimmed}' resolved to an empty host"
        )));
    }

    Ok(host.to_string())
}

impl PersistedCookie {
    pub fn from_cookie(cookie: &Cookie<'_>) -> Self {
        let domain = cookie.domain().map(|d| d.to_string());
        let path = cookie.path().map(|p| p.to_string());
        let expires_unix = cookie.expires().and_then(|exp| match exp {
            cookie::Expiration::DateTime(dt) => Some(dt.unix_timestamp()),
            cookie::Expiration::Session => None,
        });
        let secure = cookie.secure().unwrap_or(false);
        let http_only = cookie.http_only().unwrap_or(false);
        let same_site = cookie.same_site().map(|s| match s {
            SameSite::Strict => "strict".to_string(),
            SameSite::Lax => "lax".to_string(),
            SameSite::None => "none".to_string(),
        });

        Self {
            name: cookie.name().to_string(),
            value: cookie.value().to_string(),
            domain,
            path,
            expires_unix,
            secure,
            http_only,
            same_site,
        }
    }

    pub fn to_cookie(&self) -> Result<Cookie<'static>, BrowserError> {
        self.to_cookie_with_url_fallback(None)
    }

    pub fn to_cookie_for_url(&self, fallback_url: &str) -> Result<Cookie<'static>, BrowserError> {
        self.to_cookie_with_url_fallback(Some(fallback_url))
    }

    pub fn to_cookie_with_url_fallback(
        &self,
        fallback_url: Option<&str>,
    ) -> Result<Cookie<'static>, BrowserError> {
        let name = self.name.trim().to_string();
        if name.is_empty() {
            return Err(BrowserError::CookieImport(
                "cookie name cannot be empty".into(),
            ));
        }

        let mut builder = Cookie::build((name, self.value.clone()))
            .secure(self.secure)
            .http_only(self.http_only);

        let explicit_domain = self
            .domain
            .as_deref()
            .map(str::trim)
            .filter(|d| !d.is_empty());

        if let Some(domain) = explicit_domain {
            builder = builder.domain(domain.to_string());
        } else if let Some(url) = fallback_url {
            let host = derive_cookie_host_from_url(url)?;
            builder = builder.domain(host);
        }

        if let Some(path) = &self.path {
            if path.starts_with('/') {
                builder = builder.path(path.clone());
            } else {
                builder = builder.path("/".to_string());
            }
        } else {
            builder = builder.path("/".to_string());
        }

        if let Some(expires_unix) = self.expires_unix {
            let dt = OffsetDateTime::from_unix_timestamp(expires_unix).map_err(|e| {
                BrowserError::CookieImport(format!(
                    "invalid cookie expiration timestamp {expires_unix}: {e}"
                ))
            })?;
            builder = builder.expires(dt);
        }

        if let Some(same_site) = self.same_site.as_deref() {
            let parsed = match same_site.to_ascii_lowercase().as_str() {
                "lax" => Some(SameSite::Lax),
                "strict" => Some(SameSite::Strict),
                "none" | "no_restriction" | "no-restriction" => Some(SameSite::None),
                "unspecified" | "" => None,
                other => {
                    return Err(BrowserError::CookieImport(format!(
                        "unsupported SameSite value: {other}"
                    )))
                }
            };
            if let Some(s) = parsed {
                builder = builder.same_site(s);
            }
        }

        Ok(builder.build())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_persisted_cookie_from_to_cookie_round_trip() {
        let original = Cookie::build(("session_id", "s3cret-token-123"))
            .domain("example.com")
            .path("/api")
            .secure(true)
            .http_only(true)
            .same_site(SameSite::Strict)
            .expires(OffsetDateTime::from_unix_timestamp(1_893_456_000).unwrap())
            .build();

        let persisted = PersistedCookie::from_cookie(&original);
        assert_eq!(persisted.name, "session_id");
        assert_eq!(persisted.value, "s3cret-token-123");
        assert_eq!(persisted.domain.as_deref(), Some("example.com"));
        assert_eq!(persisted.path.as_deref(), Some("/api"));
        assert!(persisted.secure);
        assert!(persisted.http_only);
        assert_eq!(persisted.same_site.as_deref(), Some("strict"));
        assert_eq!(persisted.expires_unix, Some(1_893_456_000));

        let restored = persisted.to_cookie().expect("restoring cookie must succeed");
        assert_eq!(restored.name(), "session_id");
        assert_eq!(restored.value(), "s3cret-token-123");
        assert_eq!(restored.domain(), Some("example.com"));
        assert_eq!(restored.path(), Some("/api"));
        assert_eq!(restored.secure(), Some(true));
        assert_eq!(restored.http_only(), Some(true));
        assert_eq!(restored.same_site(), Some(SameSite::Strict));
        assert_eq!(
            restored.expires().and_then(|exp| match exp {
                cookie::Expiration::DateTime(dt) => Some(dt.unix_timestamp()),
                _ => None,
            }),
            Some(1_893_456_000)
        );
    }

    #[test]
    fn test_persisted_cookie_red_mutation_check_attributes() {
        let original = Cookie::build(("theme", "dark"))
            .path("/")
            .secure(false)
            .http_only(false)
            .build();

        let persisted = PersistedCookie::from_cookie(&original);
        assert!(!persisted.secure);
        assert!(!persisted.http_only);
        assert!(persisted.domain.is_none());
        assert!(persisted.expires_unix.is_none());
        assert!(persisted.same_site.is_none());

        let restored = persisted.to_cookie().unwrap();
        assert_eq!(restored.name(), "theme");
        assert_eq!(restored.value(), "dark");
        assert_eq!(restored.secure(), Some(false));
        assert_eq!(restored.http_only(), Some(false));
    }

    #[test]
    fn test_persisted_cookie_deserialization_defaults_path_to_slash() {
        let json = r#"{"name": "foo", "value": "bar"}"#;
        let parsed: PersistedCookie = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.name, "foo");
        assert_eq!(parsed.value, "bar");
        assert_eq!(parsed.path.as_deref(), Some("/"));
        assert!(!parsed.secure);
        assert!(!parsed.http_only);
    }

    #[test]
    fn test_derive_cookie_host_from_url_valid_http_and_https() {
        assert_eq!(
            derive_cookie_host_from_url("https://example.com/login?q=1").unwrap(),
            "example.com"
        );
        assert_eq!(
            derive_cookie_host_from_url("http://sub.domain.org:8080/path").unwrap(),
            "sub.domain.org"
        );
        assert_eq!(
            derive_cookie_host_from_url("https://auth.internal.corp/oauth/token").unwrap(),
            "auth.internal.corp"
        );
        assert_eq!(
            derive_cookie_host_from_url("http://localhost:3000/").unwrap(),
            "localhost"
        );
        assert_eq!(
            derive_cookie_host_from_url("http://127.0.0.1:8000/").unwrap(),
            "127.0.0.1"
        );
    }

    #[test]
    fn test_derive_cookie_host_from_url_no_cross_origin_widening() {
        let host = derive_cookie_host_from_url("https://app.sub.example.com/api/v1").unwrap();
        assert_eq!(host, "app.sub.example.com");
        assert!(!host.starts_with('.'));
        assert_ne!(host, "example.com");
    }

    #[test]
    fn test_derive_cookie_host_from_url_refuses_malformed_and_unsupported() {
        assert!(derive_cookie_host_from_url("").is_err());
        assert!(derive_cookie_host_from_url("   ").is_err());
        assert!(derive_cookie_host_from_url("not_a_valid_url").is_err());
        assert!(derive_cookie_host_from_url("javascript:alert(1)").is_err());
        assert!(derive_cookie_host_from_url("file:///tmp/app.html").is_err());
        assert!(derive_cookie_host_from_url("about:blank").is_err());
        assert!(derive_cookie_host_from_url("data:text/html,hello").is_err());
        assert!(derive_cookie_host_from_url("https://user:pass@example.com/app").is_err());
    }

    #[test]
    fn test_legacy_v1_cookie_fallback_to_url_domain() {
        let legacy = PersistedCookie {
            name: "legacy_session".into(),
            value: "secret_v1".into(),
            domain: None,
            path: Some("/api".into()),
            expires_unix: Some(1_900_000_000),
            secure: true,
            http_only: true,
            same_site: Some("strict".into()),
        };

        let restored = legacy
            .to_cookie_for_url("https://dashboard.example.com:8443/app")
            .expect("fallback to URL host must succeed");

        assert_eq!(restored.name(), "legacy_session");
        assert_eq!(restored.value(), "secret_v1");
        assert_eq!(restored.domain(), Some("dashboard.example.com"));
        assert_eq!(restored.path(), Some("/api"));
        assert_eq!(restored.secure(), Some(true));
        assert_eq!(restored.http_only(), Some(true));
        assert_eq!(restored.same_site(), Some(SameSite::Strict));
        assert_eq!(
            restored.expires().and_then(|exp| match exp {
                cookie::Expiration::DateTime(dt) => Some(dt.unix_timestamp()),
                _ => None,
            }),
            Some(1_900_000_000)
        );
    }

    #[test]
    fn test_legacy_v1_cookie_preserves_explicit_domain_over_url() {
        let cookie_with_domain = PersistedCookie {
            name: "cross_domain".into(),
            value: "shared_val".into(),
            domain: Some("auth.shared.com".into()),
            path: Some("/".into()),
            expires_unix: None,
            secure: false,
            http_only: false,
            same_site: None,
        };

        let restored = cookie_with_domain
            .to_cookie_for_url("https://unrelated.example.com/page")
            .unwrap();

        assert_eq!(restored.domain(), Some("auth.shared.com"));
    }

    #[test]
    fn test_legacy_v1_cookie_refuses_malformed_url_when_domain_absent() {
        let legacy = PersistedCookie {
            name: "tok".into(),
            value: "v".into(),
            domain: None,
            path: Some("/".into()),
            expires_unix: None,
            secure: false,
            http_only: false,
            same_site: None,
        };

        let err = legacy
            .to_cookie_for_url("not-a-valid-url")
            .expect_err("malformed URL must fail domain fallback");
        match err {
            BrowserError::InvalidUrl(_) => {}
            other => panic!("expected BrowserError::InvalidUrl, got: {other:?}"),
        }
    }
}
