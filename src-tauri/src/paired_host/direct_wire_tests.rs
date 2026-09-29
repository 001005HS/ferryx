use super::*;
use ed25519_dalek::SigningKey;
use std::net::{Ipv4Addr, SocketAddrV4};

const CLIENT: &str = "client-machine";
const HOST: &str = "host-machine";
const NOW: u64 = 1_800_000_000_000;

fn key(seed: u8) -> SigningKey {
    SigningKey::from_bytes(&[seed; 32])
}

fn endpoint() -> SocketAddrV4 {
    SocketAddrV4::new(Ipv4Addr::new(127, 0, 0, 1), 40_000)
}

fn offer_envelope(signer: &SigningKey, target: &str) -> DirectOfferEnvelope {
    let offer = DirectConnectionOffer::new_at(
        offer_session_id(CLIENT, target),
        endpoint(),
        vec![7; 32],
        [1; 32],
        DirectRole::Initiator,
        NOW,
        signer,
    );
    DirectOfferEnvelope {
        version: 1,
        source_machine_id: CLIENT.into(),
        target_machine_id: target.into(),
        offer,
    }
}

fn answer_for(offer: &DirectConnectionOffer, signer: &SigningKey) -> DirectAnswerEnvelope {
    DirectAnswerEnvelope {
        version: 1,
        answer: DirectConnectionAnswer::new(answer_session_id(offer), endpoint(), vec![9; 32], [2; 32], signer),
    }
}

#[test]
fn valid_offer_names_its_source_for_trust_lookup() {
    let envelope = offer_envelope(&key(1), HOST);
    assert_eq!(check_offer_at(&envelope, HOST, NOW).unwrap(), CLIENT);
    assert!(envelope.offer.verify(&key(1).verifying_key()).is_ok());
}

#[test]
fn host_rejects_offer_signed_by_an_untrusted_client_key() {
    let envelope = offer_envelope(&key(66), HOST);
    check_offer_at(&envelope, HOST, NOW).unwrap();
    assert!(
        envelope.offer.verify(&key(1).verifying_key()).is_err(),
        "offer must verify only against the independently trusted client key"
    );
}

#[test]
fn offer_for_another_machine_is_rejected() {
    let envelope = offer_envelope(&key(1), "other-host");
    assert_eq!(check_offer_at(&envelope, HOST, NOW), Err(WireError::WrongTarget));
}

#[test]
fn stale_or_future_offers_are_rejected() {
    let envelope = offer_envelope(&key(1), HOST);
    assert!(check_offer_at(&envelope, HOST, NOW + MAX_OFFER_SKEW_MS).is_ok());
    assert_eq!(check_offer_at(&envelope, HOST, NOW + MAX_OFFER_SKEW_MS + 1), Err(WireError::Expired));
    assert_eq!(check_offer_at(&envelope, HOST, NOW - MAX_OFFER_SKEW_MS - 1), Err(WireError::Expired));
    let mut tampered = envelope.clone();
    tampered.offer.issued_at_ms = NOW + 1;
    assert!(tampered.offer.verify(&key(1).verifying_key()).is_err(), "timestamp is signed");
}

#[test]
fn envelope_source_must_match_the_signed_session() {
    let mut envelope = offer_envelope(&key(1), HOST);
    envelope.source_machine_id = "impostor".into();
    assert_eq!(check_offer_at(&envelope, HOST, NOW), Err(WireError::Malformed));
}

#[test]
fn responder_role_and_unroutable_endpoints_are_malformed() {
    let mut envelope = offer_envelope(&key(1), HOST);
    envelope.offer.role = DirectRole::Responder;
    assert_eq!(check_offer_at(&envelope, HOST, NOW), Err(WireError::Malformed));
    assert!(!endpoint_is_routable(SocketAddrV4::new(Ipv4Addr::new(1, 2, 3, 4), 0)));
    assert!(!endpoint_is_routable(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 5)));
    assert!(!endpoint_is_routable(SocketAddrV4::new(Ipv4Addr::BROADCAST, 5)));
    assert!(!endpoint_is_routable(SocketAddrV4::new(Ipv4Addr::new(224, 0, 0, 1), 5)));
}

#[test]
fn client_accepts_answer_only_from_trusted_host_for_its_pending_offer() {
    let pending = offer_envelope(&key(1), HOST).offer;
    let answer = answer_for(&pending, &key(2));
    assert_eq!(check_answer(&pending, &answer, &key(2).verifying_key()), Ok(()));
    assert_eq!(
        check_answer(&pending, &answer, &key(3).verifying_key()),
        Err(WireError::BadSignature),
        "wrong host identity"
    );
}

#[test]
fn answer_replayed_against_a_different_offer_is_rejected() {
    let first = offer_envelope(&key(1), HOST).offer;
    let second = offer_envelope(&key(1), HOST).offer;
    assert_ne!(first.session_id, second.session_id, "fresh uuid per offer");
    let answer = answer_for(&first, &key(2));
    assert_eq!(check_answer(&second, &answer, &key(2).verifying_key()), Err(WireError::Malformed));
}
