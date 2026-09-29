use super::*;
use std::time::Duration;

#[tokio::test]
async fn test_quic_imposter_client_rejected() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let std_sock_server = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind server udp");
        let std_sock_client = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind client udp");
        let server_addr = std_sock_server.local_addr().expect("server addr");

        let cert_server = generate_ephemeral_cert().expect("cert server");
        let cert_client_real = generate_ephemeral_cert().expect("cert client real");
        let cert_client_imposter = generate_ephemeral_cert().expect("cert client imposter");

        let endpoint_server = create_quic_endpoint(
            std_sock_server,
            &cert_server,
            &cert_client_real.cert_der,
            true,
        )
        .expect("create server endpoint");

        let endpoint_client = create_quic_endpoint(
            std_sock_client,
            &cert_client_imposter,
            &cert_server.cert_der,
            false,
        )
        .expect("create client endpoint");

        let (notify_tx, notify_rx) = tokio::sync::oneshot::channel::<()>();

        let client_fut = async {
            let connecting = endpoint_client.connect(server_addr, "ferryx-direct").expect("connect call");
            if let Ok(conn) = connecting.await {
                tokio::select! {
                    _ = conn.closed() => {}
                    _ = notify_rx => {}
                }
            }
        };

        let server_fut = async {
            let incoming = endpoint_server.accept().await.expect("incoming on server");
            let server_res = incoming.await;
            assert!(server_res.is_err(), "server must reject imposter client certificate");
            let err = server_res.unwrap_err();
            match err {
                quinn::ConnectionError::TransportError(te) => {
                    let code = u64::from(te.code);
                    assert!(
                        code >= 0x0100
                            || te.to_string().to_lowercase().contains("crypto")
                            || te.to_string().to_lowercase().contains("certificate"),
                        "must be TLS crypto error: {te:?}"
                    );
                }
                quinn::ConnectionError::ConnectionClosed(_) => {}
                other => panic!("unexpected error variant: {other:?}"),
            }
            let _ = notify_tx.send(());
        };

        tokio::join!(client_fut, server_fut);

        endpoint_server.close(0u32.into(), b"done");
        endpoint_client.close(0u32.into(), b"done");
    })
    .await
    .expect("test timeout");
}

#[tokio::test]
async fn test_quic_imposter_server_rejected() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let std_sock_server = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind server udp");
        let std_sock_client = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind client udp");
        let server_addr = std_sock_server.local_addr().expect("server addr");

        let cert_server_real = generate_ephemeral_cert().expect("cert server real");
        let cert_server_imposter = generate_ephemeral_cert().expect("cert server imposter");
        let cert_client = generate_ephemeral_cert().expect("cert client");

        let endpoint_server = create_quic_endpoint(
            std_sock_server,
            &cert_server_imposter,
            &cert_client.cert_der,
            true,
        )
        .expect("create server endpoint");

        let endpoint_client = create_quic_endpoint(
            std_sock_client,
            &cert_client,
            &cert_server_real.cert_der,
            false,
        )
        .expect("create client endpoint");

        let client_fut = async {
            let connecting = endpoint_client.connect(server_addr, "ferryx-direct").expect("connect call");
            let res = connecting.await;
            assert!(res.is_err(), "client must reject imposter server certificate");
            let err = res.unwrap_err();
            match err {
                quinn::ConnectionError::TransportError(te) => {
                    let code = u64::from(te.code);
                    assert!(
                        code >= 0x0100
                            || te.to_string().to_lowercase().contains("crypto")
                            || te.to_string().to_lowercase().contains("certificate"),
                        "must be TLS crypto error: {te:?}"
                    );
                }
                quinn::ConnectionError::ConnectionClosed(_) => {}
                other => panic!("unexpected error variant: {other:?}"),
            }
        };

        let server_fut = async {
            if let Some(incoming) = endpoint_server.accept().await {
                let _ = incoming.await;
            }
        };

        tokio::join!(client_fut, server_fut);

        endpoint_server.close(0u32.into(), b"done");
        endpoint_client.close(0u32.into(), b"done");
    })
    .await
    .expect("test timeout");
}

#[tokio::test]
async fn test_quic_mutual_pinned_handshake_success() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let std_sock_server = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind server udp");
        let std_sock_client = std::net::UdpSocket::bind("127.0.0.1:0").expect("bind client udp");
        let server_addr = std_sock_server.local_addr().expect("server addr");

        let cert_server = generate_ephemeral_cert().expect("cert server");
        let cert_client = generate_ephemeral_cert().expect("cert client");

        let endpoint_server = create_quic_endpoint(
            std_sock_server,
            &cert_server,
            &cert_client.cert_der,
            true,
        )
        .expect("create server endpoint");

        let endpoint_client = create_quic_endpoint(
            std_sock_client,
            &cert_client,
            &cert_server.cert_der,
            false,
        )
        .expect("create client endpoint");

        let client_fut = async {
            endpoint_client
                .connect(server_addr, "ferryx-direct")
                .map_err(|e| e.to_string())?
                .await
                .map_err(|e| e.to_string())
        };

        let server_fut = async {
            let incoming = endpoint_server
                .accept()
                .await
                .ok_or_else(|| "server closed".to_string())?;
            incoming.await.map_err(|e| e.to_string())
        };

        let (conn_client, conn_server) = tokio::try_join!(client_fut, server_fut).expect("handshake");

        assert_eq!(conn_client.remote_address(), server_addr);
        assert_eq!(conn_server.remote_address(), endpoint_client.local_addr().unwrap());

        endpoint_server.close(0u32.into(), b"done");
        endpoint_client.close(0u32.into(), b"done");
    })
    .await
    .expect("test timeout");
}
