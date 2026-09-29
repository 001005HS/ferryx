use crate::paired_host::direct::{
    bridge_quic_connection_to_tcp, create_quic_endpoint, discover_public_endpoint,
    execute_nonce_punch, BridgeError, DirectConnectionOffer, EphemeralCert,
};
use std::net::{SocketAddr, SocketAddrV4};
use std::time::Duration;
use tokio::net::UdpSocket;
use tokio::task::JoinHandle;
use tokio::time::Instant;

pub(super) async fn discover(socket: &UdpSocket, servers: &[String]) -> Option<SocketAddrV4> {
    let mut resolved = Vec::new();
    for server in servers {
        if let Ok(addrs) = tokio::net::lookup_host(server.as_str()).await {
            resolved.extend(addrs.filter(SocketAddr::is_ipv4));
        }
    }
    discover_public_endpoint(socket, &resolved).await.ok()
}

/// Ties the separately spawned bridge to the manager-owned task's lifetime.
struct AbortOnDrop(JoinHandle<Result<(), BridgeError>>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(super) struct HostJob {
    pub socket: UdpSocket,
    pub cert: EphemeralCert,
    pub local_nonce: [u8; 32],
    pub offer: DirectConnectionOffer,
    pub gateway: SocketAddr,
    pub deadline: Duration,
}

impl HostJob {
    pub async fn run(self) {
        let started = Instant::now();
        let peer = self.offer.public_endpoint;
        if let Err(error) =
            execute_nonce_punch(&self.socket, peer, self.local_nonce, self.offer.punch_nonce, self.deadline).await
        {
            tracing::debug!("direct host punch failed; client stays on relay: {error}");
            return;
        }
        let std_socket = match self.socket.into_std() {
            Ok(socket) => socket,
            Err(error) => {
                tracing::debug!("direct host socket handoff failed: {error}");
                return;
            }
        };
        let endpoint = match create_quic_endpoint(std_socket, &self.cert, &self.offer.cert_der, true) {
            Ok(endpoint) => endpoint,
            Err(error) => {
                tracing::debug!("direct host QUIC endpoint failed: {error}");
                return;
            }
        };
        let remaining = self.deadline.saturating_sub(started.elapsed());
        let connection = tokio::time::timeout(remaining, async {
            loop {
                let incoming = endpoint.accept().await?;
                if incoming.remote_address() != SocketAddr::V4(peer) {
                    incoming.refuse();
                    continue;
                }
                return incoming.await.ok();
            }
        })
        .await;
        let Ok(Some(connection)) = connection else {
            tracing::debug!("direct host QUIC accept timed out or failed");
            endpoint.close(0u32.into(), b"accept failed");
            return;
        };
        let mut bridge = AbortOnDrop(bridge_quic_connection_to_tcp(connection, self.gateway));
        if let Ok(Err(error)) = (&mut bridge.0).await {
            tracing::debug!("direct host bridge ended: {error}");
        }
        endpoint.close(0u32.into(), b"bridge closed");
    }
}
