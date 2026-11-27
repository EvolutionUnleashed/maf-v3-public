[CmdletBinding()]
param(
    [switch]$VerifyOnly,
    [string]$ToolsRoot
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TargetRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot "src-tauri\target"))
if ([string]::IsNullOrWhiteSpace($ToolsRoot)) {
    $ToolsRoot = Join-Path $TargetRoot ".tauri"
}
$ToolsRoot = [IO.Path]::GetFullPath($ToolsRoot)
$TargetPrefix = $TargetRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $ToolsRoot.StartsWith($TargetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The Tauri tools directory must stay inside src-tauri/target."
}

$PolicyPath = Join-Path $RepoRoot "security\tauri-tools.json"
$Policy = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
if ($Policy.schemaVersion -ne 1) { throw "Unsupported Tauri tools policy schema." }
$ManifestName = "TAURI-TOOLS-SHA256SUMS"
$ManifestPath = Join-Path $ToolsRoot $ManifestName
$AllowedFinalHosts = @(
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
    "msedge.sf.dl.delivery.mp.microsoft.com"
)

function Get-TreeChecksums {
    param([string]$Root)
    $Lines = [Collections.Generic.List[string]]::new()
    $Files = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Force |
        Where-Object { $_.FullName -ne $ManifestPath } |
        Sort-Object { $_.FullName.Substring($Root.Length) })
    foreach ($File in $Files) {
        $Relative = $File.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
        if ([string]::IsNullOrWhiteSpace($Relative) -or $Relative.Contains("`r") -or $Relative.Contains("`n")) {
            throw "Unsafe Tauri tool path encountered."
        }
        $Hash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $Lines.Add("$Hash  $Relative")
    }
    if ($Lines.Count -eq 0) { throw "The Tauri tool cache is empty." }
    return $Lines
}

function Test-PreparedTools {
    if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
        throw "The reviewed Tauri tool checksum manifest is missing."
    }
    $Expected = @((Get-Content -LiteralPath $ManifestPath) | Where-Object { $_ -ne "" })
    $Actual = @(Get-TreeChecksums -Root $ToolsRoot)
    if ($Expected.Count -ne $Actual.Count) {
        throw "The Tauri tool cache file count differs from its reviewed manifest."
    }
    for ($Index = 0; $Index -lt $Expected.Count; $Index++) {
        if ($Expected[$Index] -cne $Actual[$Index]) {
            throw "The Tauri tool cache does not match its reviewed SHA-256 manifest."
        }
    }

    $Required = @(
        "NSIS\makensis.exe",
        "NSIS\Plugins\x86-unicode\additional\nsis_tauri_utils.dll",
        "MicrosoftEdgeWebview2Setup.exe"
    )
    foreach ($Relative in $Required) {
        if (-not (Test-Path -LiteralPath (Join-Path $ToolsRoot $Relative) -PathType Leaf)) {
            throw "A required Tauri build tool is missing: $Relative"
        }
    }

    $WebViewPath = Join-Path $ToolsRoot "MicrosoftEdgeWebview2Setup.exe"
    $Signature = Get-AuthenticodeSignature -LiteralPath $WebViewPath
    if ($Signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        throw "The pinned Microsoft WebView2 bootstrapper has an invalid Authenticode signature."
    }
    if (-not $Signature.SignerCertificate.Subject.StartsWith(
        [string]$Policy.artifacts.webview2Bootstrapper.authenticodeSubject,
        [StringComparison]::Ordinal
    )) {
        throw "The WebView2 bootstrapper signer is not the reviewed Microsoft subject."
    }
    Write-Host "Verified the complete Tauri NSIS/WebView2 tool cache against SHA-256 and Authenticode policy."
}

if ($VerifyOnly) {
    Test-PreparedTools
    return
}

$TemporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("maf-v3-tauri-tools-" + [Guid]::NewGuid().ToString("N"))
$Downloads = Join-Path $TemporaryRoot "downloads"
$Expanded = Join-Path $TemporaryRoot "expanded"
$Prepared = Join-Path $TemporaryRoot "prepared"
New-Item -ItemType Directory -Force -Path $Downloads, $Expanded, $Prepared | Out-Null

function Receive-PinnedArtifact {
    param(
        [Parameter(Mandatory)]$Artifact,
        [Parameter(Mandatory)][string]$Destination
    )
    $Uri = [Uri][string]$Artifact.url
    if ($Uri.Scheme -ne "https") { throw "Tauri tool downloads must use HTTPS." }

    $Handler = [Net.Http.HttpClientHandler]::new()
    $Handler.AllowAutoRedirect = $true
    $Handler.SslProtocols = [Security.Authentication.SslProtocols]::Tls12
    $Client = [Net.Http.HttpClient]::new($Handler)
    $Client.Timeout = [TimeSpan]::FromMinutes(3)
    try {
        $Response = $Client.GetAsync($Uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        try {
            $Response.EnsureSuccessStatusCode() | Out-Null
            $FinalUri = $Response.RequestMessage.RequestUri
            if ($FinalUri.Scheme -ne "https" -or $AllowedFinalHosts -notcontains $FinalUri.DnsSafeHost) {
                throw "A Tauri tool download redirected outside the reviewed HTTPS host allowlist."
            }
            $ExpectedSize = [long]$Artifact.size
            $DeclaredSize = $Response.Content.Headers.ContentLength
            if ($null -ne $DeclaredSize -and [long]$DeclaredSize -ne $ExpectedSize) {
                throw "A Tauri tool response declared an unexpected size."
            }
            $Output = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $Input = $Response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
                try {
                    $Buffer = [byte[]]::new(64 * 1024)
                    $Total = 0L
                    while (($Read = $Input.Read($Buffer, 0, $Buffer.Length)) -gt 0) {
                        $Total += $Read
                        if ($Total -gt $ExpectedSize) {
                            throw "A Tauri tool download exceeded its pinned size."
                        }
                        $Output.Write($Buffer, 0, $Read)
                    }
                    if ($Total -ne $ExpectedSize) {
                        throw "A Tauri tool download ended before its pinned size."
                    }
                } finally { $Input.Dispose() }
            } finally {
                $Output.Dispose()
            }
        } finally {
            $Response.Dispose()
        }
    } finally {
        $Client.Dispose()
        $Handler.Dispose()
    }

    $Details = Get-Item -LiteralPath $Destination
    if ($Details.Length -ne [long]$Artifact.size) {
        throw "A Tauri tool download has an unexpected size."
    }
    $ActualHash = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualHash -cne [string]$Artifact.sha256) {
        throw "A Tauri tool download failed its pinned SHA-256 check."
    }
}

try {
    $NsisArchive = Join-Path $Downloads "nsis-3.11.zip"
    $NsisPlugin = Join-Path $Downloads "nsis_tauri_utils.dll"
    $WebView = Join-Path $Downloads "MicrosoftEdgeWebview2Setup.exe"
    Receive-PinnedArtifact -Artifact $Policy.artifacts.nsisArchive -Destination $NsisArchive
    Receive-PinnedArtifact -Artifact $Policy.artifacts.nsisTauriUtils -Destination $NsisPlugin
    Receive-PinnedArtifact -Artifact $Policy.artifacts.webview2Bootstrapper -Destination $WebView

    Expand-Archive -LiteralPath $NsisArchive -DestinationPath $Expanded
    $ExpandedNsis = Join-Path $Expanded "nsis-3.11"
    if (-not (Test-Path -LiteralPath $ExpandedNsis -PathType Container)) {
        throw "The pinned NSIS archive has an unexpected layout."
    }
    $PluginDirectory = Join-Path $ExpandedNsis "Plugins\x86-unicode\additional"
    New-Item -ItemType Directory -Force -Path $PluginDirectory | Out-Null
    Copy-Item -LiteralPath $NsisPlugin -Destination (Join-Path $PluginDirectory "nsis_tauri_utils.dll")
    Move-Item -LiteralPath $ExpandedNsis -Destination (Join-Path $Prepared "NSIS")
    Copy-Item -LiteralPath $WebView -Destination (Join-Path $Prepared "MicrosoftEdgeWebview2Setup.exe")

    New-Item -ItemType Directory -Force -Path $TargetRoot | Out-Null
    if (Test-Path -LiteralPath $ToolsRoot) {
        Remove-Item -LiteralPath $ToolsRoot -Recurse -Force
    }
    Move-Item -LiteralPath $Prepared -Destination $ToolsRoot
    $Checksums = @(Get-TreeChecksums -Root $ToolsRoot)
    [IO.File]::WriteAllLines($ManifestPath, $Checksums, [Text.UTF8Encoding]::new($false))
    Test-PreparedTools
} finally {
    if (Test-Path -LiteralPath $TemporaryRoot) {
        Remove-Item -LiteralPath $TemporaryRoot -Recurse -Force
    }
}
