# Current Windows Transparency Completion Audit

## Objective

Resolve the reproduced fully transparent Ferryx Windows client, prove the fix
with RED-to-GREEN contracts and Windows runtime evidence, preserve unrelated
work, re-audit the broader Windows surface, clean every QA resource, and stop
only after the user confirms the corrected desktop rendering.

## Prompt-to-artifact checklist

| Requirement | Evidence | State |
|---|---|---|
| Reproduce transparent client | `/var/folders/zh/7cc25lt91b1_dj577306nwdh0000gn/T/clipboard-2026-08-30-163221-F141DA4C.png` shows desktop wallpaper/icons through the Ferryx client, missing UI/terminal content, and duplicated menu labels | RED captured |
| Failing-first opacity contract | `cargo test --test windows_window_opacity_contract` failed because `tauri.windows.conf.json` was absent | RED captured |
| Windows-only opacity fix | `96660a7 fix(windows): keep the main window opaque` adds `tauri.windows.conf.json` with `transparent: false` | Implemented |
| Preserve macOS transparent composition | `3b88a43 test(windows): preserve platform opacity split` asserts shared `transparent: true` and Windows override `false` | GREEN |
| Fix edge verifier regression | Actual edge run failed because `probe-daemon-edges.mjs` was not staged; contract failed, then `70f50b4 fix(qa): stage Windows edge probe driver` made contract and real edge run pass | RED to GREEN |
| Exact Windows launch command | `bun tauri dev` on `maho-win` completed the debug build and ran `target\debug\ferryx.exe`; observed `GUI=1`, `DAEMON=1`, `VITE=1` | PASS |
| Focused Windows gates | Feature-off check PASS; launcher 6/6; Git path 1/1; opacity 1/1; child surface 5/5; surface host 17/17 | PASS |
| Real PTY and CWD | Two live probes: marker and requested CWD verified; sequence `0 -> 10` and `0 -> 9`; duplicate daemon rejected | PASS |
| Shell/CWD/lock edges | Stale runtime recovery, unregistered workspace, missing/empty shell defaults, invalid shell, missing CWD, outside CWD, and manifest startup all pass | PASS |
| macOS adjacent regression | UI production build, opacity contract, child/surface contracts, and feature-off check pass locally | PASS |
| WSL boundary | WSL 2.7.10.0, WSLg 1.0.73.2, Ubuntu WSL2; direct shell smoke prints `WSL_OK` and exits 0 | CLI PASS; visible WSLg pending |
| Preserve unrelated work | All implementation occurred on isolated branch `windows-transparent-fix`; primary dirty checkout was not modified | PASS |
| Cleanup | Windows checkout: Ferryx 0, Vite/5173 0, `target` absent, `.edge-runtime` absent, staged driver absent, Git clean, 20.09 GB free | PASS |

## Remaining completion evidence

The loop cannot be marked complete until the user provides desktop-visible
confirmation for both items:

1. Corrected Ferryx window: opaque client, visible sidebar/tab/terminal, no
   desktop bleed-through, and no duplicated menu labels.
2. WSLg window: visibly present and unobscured on the Windows desktop.

Direct desktop manipulation is forbidden, so these observations cannot be
substituted with process, socket, build, or test evidence.

## Safe checkpoint

- Branch: `windows-transparent-fix`
- Automated evidence head: `70f50b4`
- Windows isolated checkout: clean at `70f50b4`
- Loop state: blocked only on user-owned visual evidence
