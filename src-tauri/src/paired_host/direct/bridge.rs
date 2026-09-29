use quinn::{Connection, RecvStream, SendStream};
use std::net::SocketAddr;
use std::sync::Arc;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::Semaphore;
use tokio::task::{JoinHandle, JoinSet};

pub const MAX_CONCURRENT_BRIDGE_STREAMS: usize = 128;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("I/O error during bridge operation: {0}")]
    Io(#[from] std::io::Error),
    #[error("QUIC connection error: {0}")]
    Quic(#[from] quinn::ConnectionError),
    #[error("QUIC stream error: {0}")]
    QuicStream(String),
}

pub fn bridge_quic_connection_to_tcp(
    connection: Connection,
    local_gateway_addr: SocketAddr,
) -> JoinHandle<Result<(), BridgeError>> {
    tokio::spawn(async move {
        let mut join_set = JoinSet::new();
        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_BRIDGE_STREAMS));

        loop {
            while let Some(reaped) = join_set.try_join_next() {
                if let Err(e) = reaped {
                    tracing::debug!("Bridge child stream task ended with error: {e}");
                }
            }

            tokio::select! {
                accept_res = connection.accept_bi() => {
                    match accept_res {
                        Ok((send, recv)) => {
                            let permit = match semaphore.clone().try_acquire_owned() {
                                Ok(p) => p,
                                Err(_) => {
                                    tracing::warn!("Max concurrent direct bridge streams reached, dropping stream");
                                    continue;
                                }
                            };
                            join_set.spawn(async move {
                                let _permit = permit;
                                if let Err(e) = forward_quic_to_tcp(send, recv, local_gateway_addr).await {
                                    tracing::debug!("Error forwarding QUIC to TCP: {e}");
                                }
                            });
                        }
                        Err(e) => {
                            return Err(BridgeError::Quic(e));
                        }
                    }
                }
                Some(task_res) = join_set.join_next(), if !join_set.is_empty() => {
                    if let Err(e) = task_res {
                        tracing::debug!("Bridge child stream task ended with error: {e}");
                    }
                }
            }
        }
    })
}

pub fn bridge_tcp_listener_to_quic(
    listener: TcpListener,
    connection: Connection,
) -> JoinHandle<Result<(), BridgeError>> {
    tokio::spawn(async move {
        let mut join_set = JoinSet::new();
        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_BRIDGE_STREAMS));

        loop {
            while let Some(reaped) = join_set.try_join_next() {
                if let Err(e) = reaped {
                    tracing::debug!("Bridge child stream task ended with error: {e}");
                }
            }

            tokio::select! {
                _ = connection.closed() => {
                    tracing::debug!("QUIC connection closed, stopping TCP bridge listener");
                    break;
                }
                accept_res = listener.accept() => {
                    match accept_res {
                        Ok((tcp_stream, _)) => {
                            let permit = match semaphore.clone().try_acquire_owned() {
                                Ok(p) => p,
                                Err(_) => {
                                    tracing::warn!("Max concurrent direct bridge streams reached, dropping TCP connection");
                                    continue;
                                }
                            };
                            let conn = connection.clone();
                            join_set.spawn(async move {
                                let _permit = permit;
                                if let Err(e) = forward_tcp_to_quic(tcp_stream, conn).await {
                                    tracing::debug!("Error forwarding TCP to QUIC: {e}");
                                }
                            });
                        }
                        Err(e) => {
                            return Err(BridgeError::Io(e));
                        }
                    }
                }
                Some(task_res) = join_set.join_next(), if !join_set.is_empty() => {
                    if let Err(e) = task_res {
                        tracing::debug!("Bridge child stream task ended with error: {e}");
                    }
                }
            }
        }

        Ok(())
    })
}

async fn forward_quic_to_tcp(
    mut send_stream: SendStream,
    mut recv_stream: RecvStream,
    local_gateway_addr: SocketAddr,
) -> Result<(), BridgeError> {
    let tcp_stream = TcpStream::connect(local_gateway_addr).await?;
    let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();

    let quic_to_tcp = async {
        let mut buf = [0u8; 16384];
        loop {
            match recv_stream.read(&mut buf).await {
                Ok(Some(n)) => {
                    tcp_write.write_all(&buf[..n]).await?;
                }
                Ok(None) => {
                    tcp_write.shutdown().await?;
                    break;
                }
                Err(e) => {
                    return Err(BridgeError::QuicStream(e.to_string()));
                }
            }
        }
        Ok::<(), BridgeError>(())
    };

    let tcp_to_quic = async {
        let mut buf = [0u8; 16384];
        loop {
            let n = tcp_read.read(&mut buf).await?;
            if n == 0 {
                let _ = send_stream.finish();
                break;
            }
            send_stream
                .write_all(&buf[..n])
                .await
                .map_err(|e| BridgeError::QuicStream(e.to_string()))?;
        }
        Ok::<(), BridgeError>(())
    };

    tokio::try_join!(quic_to_tcp, tcp_to_quic)?;
    Ok(())
}

async fn forward_tcp_to_quic(
    tcp_stream: TcpStream,
    connection: Connection,
) -> Result<(), BridgeError> {
    let (mut send_stream, mut recv_stream) = connection
        .open_bi()
        .await
        .map_err(|e| BridgeError::QuicStream(e.to_string()))?;
    let (mut tcp_read, mut tcp_write) = tcp_stream.into_split();

    let tcp_to_quic = async {
        let mut buf = [0u8; 16384];
        loop {
            let n = tcp_read.read(&mut buf).await?;
            if n == 0 {
                let _ = send_stream.finish();
                break;
            }
            send_stream
                .write_all(&buf[..n])
                .await
                .map_err(|e| BridgeError::QuicStream(e.to_string()))?;
        }
        Ok::<(), BridgeError>(())
    };

    let quic_to_tcp = async {
        let mut buf = [0u8; 16384];
        loop {
            match recv_stream.read(&mut buf).await {
                Ok(Some(n)) => {
                    tcp_write.write_all(&buf[..n]).await?;
                }
                Ok(None) => {
                    tcp_write.shutdown().await?;
                    break;
                }
                Err(e) => {
                    return Err(BridgeError::QuicStream(e.to_string()));
                }
            }
        }
        Ok::<(), BridgeError>(())
    };

    tokio::try_join!(tcp_to_quic, quic_to_tcp)?;
    Ok(())
}
