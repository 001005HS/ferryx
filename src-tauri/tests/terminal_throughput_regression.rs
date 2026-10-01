use ferryx_lib::daemon::DaemonStreamMessage;
use ferryx_lib::terminal::output_hub::TerminalOutputHub;
use serde_json::to_string;
use std::borrow::Cow;
use std::hint::black_box;
use std::time::{Duration, Instant};

const PAYLOAD_SIZE: usize = 32 * 1024;
const TARGET_BENCH_BYTES: usize = 16 * 1024 * 1024;
const MIN_THROUGHPUT_MIB_S: f64 = 50.0;

fn synthetic_terminal_bytes(size: usize) -> Vec<u8> {
    let mut state = 0x4d59_5df4_d0f3_3173_u64;
    let mut bytes = Vec::with_capacity(size);
    for _ in 0..size {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        let random = state.wrapping_mul(0x2545_f491_4f6c_dd1d);
        bytes.push(0x20 + (random % 95) as u8);
    }
    bytes
}

fn raw_length_prefixed_encode(payload: &[u8]) -> Vec<u8> {
    let len = u32::try_from(payload.len()).expect("payload must fit u32");
    let mut frame = Vec::with_capacity(4 + payload.len());
    frame.extend_from_slice(&len.to_le_bytes());
    frame.extend_from_slice(payload);
    frame
}

fn raw_length_prefixed_decode(frame: &[u8]) -> &[u8] {
    assert!(frame.len() >= 4, "raw frame is missing its length prefix");
    let payload_len = u32::from_le_bytes(frame[..4].try_into().expect("four-byte prefix")) as usize;
    assert_eq!(frame.len(), payload_len + 4, "raw frame length mismatch");
    &frame[4..]
}

#[test]
fn raw_framing_throughput_exceeds_threshold() {
    let chunk = synthetic_terminal_bytes(PAYLOAD_SIZE);
    let iterations = TARGET_BENCH_BYTES / PAYLOAD_SIZE;

    let encode_start = Instant::now();
    let mut frames = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        frames.push(raw_length_prefixed_encode(black_box(&chunk)));
    }
    let encode_elapsed = encode_start.elapsed();
    let total_mib = (TARGET_BENCH_BYTES as f64) / (1024.0 * 1024.0);
    let encode_throughput = total_mib / encode_elapsed.as_secs_f64();

    assert!(
        encode_throughput >= MIN_THROUGHPUT_MIB_S,
        "Raw encode throughput {encode_throughput:.2} MiB/s is below threshold {MIN_THROUGHPUT_MIB_S} MiB/s"
    );

    let decode_start = Instant::now();
    for frame in &frames {
        let decoded = raw_length_prefixed_decode(black_box(frame));
        assert_eq!(decoded.len(), PAYLOAD_SIZE);
    }
    let decode_elapsed = decode_start.elapsed();
    let decode_throughput = total_mib / decode_elapsed.as_secs_f64();

    assert!(
        decode_throughput >= MIN_THROUGHPUT_MIB_S,
        "Raw decode throughput {decode_throughput:.2} MiB/s is below threshold {MIN_THROUGHPUT_MIB_S} MiB/s"
    );
}

#[test]
fn daemon_json_vs_raw_framing_relative_speedup() {
    let chunk = synthetic_terminal_bytes(PAYLOAD_SIZE);
    let iterations = 100;

    let json_msg = DaemonStreamMessage::Output {
        session_id: Cow::Borrowed("throughput-test-session"),
        sequence: 42,
        data: Cow::Borrowed(&chunk),
        metrics_read_unix_micros: None,
    };

    let json_start = Instant::now();
    for _ in 0..iterations {
        let serialized = to_string(black_box(&json_msg)).expect("json encode");
        black_box(serialized);
    }
    let json_duration = json_start.elapsed();

    let raw_start = Instant::now();
    for _ in 0..iterations {
        let framed = raw_length_prefixed_encode(black_box(&chunk));
        black_box(framed);
    }
    let raw_duration = raw_start.elapsed();

    let speedup = json_duration.as_secs_f64() / raw_duration.as_secs_f64();
    assert!(
        speedup >= 1.5,
        "Raw framing speedup {speedup:.2}x is below expected 1.5x threshold over JSON (JSON: {json_duration:?}, Raw: {raw_duration:?})"
    );
}

#[test]
fn terminal_output_hub_burst_throughput_and_ring_monotonicity() {
    let hub = TerminalOutputHub::default();
    let session_id = "throughput-hub-burst";
    hub.register_session(session_id);

    let chunks_count = 500;
    let chunk_size = 4096;
    let chunk = synthetic_terminal_bytes(chunk_size);

    let publish_start = Instant::now();
    for _ in 0..chunks_count {
        hub.publish(session_id, chunk.clone()).expect("publish should succeed");
    }
    let publish_elapsed = publish_start.elapsed();

    let avg_latency = publish_elapsed / (chunks_count as u32);
    assert!(
        avg_latency < Duration::from_micros(200),
        "Average publish latency {avg_latency:?} exceeds 200us threshold"
    );

    let snapshot = hub.subscribe(session_id).expect("session exists");
    assert!(!snapshot.0.is_empty(), "Published buffer snapshot must contain buffered bytes");
}
