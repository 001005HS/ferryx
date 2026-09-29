# Direct peer path (P2P) and direct trust

> Status: source only. Not deployed in any release.
> Verification: PENDING. Compile, tests, and a Windows smoke run have not been
> reported yet. Nothing here claims the direct path works end to end.

## What it is

Paired machines normally carry all traffic through the relay. The direct path lets
two paired machines talk over a peer-to-peer QUIC connection instead. The relay is
still used for signaling (offer/answer), but it is **untrusted**.

## Trust model

- A peer's public key is **never** learned from the relay, an offer, or an answer.
  Offers are verified only against a key you provisioned yourself.
- Each machine keeps its own pinned keys in `<data>/remote/direct-trust.json`, next
  to `identity.json`. `<data>` follows `FERRYX_DATA_DIR`, or the platform default
  (`%LOCALAPPDATA%\Ferryx` on Windows, `~/.ferryx` elsewhere).
- Trust is **mutual and independent**. The host pins the client's key, and the client
  pins the host's key. Pinning on one side does nothing for the other.
- A missing pin, an unreadable store, or a corrupt store means "not trusted". The
  connection stays on the relay and the failure is logged, never raised as an error
  to the user flow.

## Exchanging keys

Run on **each** machine, then carry the output to the other machine out of band (for
example, copy it over an existing terminal session you already trust):

```
ferryx direct-trust identity
```

This prints one JSON line with only the public half of the existing machine
identity. It never rotates the identity and never prints the private key:

```
{"machineId":"<id>","publicKey":"<base64 ed25519 public key>"}
```

On the other machine, pin those values:

```
ferryx direct-trust provision <machineId> <publicKeyBase64>
```

Repeat in the opposite direction. Both sides must provision before the direct path
can be considered.

## CLI reference

Available as `ferryx direct-trust ...` and `ferryx-cli direct-trust ...`. On Windows use
`ferryx-cli.exe`, because release `ferryx.exe` is a GUI-subsystem binary and its
stdout is not shown in a console. None of these commands start or contact the daemon.

| Command | Effect | Output |
|---|---|---|
| `identity` | Print the local public identity | `{"machineId","publicKey"}` |
| `provision <machineId> <key> [--replace]` | Pin a peer key | `{"provisioned":"<id>"}` |
| `revoke <machineId>` | Remove a pin | `{"machineId","revoked":true\|false}` |

- Provisioning the same key again retains the same pin.
- Provisioning a **different** key for an already pinned machine fails unless you pass
  `--replace`. Use it only when that machine really was re-keyed.
- `revoke` returns `false` when nothing was pinned. After a revoke, subsequent
  negotiations refuse that peer; existing authenticated streams follow their
  bearer/session lifetimes.
- Errors go to stderr with exit code 1.

## Network requirements and defaults

- IPv4 only. Address discovery (STUN) rejects non-IPv4 mapped addresses.
- Uses arbitrary UDP ports, not 443. Networks that block outbound UDP or
  non-443 traffic will keep the pair on the relay.
- QUIC keep-alive is 15 s and the idle timeout is 20 s
  (`src-tauri/src/paired_host/direct/quic.rs`).

## Verification status

| Item | State |
|---|---|
| Rust compile (Windows) | pending |
| `cargo test --lib -- cli::direct_trust` | pending |
| Windows CLI smoke (identity / provision / revoke) | pending |
| End-to-end direct connection between two machines | pending |

Update this table only with results that have been measured.
