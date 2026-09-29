use super::*;
use std::net::SocketAddr;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream, UdpSocket};

#[tokio::test]
async fn test_punch_and_quic_pinned_echo_bridge() {
    tokio::time::timeout(Duration::from_secs(10), async {
        let echo_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind echo listener");
        let echo_addr = echo_listener.local_addr().expect("echo addr");

        let echo_server_task = tokio::spawn(async move {
            let (mut socket, _) = echo_listener.accept().await.expect("accept echo");
            let (mut reader, mut writer) = socket.split();
            let _ = tokio::io::copy(&mut reader, &mut writer).await;
            let _ = writer.shutdown().await;
        });

        let sock_a = UdpSocket::bind("127.0.0.1:0").await.expect("bind sock_a");
        let sock_b = UdpSocket::bind("127.0.0.1:0").await.expect("bind sock_b");

        let addr_a = match sock_a.local_addr().expect("addr a") {
            SocketAddr::V4(v4) => v4,
            _ => panic!("expected v4"),
        };
        let addr_b = match sock_b.local_addr().expect("addr b") {
            SocketAddr::V4(v4) => v4,
            _ => panic!("expected v4"),
        };

        let nonce_a = [1u8; 32];
        let nonce_b = [2u8; 32];

        let punch_a = execute_nonce_punch(&sock_a, addr_b, nonce_a, nonce_b, Duration::from_secs(3));
        let punch_b = execute_nonce_punch(&sock_b, addr_a, nonce_b, nonce_a, Duration::from_secs(3));

        let (res_a, res_b) = tokio::join!(punch_a, punch_b);
        res_a.expect("punch a failed");
        res_b.expect("punch b failed");

        let std_sock_a = sock_a.into_std().expect("sock_a into_std");
        let std_sock_b = sock_b.into_std().expect("sock_b into_std");

        let cert_a = generate_ephemeral_cert().expect("cert_a");
        let cert_b = generate_ephemeral_cert().expect("cert_b");

        let endpoint_a = create_quic_endpoint(std_sock_a, &cert_a, &cert_b.cert_der, true)
            .expect("create endpoint_a");
        let endpoint_b = create_quic_endpoint(std_sock_b, &cert_b, &cert_a.cert_der, false)
            .expect("create endpoint_b");

        let connect_fut = async {
            endpoint_b
                .connect(SocketAddr::V4(addr_a), "ferryx-direct")
                .expect("connect call")
                .await
                .map_err(|e| format!("client connect: {e}"))
        };

        let accept_fut = async {
            let incoming = endpoint_a
                .accept()
                .await
                .ok_or_else(|| "server endpoint closed".to_string())?;
            incoming
                .await
                .map_err(|e| format!("server incoming: {e}"))
        };

        let (conn_b, conn_a) = tokio::try_join!(connect_fut, accept_fut).expect("quic handshake");

        let bridge_handle_a = bridge_quic_connection_to_tcp(conn_a, echo_addr);

        let client_tcp_listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind client listener");
        let client_tcp_addr = client_tcp_listener.local_addr().expect("client tcp addr");
        let bridge_handle_b = bridge_tcp_listener_to_quic(client_tcp_listener, conn_b);

        let mut client_stream = TcpStream::connect(client_tcp_addr)
            .await
            .expect("connect to client tcp bridge");

        let test_payload = b"FERRYX_DIRECT_PUNCH_QUIC_ECHO_DATA";
        client_stream
            .write_all(test_payload)
            .await
            .expect("write payload");
        client_stream
            .shutdown()
            .await
            .expect("client half close");

        let mut received = Vec::new();
        client_stream
            .read_to_end(&mut received)
            .await
            .expect("read echo back");

        assert_eq!(&received, test_payload);

        bridge_handle_a.abort();
        bridge_handle_b.abort();
        let _ = bridge_handle_a.await;
        let _ = bridge_handle_b.await;

        endpoint_a.close(0u32.into(), b"done");
        endpoint_b.close(0u32.into(), b"done");
        echo_server_task.abort();
        let _ = echo_server_task.await;
    })
    .await
    .expect("test timeout");
}
