[CmdletBinding()]
param(
    [switch]$AllowMissingLock
)

$ErrorActionPreference = "Stop"
$script:Failures = [System.Collections.Generic.List[string]]::new()

function Write-Check {
    param([string]$Label, [bool]$Passed, [string]$Detail)
    $marker = if ($Passed) { "OK" } else { "FAIL" }
    $colour = if ($Passed) { "Green" } else { "Red" }
    Write-Host ("[{0}] {1}: {2}" -f $marker, $Label, $Detail) -ForegroundColor $colour
    if (-not $Passed) { $script:Failures.Add("${Label}: ${Detail}") }
}

function Read-CommandOutput {
    param([string]$Command, [string[]]$Arguments)
    $available = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $available) { return $null }
    try {
        $output = & $available.Source @Arguments 2>&1
    } catch {
        return $null
    }
    if ($LASTEXITCODE -ne 0) { return $null }
    return (($output | Out-String).Trim())
}

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TauriRoot = Join-Path $RepoRoot "src-tauri"
$RustupLookup = Get-Command "rustup" -ErrorAction SilentlyContinue
$RustupCommand = if ($null -ne $RustupLookup) { $RustupLookup.Source } else { $null }
if (-not $RustupCommand) {
    $RustupFallback = Join-Path $env:USERPROFILE ".cargo\bin\rustup.exe"
    if (Test-Path -LiteralPath $RustupFallback -PathType Leaf) { $RustupCommand = $RustupFallback }
}

Write-Host "MAF V3 Windows desktop build doctor" -ForegroundColor Cyan
Write-Host "This checks the maintainer workstation. Recipients need none of these tools.`n"

$IsWindowsX64 = ($env:OS -eq "Windows_NT") -and [Environment]::Is64BitOperatingSystem
Write-Check "Platform" $IsWindowsX64 "Windows x64"

$NodeVersion = Read-CommandOutput "node" @("--version")
$HostNodeSupported = $false
if ($NodeVersion -match '^v(\d+)\.(\d+)\.(\d+)$') {
    $HostNodeSupported = ([version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" -ge [version]"22.13.0")
}
Write-Check "Build-host Node.js" $HostNodeSupported ($(if ($NodeVersion) { "$NodeVersion (package requires 22.13.0 or newer; release CI separately pins 24.18.0)" } else { "not found; install a Node.js version allowed by package.json" }))

$BundledNodePath = Join-Path $RepoRoot "desktop\runtime\node\node.exe"
if (Test-Path -LiteralPath $BundledNodePath -PathType Leaf) {
    $BundledNodeVersion = Read-CommandOutput $BundledNodePath @("--version")
    Write-Check "Bundled Node.js" ($BundledNodeVersion -eq "v24.18.0") "$BundledNodeVersion (recipient runtime must be exactly v24.18.0)"
} else {
    Write-Host "[WARN] Bundled Node.js: runtime is not prepared yet; desktop:prepare verifies exact v24.18.0 bytes." -ForegroundColor Yellow
}

$PnpmVersion = Read-CommandOutput "pnpm" @("--version")
Write-Check "pnpm" ($PnpmVersion -eq "11.16.0") ($(if ($PnpmVersion) { "$PnpmVersion (expected 11.16.0 from packageManager)" } else { "not found; enable the packageManager-pinned pnpm 11.16.0 release tool" }))

$RustVersion = if ($RustupCommand) { Read-CommandOutput $RustupCommand @("run", "1.97.1", "rustc", "--version") } else { $null }
Write-Check "Rust" ($RustVersion -match '^rustc 1\.97\.1\b') ($(if ($RustVersion) { "$RustVersion (pinned by src-tauri/rust-toolchain.toml)" } else { "not found; install rustup and the pinned 1.97.1 toolchain" }))

$CargoVersion = if ($RustupCommand) { Read-CommandOutput $RustupCommand @("run", "1.97.1", "cargo", "--version") } else { $null }
Write-Check "Cargo" ([bool]$CargoVersion) ($(if ($CargoVersion) { "$CargoVersion (from Rust 1.97.1)" } else { "not found for Rust 1.97.1" }))

$TauriEntry = Join-Path $RepoRoot "node_modules\@tauri-apps\cli\tauri.js"
$TauriVersion = if (Test-Path -LiteralPath $TauriEntry -PathType Leaf) {
    Read-CommandOutput "node" @($TauriEntry, "--version")
} else {
    $null
}
Write-Check "Tauri CLI" ($TauriVersion -match '2\.11\.4\b') ($(if ($TauriVersion) { "$TauriVersion (expected lockfile-pinned 2.11.4)" } else { "not found; restore the frozen JavaScript dependency install" }))

$InstalledTargets = if ($RustupCommand) { Read-CommandOutput $RustupCommand @("target", "list", "--installed", "--toolchain", "1.97.1") } else { $null }
$HasWindowsTarget = $InstalledTargets -and ($InstalledTargets -split "`r?`n" -contains "x86_64-pc-windows-msvc")
Write-Check "Rust Windows target" $HasWindowsTarget "x86_64-pc-windows-msvc"

$VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$HasCppTools = $false
if (Test-Path -LiteralPath $VsWhere) {
    $VsInstallation = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    $HasCppTools = -not [string]::IsNullOrWhiteSpace(($VsInstallation | Out-String))
}
Write-Check "Visual C++ build tools" $HasCppTools "Visual Studio 2022 Desktop development with C++ workload"

$SdkRoots = @(
    (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"),
    (Join-Path $env:ProgramFiles "Windows Kits\10\bin")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$HasWindowsSdk = $false
foreach ($SdkRoot in $SdkRoots) {
    if (Get-ChildItem -LiteralPath $SdkRoot -Recurse -Filter "signtool.exe" -File -ErrorAction SilentlyContinue | Select-Object -First 1) {
        $HasWindowsSdk = $true
        break
    }
}
Write-Check "Windows SDK" $HasWindowsSdk "Windows 10/11 SDK with signtool.exe"

$LockPath = Join-Path $TauriRoot "Cargo.lock"
$LockPresent = Test-Path -LiteralPath $LockPath -PathType Leaf
if ($AllowMissingLock -and -not $LockPresent) {
    Write-Host "[WARN] Cargo lockfile: missing; generate and review src-tauri/Cargo.lock before a release." -ForegroundColor Yellow
} else {
    Write-Check "Cargo lockfile" $LockPresent "src-tauri/Cargo.lock is committed for deterministic Rust builds"
}

Write-Check "Frozen JavaScript install" (Test-Path -LiteralPath (Join-Path $RepoRoot "node_modules")) "reviewed node_modules is present"
if (Test-Path -LiteralPath (Join-Path $RepoRoot "dist\index.js") -PathType Leaf) {
    Write-Host "[OK] Web build output: present; the release command rebuilds it before runtime preparation." -ForegroundColor Green
} else {
    Write-Host "[INFO] Web build output: not built yet. This is normal in a clean checkout; desktop:release runs pnpm build before preparation." -ForegroundColor Cyan
}

if ($script:Failures.Count -gt 0) {
    Write-Host "`nDesktop build doctor found $($script:Failures.Count) blocking issue(s)." -ForegroundColor Red
    exit 1
}

Write-Host "`nDesktop release prerequisites are ready." -ForegroundColor Green
