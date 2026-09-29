use super::*;
use axum::{http::StatusCode, routing::post, Json, Router};

fn attempt(base_url: String) -> DirectAttempt {
    DirectAttempt {
        host_id: "host".into(),
        base_url,
        bearer: "token".into(),
        own_machine_id: "client-machine".into(),
        host_machine_id: "host-machine".into(),
        signing_key: SigningKey::from_bytes(&[1; 32]),
        host_key: SigningKey::from_bytes(&[2; 32]).verifying_key(),
    }
}

fn envelope() -> DirectOfferEnvelope {
    let key = SigningKey::from_bytes(&[1; 32]);
    DirectOfferEnvelope {
        version: 1,
        source_machine_id: "client-machine".into(),
        target_machine_id: "host-machine".into(),
        offer: DirectConnectionOffer::new(
            offer_session_id("client-machine", "host-machine"),
            std::net::SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, 4000),
            vec![1; 16],
            [3; 32],
            DirectRole::Initiator,
            &key,
        ),
    }
}

async fn serve(router: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{addr}/host/abc")
}

#[test]
fn offer_url_keeps_relay_host_prefix() {
    let url = offer_url("https://relay.example.com/host/abc").unwrap();
    assert_eq!(url.as_str(), "https://relay.example.com/host/abc/api/v1/direct/offer");
    let trailing = offer_url("https://relay.example.com/host/abc/").unwrap();
    assert_eq!(trailing.path(), "/host/abc/api/v1/direct/offer");
}

#[tokio::test]
async fn older_host_without_the_route_means_unsupported() {
    let base = serve(Router::new()).await;
    let err = post_offer(&reqwest::Client::new(), &attempt(base), &envelope())
        .await
        .unwrap_err();
    assert_eq!(err, DirectConnectError::Unsupported);
}

#[tokio::test]
async fn forbidden_offer_stays_on_relay() {
    let router = Router::new().route(
        "/host/abc/api/v1/direct/offer",
        post(|| async { StatusCode::FORBIDDEN }),
    );
    let base = serve(router).await;
    let err = post_offer(&reqwest::Client::new(), &attempt(base), &envelope())
        .await
        .unwrap_err();
    assert_eq!(err, DirectConnectError::Unsupported);
}

#[tokio::test]
async fn garbage_answer_is_untrusted() {
    let router = Router::new().route(
        "/host/abc/api/v1/direct/offer",
        post(|| async { Json(serde_json::json!({ "version": 1, "answer": "nope" })) }),
    );
    let base = serve(router).await;
    let err = post_offer(&reqwest::Client::new(), &attempt(base), &envelope())
        .await
        .unwrap_err();
    assert_eq!(err, DirectConnectError::Untrusted);
}

#[tokio::test]
async fn unreachable_host_is_a_transport_error() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    let err = post_offer(&reqwest::Client::new(), &attempt(format!("http://{addr}")), &envelope())
        .await
        .unwrap_err();
    assert!(matches!(err, DirectConnectError::Transport(_)));
}
