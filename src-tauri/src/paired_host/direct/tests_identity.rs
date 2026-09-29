use super::*;
use ed25519_dalek::SigningKey;
use rand::rngs::OsRng;
use std::net::{Ipv4Addr, SocketAddrV4};

#[test]
fn test_identity_signature_and_tampering() {
    let mut rng = OsRng;
    let key1 = SigningKey::generate(&mut rng);
    let key2 = SigningKey::generate(&mut rng);

    let endpoint = SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 9000);
    let cert = generate_ephemeral_cert().expect("cert generation should succeed");
    let nonce = [42u8; 32];

    let offer = DirectConnectionOffer::new_at(
        "session-1".to_string(),
        endpoint,
        cert.cert_der.clone(),
        nonce,
        DirectRole::Initiator,
        1_700_000_000_000,
        &key1,
    );

    assert_eq!(offer.issued_at_ms, 1_700_000_000_000);
    assert!(offer.verify(&key1.verifying_key()).is_ok());
    assert_eq!(
        offer.verify(&key2.verifying_key()),
        Err(IdentityVerificationError::InvalidSignature)
    );

    let mut tampered_endpoint = offer.clone();
    tampered_endpoint.public_endpoint = SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 9001);
    assert_eq!(
        tampered_endpoint.verify(&key1.verifying_key()),
        Err(IdentityVerificationError::InvalidSignature)
    );

    let mut tampered_session = offer.clone();
    tampered_session.session_id = "session-2".to_string();
    assert_eq!(
        tampered_session.verify(&key1.verifying_key()),
        Err(IdentityVerificationError::InvalidSignature)
    );

    let mut tampered_nonce = offer.clone();
    tampered_nonce.punch_nonce[0] ^= 0xFF;
    assert_eq!(
        tampered_nonce.verify(&key1.verifying_key()),
        Err(IdentityVerificationError::InvalidSignature)
    );

    let mut tampered_cert = offer.clone();
    tampered_cert.cert_der.push(0xAA);
    assert_eq!(
        tampered_cert.verify(&key1.verifying_key()),
        Err(IdentityVerificationError::InvalidSignature)
    );

    let mut tampered_ts = offer.clone();
    tampered_ts.issued_at_ms += 1000;
    assert_eq!(
        tampered_ts.verify(&key1.verifying_key()),
        Err(IdentityVerificationError::InvalidSignature)
    );

    let auto_offer = DirectConnectionOffer::new(
        "session-1".to_string(),
        endpoint,
        cert.cert_der.clone(),
        nonce,
        DirectRole::Initiator,
        &key1,
    );
    assert!(auto_offer.issued_at_ms > 0);
    assert!(auto_offer.verify(&key1.verifying_key()).is_ok());

    let answer = DirectConnectionAnswer::new(
        "session-1".to_string(),
        endpoint,
        cert.cert_der,
        nonce,
        &key1,
    );

    assert!(answer.verify(&key1.verifying_key()).is_ok());
    assert_eq!(
        answer.verify(&key2.verifying_key()),
        Err(IdentityVerificationError::InvalidSignature)
    );
}

#[test]
fn test_malicious_utf8_serde_no_panic() {
    let bad_json_multibyte = r#"{"sessionId":"s1","publicEndpoint":"127.0.0.1:8080","certDer":[],"punchNonce":"éééééééééééééééééééééééééééééééé","role":"initiator","issuedAtMs":1700000000000,"signature":""}"#;
    let res: Result<DirectConnectionOffer, _> = serde_json::from_str(bad_json_multibyte);
    assert!(res.is_err());

    let bad_json_odd_len = r#"{"sessionId":"s1","publicEndpoint":"127.0.0.1:8080","certDer":[],"punchNonce":"abc","role":"initiator","issuedAtMs":1700000000000,"signature":""}"#;
    let res2: Result<DirectConnectionOffer, _> = serde_json::from_str(bad_json_odd_len);
    assert!(res2.is_err());
}
