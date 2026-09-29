# Remote execution runner for Ferryx SSH agent state lifecycle QA
[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$BinaryPath,

    [Parameter(Mandatory = $false)]
    [string]$NodeExecutable = "node"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = Resolve-Path (Join-Path $scriptDir "..\..")

if (-not $BinaryPath) {
    $BinaryPath = Join-Path $repoDir "remote-helper\target\debug\ferryx-remote-helper.exe"
}

if (-not (Test-Path $BinaryPath)) {
    Write-Error "Helper binary not found at '$BinaryPath'. Compile it first: cargo build --manifest-path remote-helper/Cargo.toml"
    exit 1
}

$harnessScript = Join-Path $scriptDir "ssh-agent-state-lifecycle.mjs"
if (-not (Test-Path $harnessScript)) {
    Write-Error "QA harness script not found at '$harnessScript'"
    exit 1
}

Write-Output "[ssh-agent-state-lifecycle.ps1] Starting scoped QA harness against: $BinaryPath"

$env:FERRYX_QA_HELPER_BINARY = $BinaryPath

try {
    & $NodeExecutable $harnessScript
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Error "[ssh-agent-state-lifecycle.ps1] QA harness exited with code: $exitCode"
        exit $exitCode
    }
    Write-Output "[ssh-agent-state-lifecycle.ps1] QA harness completed successfully."
}
catch {
    Write-Error "[ssh-agent-state-lifecycle.ps1] Fatal error during QA harness execution: $_"
    exit 1
}
