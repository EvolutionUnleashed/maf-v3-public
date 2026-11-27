[CmdletBinding()]
param(
    [string]$InstallerPath,
    [switch]$AllowUnsigned,
    [switch]$CleanGeneratedData
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $InstallerPath = Join-Path $RepoRoot "src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis\MAF V3_3.0.0_x64-setup.exe"
}
$InstallerPath = (Resolve-Path -LiteralPath $InstallerPath).Path

$InstallDir = Join-Path $env:LOCALAPPDATA "MAF V3"
$AppExe = Join-Path $InstallDir "maf-v3-desktop.exe"
$Uninstaller = Join-Path $InstallDir "uninstall.exe"
$AppRuntime = Join-Path $InstallDir "runtime\app"
$InstalledNodeExe = Join-Path $InstallDir "runtime\node\node.exe"
$DataDir = Join-Path $env:LOCALAPPDATA "com.evolutionunleashed.mafv3"
$RoamingDataDir = Join-Path $env:APPDATA "com.evolutionunleashed.mafv3"
$DatabasePath = Join-Path $DataDir "maf-v3.sqlite"
$BackendLog = Join-Path $DataDir "backend.log"
$SentinelPath = Join-Path $DataDir ".desktop-install-smoke"
$UninstallRegistry = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MAF V3"
$StartMenuShortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\MAF V3.lnk"
$DesktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "MAF V3.lnk"

function Assert-Condition {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Invoke-InstallerProcess {
    param([string]$Path, [string[]]$Arguments)
    Write-Host ("> {0} {1}" -f $Path, ($Arguments -join " ")) -ForegroundColor DarkGray
    $Process = Start-Process -FilePath $Path -ArgumentList $Arguments -WindowStyle Hidden -PassThru -Wait
    if ($Process.ExitCode -ne 0) {
        throw "$Path exited with code $($Process.ExitCode)."
    }
}

function Wait-Until {
    param([scriptblock]$Condition, [int]$TimeoutSeconds, [string]$FailureMessage)
    $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $Deadline)
    throw $FailureMessage
}

function Get-InstalledAppProcesses {
    @(Get-Process -Name "maf-v3-desktop" -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -eq $AppExe } catch { $false }
    })
}

function Get-InstalledNodeProcesses {
    $NodeExe = Join-Path $InstallDir "runtime\node\node.exe"
    @(Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -eq $NodeExe } catch { $false }
    })
}

function Stop-SmokeApp {
    param([System.Diagnostics.Process]$Process)
    if (-not $Process.HasExited) {
        $null = $Process.CloseMainWindow()
        if (-not $Process.WaitForExit(10000)) {
            Stop-Process -Id $Process.Id -Force
            $Process.WaitForExit(10000)
        }
    }
    Wait-Until -TimeoutSeconds 10 -FailureMessage "The bundled Node backend outlived the desktop shell." -Condition {
        @(Get-InstalledNodeProcesses).Count -eq 0
    }
}

function Wait-ForMainWindow {
    param([System.Diagnostics.Process]$Process)
    Wait-Until -TimeoutSeconds 90 -FailureMessage "The installed MAF V3 main window did not open in 90 seconds." -Condition {
        $Process.Refresh()
        if ($Process.HasExited) { throw "The installed desktop shell exited before its main window opened." }
        $Process.MainWindowHandle -ne [IntPtr]::Zero -and $Process.MainWindowTitle -eq "MAF V3" -and
        (Test-Path -LiteralPath $DatabasePath -PathType Leaf)
    }
}

function Assert-SqliteState {
    param([switch]$CreateMarker)
    # Send source on stdin so Windows PowerShell does not re-quote JavaScript.
    # This uses only the installed Node and installed native SQLite module.
    $Probe = @'
const Database = require("./node_modules/better-sqlite3");
const assert = require("node:assert/strict");
const createMarker = process.argv[4] === "create";
const db = new Database(process.argv[2], { readonly: !createMarker, fileMustExist: true, timeout: 5000 });
try {
  const journal = require("./drizzle/meta/_journal.json");
  assert.equal(db.prepare("select count(*) c from __drizzle_migrations").get().c, journal.entries.length, "Bundled migrations were not fully applied");
  assert.equal(db.prepare("pragma quick_check").get().quick_check, "ok", "SQLite integrity check failed");
  assert.equal(db.prepare("select count(*) c from workspaces").get().c, 1, "Fresh workspace was not seeded");
  assert.equal(db.prepare("select count(*) c from build_sections").get().c, 4, "BUILD sections were not seeded");
  assert.equal(db.prepare("select count(*) c from build_sub_steps").get().c, 10, "BUILD steps were not seeded");
  if (createMarker) {
    db.exec("create table __maf_install_smoke(marker text primary key, value text not null)");
    db.prepare("insert into __maf_install_smoke(marker, value) values(?, ?)").run(process.argv[3], "persists");
  }
  assert.equal(db.prepare("select value from __maf_install_smoke where marker=?").get(process.argv[3])?.value, "persists", "Workspace marker did not persist");
} finally {
  db.close();
}
console.log("Installed SQLite, migrations, seeded BUILD state, and persistence marker verified.");
'@
    $Mode = if ($CreateMarker) { "create" } else { "verify" }
    $AmbientVariables = @("NODE_OPTIONS", "NODE_PATH", "NAPI_RS_NATIVE_LIBRARY_PATH")
    $PreviousEnvironment = @{}
    foreach ($Name in $AmbientVariables) {
        $PreviousEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, "Process")
        [Environment]::SetEnvironmentVariable($Name, $null, "Process")
    }
    Push-Location $AppRuntime
    try {
        $Probe | & $InstalledNodeExe --input-type=commonjs - $DatabasePath $Sentinel $Mode
        if ($LASTEXITCODE -ne 0) { throw "Installed SQLite/migration/persistence probe failed with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
        foreach ($Name in $AmbientVariables) {
            [Environment]::SetEnvironmentVariable($Name, $PreviousEnvironment[$Name], "Process")
        }
    }
}

function Get-DurableDataSnapshot {
    $Paths = @($DatabasePath, $SentinelPath)
    foreach ($Relative in @("maf-v3.sqlite-wal", "maf-v3.sqlite-shm", "integrations.enc.json", ".config-encryption-key")) {
        $Candidate = Join-Path $DataDir $Relative
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) { $Paths += $Candidate }
    }
    $MediaDir = Join-Path $DataDir "media"
    if (Test-Path -LiteralPath $MediaDir -PathType Container) {
        $Paths += @(Get-ChildItem -LiteralPath $MediaDir -Recurse -File -Force | Select-Object -ExpandProperty FullName)
    }
    foreach ($FullName in ($Paths | Sort-Object -Unique)) {
        Assert-Condition (Test-Path -LiteralPath $FullName -PathType Leaf) "A durable workspace file is missing: $FullName"
        $Relative = $FullName.Substring($DataDir.Length).TrimStart('\').Replace('\', '/')
        "{0}  {1}" -f (Get-FileHash -LiteralPath $FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $Relative
    }
}

function Assert-DurableDataUnchanged {
    param([string[]]$Expected, [string]$Operation)
    $Actual = @(Get-DurableDataSnapshot)
    Assert-Condition (-not [bool](Compare-Object -ReferenceObject $Expected -DifferenceObject $Actual)) "$Operation changed retained workspace bytes."
}

$PreExisting = [ordered]@{
    "install directory" = Test-Path -LiteralPath $InstallDir
    "local app data" = Test-Path -LiteralPath $DataDir
    "roaming app data" = Test-Path -LiteralPath $RoamingDataDir
    "uninstall registry key" = Test-Path -LiteralPath $UninstallRegistry
    "Start menu shortcut" = Test-Path -LiteralPath $StartMenuShortcut
    "desktop shortcut" = Test-Path -LiteralPath $DesktopShortcut
    "running MAF V3 process" = @(Get-InstalledAppProcesses).Count -gt 0
}
$Conflicts = @($PreExisting.GetEnumerator() | Where-Object Value | ForEach-Object Key)
if ($Conflicts.Count -gt 0) {
    throw "Clean-install smoke refused to touch pre-existing MAF V3 state: $($Conflicts -join ', ')."
}

$Signature = Get-AuthenticodeSignature -LiteralPath $InstallerPath
if (-not $AllowUnsigned -and $Signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    throw "Installer signature is $($Signature.Status). Use -AllowUnsigned to test the supported unsigned installer."
}

$Sentinel = "MAF-V3-SMOKE-$([guid]::NewGuid().ToString('N'))"
$FirstApp = $null
$SecondApp = $null
try {
    Invoke-InstallerProcess -Path $InstallerPath -Arguments @("/S")
    foreach ($Required in @(
        $AppExe,
        $Uninstaller,
        (Join-Path $InstallDir "LICENSE.txt"),
        (Join-Path $InstallDir "THIRD-PARTY-NOTICES.txt"),
        (Join-Path $InstallDir "runtime\app\desktop-runtime-manifest.json"),
        (Join-Path $InstallDir "runtime\node\node.exe"),
        (Join-Path $InstallDir "runtime\node\LICENSE.node.txt"),
        (Join-Path $AppRuntime "dist\index.js"),
        (Join-Path $AppRuntime "drizzle\meta\_journal.json"),
        (Join-Path $AppRuntime "node_modules\better-sqlite3\package.json")
    )) {
        Assert-Condition (Test-Path -LiteralPath $Required -PathType Leaf) "Installed file is missing: $Required"
    }
    Assert-Condition (Test-Path -LiteralPath $UninstallRegistry) "The per-user uninstall registry entry was not created."
    Assert-Condition (Test-Path -LiteralPath $StartMenuShortcut -PathType Leaf) "The Start menu shortcut was not created."

    $FirstApp = Start-Process -FilePath $AppExe -PassThru
    Wait-Until -TimeoutSeconds 60 -FailureMessage "The installed app did not prepare its SQLite workspace in 60 seconds." -Condition {
        (Test-Path -LiteralPath $DatabasePath -PathType Leaf) -and
        (Test-Path -LiteralPath $BackendLog -PathType Leaf) -and
        [bool](Select-String -LiteralPath $BackendLog -SimpleMatch "Server running on http://127.0.0.1:" -Quiet -ErrorAction SilentlyContinue)
    }
    Assert-Condition (-not $FirstApp.HasExited) "The installed desktop shell exited during first launch."
    Wait-ForMainWindow -Process $FirstApp
    Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $DataDir "integrations.enc.json"))) "A fresh install unexpectedly contained saved integrations."
    Assert-SqliteState -CreateMarker

    Set-Content -LiteralPath $SentinelPath -Value $Sentinel -Encoding UTF8 -NoNewline
    $SecondApp = Start-Process -FilePath $AppExe -PassThru
    Assert-Condition $SecondApp.WaitForExit(10000) "A second MAF V3 desktop process did not exit."
    Assert-Condition (@(Get-InstalledAppProcesses).Count -eq 1) "Single-instance enforcement did not leave exactly one installed shell."
    Stop-SmokeApp -Process $FirstApp
    $FirstApp = $null

    $BeforeReinstall = @(Get-DurableDataSnapshot)
    Invoke-InstallerProcess -Path $InstallerPath -Arguments @("/S", "/UPDATE")
    Assert-Condition (Test-Path -LiteralPath $DatabasePath -PathType Leaf) "Reinstall removed the local SQLite workspace."
    Assert-Condition ((Get-Content -Raw -LiteralPath $SentinelPath) -eq $Sentinel) "Reinstall changed or removed local app data."
    Assert-DurableDataUnchanged -Expected $BeforeReinstall -Operation "Reinstall"

    $FirstApp = Start-Process -FilePath $AppExe -PassThru
    Wait-ForMainWindow -Process $FirstApp
    Assert-SqliteState
    Stop-SmokeApp -Process $FirstApp
    $FirstApp = $null

    $BeforeUninstall = @(Get-DurableDataSnapshot)
    Invoke-InstallerProcess -Path $Uninstaller -Arguments @("/S")
    Wait-Until -TimeoutSeconds 30 -FailureMessage "Uninstall left the application install directory behind." -Condition {
        -not (Test-Path -LiteralPath $InstallDir)
    }
    Assert-Condition (-not (Test-Path -LiteralPath $InstallDir)) "Uninstall left the application install directory behind."
    Assert-Condition (-not (Test-Path -LiteralPath $UninstallRegistry)) "Uninstall left the Add/Remove Programs entry behind."
    Assert-Condition (-not (Test-Path -LiteralPath $StartMenuShortcut)) "Uninstall left the Start menu shortcut behind."
    Assert-Condition (Test-Path -LiteralPath $DatabasePath -PathType Leaf) "Default uninstall unexpectedly deleted user workspace data."
    Assert-Condition ((Get-Content -Raw -LiteralPath $SentinelPath) -eq $Sentinel) "Default uninstall unexpectedly changed user workspace data."
    Assert-DurableDataUnchanged -Expected $BeforeUninstall -Operation "Uninstall"

    if ($CleanGeneratedData) {
        Assert-Condition (-not (Test-Path -LiteralPath (Join-Path $DataDir "integrations.enc.json"))) "API settings appeared during smoke; generated data was preserved for safety."
        $ExpectedLocalRoot = (Resolve-Path -LiteralPath $env:LOCALAPPDATA).Path
        $ExpectedRoamingRoot = (Resolve-Path -LiteralPath $env:APPDATA).Path
        Assert-Condition ($DataDir.StartsWith($ExpectedLocalRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) "Local data cleanup target is unsafe."
        Assert-Condition ($RoamingDataDir.StartsWith($ExpectedRoamingRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) "Roaming data cleanup target is unsafe."
        Remove-Item -LiteralPath $DataDir -Recurse -Force
        if (Test-Path -LiteralPath $RoamingDataDir) {
            Remove-Item -LiteralPath $RoamingDataDir -Recurse -Force
        }
    }

    Write-Host "Desktop clean-install, launch, single-instance, reinstall, persistence, backend cleanup, and uninstall smoke passed." -ForegroundColor Green
    if (-not $CleanGeneratedData) {
        Write-Host "The generated QA workspace was deliberately preserved at: $DataDir" -ForegroundColor Yellow
    }
} finally {
    foreach ($Process in @($SecondApp, $FirstApp)) {
        if ($null -ne $Process -and -not $Process.HasExited) {
            Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
