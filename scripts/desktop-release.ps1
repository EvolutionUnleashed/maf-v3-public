[CmdletBinding()]
param(
    [switch]$AllowUnsigned,
    [switch]$SkipPrepare,
    [string]$TauriSigningConfig = $env:MAF_TAURI_SIGNING_CONFIG
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TauriRoot = Join-Path $RepoRoot "src-tauri"
$NodeExe = Join-Path $RepoRoot "desktop\runtime\node\node.exe"
$LockPath = Join-Path $TauriRoot "Cargo.lock"
$CargoManifestPath = Join-Path $TauriRoot "Cargo.toml"
$RustupExe = Join-Path $env:USERPROFILE ".cargo\bin\rustup.exe"

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments, [string]$WorkingDirectory = $RepoRoot)
    Write-Host ("> {0} {1}" -f $Command, ($Arguments -join " ")) -ForegroundColor DarkGray
    Push-Location $WorkingDirectory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Command exited with code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $LockPath -PathType Leaf)) {
    throw "src-tauri/Cargo.lock is missing. On a trusted network, run cargo generate-lockfile --manifest-path src-tauri/Cargo.toml, review it, and commit it before release."
}

Invoke-Checked (Join-Path $PSScriptRoot "desktop-doctor.ps1") @()
Invoke-Checked "pnpm" @("security:verify")
if (-not (Test-Path -LiteralPath $RustupExe -PathType Leaf)) {
    $RustupCommand = Get-Command "rustup" -ErrorAction SilentlyContinue
    if (-not $RustupCommand) { throw "rustup is required for the pinned Rust 1.97.1 release build." }
    $RustupExe = $RustupCommand.Source
}
$RustBin = Split-Path -Parent $RustupExe
if (-not (($env:PATH -split ';') -contains $RustBin)) {
    $env:PATH = "${RustBin};$env:PATH"
}
Invoke-Checked $RustupExe @(
    "run", "1.97.1", "cargo", "fetch",
    "--manifest-path", $CargoManifestPath,
    "--locked"
)
Invoke-Checked "node" @("scripts/security-generate-notices.mjs")
Invoke-Checked "pnpm" @("check")
Invoke-Checked "pnpm" @("test")
Invoke-Checked "pnpm" @("build")
if ($SkipPrepare) {
    Write-Warning "-SkipPrepare is deprecated and ignored. The runtime must be rebuilt from the web build produced by this release."
}
Invoke-Checked "node" @("scripts/desktop-prepare.mjs")

if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) {
    throw "The bundled Node runtime is missing. Run node scripts/desktop-prepare.mjs first."
}

# Unsigned is the supported community handover path. Signing is optional and explicit.
$SignRelease = -not [string]::IsNullOrWhiteSpace($TauriSigningConfig)
if ($AllowUnsigned -and $SignRelease) { throw "Choose either -AllowUnsigned or a signing config, not both." }
if ($SignRelease) {
    $ResolvedSigningConfig = (Resolve-Path -LiteralPath $TauriSigningConfig).Path
    $Signature = Get-AuthenticodeSignature -LiteralPath $NodeExe
    if ($Signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        throw "The bundled Node runtime must be signed before installer assembly. Signature status: $($Signature.Status)."
    }
    # This integrated helper never signs or mutates Node: the official OpenJS
    # binary is already Authenticode-valid. Recomputing the manifest is an
    # idempotent consistency check before build.rs embeds its SHA-256. Protected
    # split build/sign workflows stage the prebuilt app and run `tauri bundle`
    # instead of invoking this end-to-end helper.
    Invoke-Checked "node" @("scripts/desktop-prepare.mjs", "--manifest-only")
}

Invoke-Checked $RustupExe @("run", "1.97.1", "cargo", "check", "--locked", "--target", "x86_64-pc-windows-msvc") $TauriRoot
Invoke-Checked $RustupExe @("run", "1.97.1", "cargo", "test", "--locked", "--target", "x86_64-pc-windows-msvc") $TauriRoot

$BuildArguments = @(
    "node_modules/@tauri-apps/cli/tauri.js", "build",
    "--target", "x86_64-pc-windows-msvc",
    "--bundles", "nsis"
)
if ($SignRelease) {
    $BuildArguments += @("--config", $ResolvedSigningConfig)
}
# Arguments after `--` are passed by the Tauri CLI to Cargo.
$BuildArguments += @("--", "--locked")
Invoke-Checked (Join-Path $PSScriptRoot "security-prepare-tauri-tools.ps1") @()
Invoke-Checked "node" $BuildArguments $RepoRoot
Invoke-Checked (Join-Path $PSScriptRoot "security-prepare-tauri-tools.ps1") @("-VerifyOnly")

$BundleDirectory = Join-Path $TauriRoot "target\x86_64-pc-windows-msvc\release\bundle\nsis"
$Installers = @(Get-ChildItem -LiteralPath $BundleDirectory -Filter "*.exe" -File -ErrorAction Stop)
if ($Installers.Count -eq 0) { throw "Tauri reported success but produced no NSIS installer." }

if ($SignRelease) {
    foreach ($Installer in $Installers) {
        $Signature = Get-AuthenticodeSignature -LiteralPath $Installer.FullName
        if ($Signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
            throw "Installer signing verification failed for $($Installer.FullName): $($Signature.Status)"
        }
    }
}

if (-not $SignRelease) { Write-Host "Unsigned installer: expect unknown-publisher warnings. Run desktop-install-smoke.ps1 -AllowUnsigned on a clean Windows account before handover." -ForegroundColor Yellow }
Write-Host "`nDesktop installer built (installation smoke still required):" -ForegroundColor Green
$Installers | ForEach-Object { Write-Host $_.FullName }
