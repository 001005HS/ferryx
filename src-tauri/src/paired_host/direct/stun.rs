use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::time::Duration;
use thiserror::Error;
use tokio::net::UdpSocket;

pub const STUN_MAGIC_COOKIE: u32 = 0x2112_a442;
pub const STUN_MAGIC_COOKIE_UPPER_16: u16 = 0x2112;
pub const STUN_BINDING_REQUEST: u16 = 0x0001;
pub const STUN_BINDING_RESPONSE: u16 = 0x0101;
pub const STUN_ATTR_MAPPED_ADDRESS: u16 = 0x0001;
pub const STUN_ATTR_XOR_MAPPED_ADDRESS: u16 = 0x0020;

#[derive(Debug, Error)]
pub enum StunError {
    #[error("I/O error during STUN exchange: {0}")]
    Io(#[from] std::io::Error),
    #[error("STUN transaction timed out")]
    Timeout,
    #[error("No STUN servers responded")]
    NoServersResponded,
    #[error("Invalid STUN packet format: {0}")]
    InvalidPacket(&'static str),
    #[error("Non-IPv4 address returned by STUN server")]
    NonIpv4Address,
    #[error("No mapped address attribute found in STUN response")]
    AddressNotFound,
}

pub fn create_binding_request(transaction_id: [u8; 12]) -> [u8; 20] {
    let mut packet = [0u8; 20];
    packet[0..2].copy_from_slice(&STUN_BINDING_REQUEST.to_be_bytes());
    packet[2..4].copy_from_slice(&0u16.to_be_bytes());
    packet[4..8].copy_from_slice(&STUN_MAGIC_COOKIE.to_be_bytes());
    packet[8..20].copy_from_slice(&transaction_id);
    packet
}

pub fn parse_binding_response(
    buf: &[u8],
    expected_transaction_id: &[u8; 12],
) -> Result<SocketAddrV4, StunError> {
    if buf.len() < 20 {
        return Err(StunError::InvalidPacket("packet shorter than 20 bytes"));
    }

    let msg_type = u16::from_be_bytes([buf[0], buf[1]]);
    if msg_type != STUN_BINDING_RESPONSE {
        return Err(StunError::InvalidPacket("not a binding success response"));
    }

    let msg_len = usize::from(u16::from_be_bytes([buf[2], buf[3]]));
    if buf.len() < 20 + msg_len {
        return Err(StunError::InvalidPacket("truncated STUN message body"));
    }

    let magic = u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]);
    if magic != STUN_MAGIC_COOKIE {
        return Err(StunError::InvalidPacket("invalid magic cookie"));
    }

    if &buf[8..20] != expected_transaction_id {
        return Err(StunError::InvalidPacket("transaction ID mismatch"));
    }

    let mut offset = 20;
    let end = 20 + msg_len;

    while offset + 4 <= end {
        let attr_type = u16::from_be_bytes([buf[offset], buf[offset + 1]]);
        let attr_len = usize::from(u16::from_be_bytes([buf[offset + 2], buf[offset + 3]]));
        offset += 4;

        if offset + attr_len > end {
            return Err(StunError::InvalidPacket("truncated attribute"));
        }

        let attr_val = &buf[offset..offset + attr_len];
        let padded_len = (attr_len + 3) & !3;
        offset += padded_len;

        if attr_type == STUN_ATTR_XOR_MAPPED_ADDRESS && attr_val.len() >= 8 {
            let family = attr_val[1];
            if family != 0x01 {
                return Err(StunError::NonIpv4Address);
            }
            let raw_port = u16::from_be_bytes([attr_val[2], attr_val[3]]);
            let port = raw_port ^ STUN_MAGIC_COOKIE_UPPER_16;

            let raw_ip = u32::from_be_bytes([attr_val[4], attr_val[5], attr_val[6], attr_val[7]]);
            let ip = Ipv4Addr::from(raw_ip ^ STUN_MAGIC_COOKIE);

            return Ok(SocketAddrV4::new(ip, port));
        }

        if attr_type == STUN_ATTR_MAPPED_ADDRESS && attr_val.len() >= 8 {
            let family = attr_val[1];
            if family != 0x01 {
                return Err(StunError::NonIpv4Address);
            }
            let port = u16::from_be_bytes([attr_val[2], attr_val[3]]);
            let ip = Ipv4Addr::new(attr_val[4], attr_val[5], attr_val[6], attr_val[7]);
            return Ok(SocketAddrV4::new(ip, port));
        }
    }

    Err(StunError::AddressNotFound)
}

pub async fn discover_public_endpoint(
    socket: &UdpSocket,
    stun_servers: &[SocketAddr],
) -> Result<SocketAddrV4, StunError> {
    if stun_servers.is_empty() {
        return Err(StunError::NoServersResponded);
    }

    let mut recv_buf = [0u8; 512];

    for &server_addr in stun_servers {
        if !server_addr.is_ipv4() {
            continue;
        }

        let mut tx_id = [0u8; 12];
        for b in &mut tx_id {
            *b = rand::random();
        }

        let req = create_binding_request(tx_id);
        if let Err(e) = socket.send_to(&req, server_addr).await {
            tracing::debug!("Failed to send STUN request to {server_addr}: {e}");
            continue;
        }

        let query_timeout = Duration::from_millis(1500);
        let deadline = tokio::time::Instant::now() + query_timeout;

        while tokio::time::Instant::now() < deadline {
            let time_left = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(time_left, socket.recv_from(&mut recv_buf)).await {
                Ok(Ok((len, from))) => {
                    if from == server_addr {
                        match parse_binding_response(&recv_buf[..len], &tx_id) {
                            Ok(addr) => return Ok(addr),
                            Err(e) => {
                                tracing::debug!("Failed parsing STUN response from {from}: {e}");
                            }
                        }
                    }
                }
                Ok(Err(e)) => {
                    tracing::debug!("Error receiving from socket during STUN: {e}");
                    break;
                }
                Err(_) => break,
            }
        }
    }

    Err(StunError::NoServersResponded)
}
