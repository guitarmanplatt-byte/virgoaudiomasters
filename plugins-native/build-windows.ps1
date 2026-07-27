#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Builds all VirgoAudioMasters VST3 plugins for Windows x64.

.DESCRIPTION
    Requires:
      - CMake 3.22+ (https://cmake.org/download/)
      - Visual Studio 2019 or 2022 with "Desktop development with C++" workload
        (The free "Build Tools" edition works fine — no full IDE needed)
      - Git (for JUCE FetchContent download)
      - Internet access on first run (downloads JUCE ~80 MB, cached afterward)

.EXAMPLE
    .\build-windows.ps1
    .\build-windows.ps1 -Config Debug
    .\build-windows.ps1 -Clean
#>
param(
    [ValidateSet("Release","Debug","RelWithDebInfo")]
    [string]$Config  = "Release",
    [switch]$Clean,
    [switch]$NoCopy          # skip auto-copy to VST3 system folder
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Colours ──────────────────────────────────────────────────────────────────
function Info  { param($m) Write-Host "  [INFO]  $m" -ForegroundColor Cyan   }
function OK    { param($m) Write-Host "  [ OK ]  $m" -ForegroundColor Green  }
function Warn  { param($m) Write-Host "  [WARN]  $m" -ForegroundColor Yellow }
function Fail  { param($m) Write-Host "  [FAIL]  $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "  VirgoAudioMasters VST3 Build Script"    -ForegroundColor Magenta
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""

# ── 1. Prerequisites check ────────────────────────────────────────────────────
Info "Checking prerequisites..."

# CMake
try { $cmakeVer = (cmake --version 2>&1 | Select-String "cmake version").ToString().Trim() }
catch { Fail "CMake not found. Download from https://cmake.org/download/ and add to PATH." }
OK "CMake: $cmakeVer"

# Git
try { $gitVer = (git --version 2>&1).ToString().Trim() }
catch { Fail "Git not found. Download from https://git-scm.com/download/win" }
OK "Git: $gitVer"

# Visual Studio / MSBuild (vswhere)
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vsWhere)) {
    $vsWhere = "${env:ProgramFiles}\Microsoft Visual Studio\Installer\vswhere.exe"
}
if (-not (Test-Path $vsWhere)) {
    Fail ("Visual Studio installer not found.`n" +
          "Install Visual Studio 2019/2022 or the standalone Build Tools from:`n" +
          "https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022`n" +
          "Make sure to include 'Desktop development with C++' workload.")
}
$vsInfo = & $vsWhere -latest -format json | ConvertFrom-Json
if (-not $vsInfo) { Fail "No Visual Studio installation found." }
$vsVer = $vsInfo.displayName
OK "Visual Studio: $vsVer"

# Choose CMake generator based on VS version
$gen = "Visual Studio 17 2022"
if ($vsInfo.installationVersion -match "^16\.") { $gen = "Visual Studio 16 2019" }
Info "CMake generator: $gen"

# ── 2. Paths ──────────────────────────────────────────────────────────────────
$scriptDir = $PSScriptRoot
$buildDir  = Join-Path $scriptDir "build"
$distDir   = Join-Path $scriptDir "dist"
$stagingDir= Join-Path $distDir   "VirgoAudioMasters-VST3-Windows-x64"

# ── 3. Clean ──────────────────────────────────────────────────────────────────
if ($Clean -and (Test-Path $buildDir)) {
    Warn "Cleaning build directory..."
    Remove-Item -Recurse -Force $buildDir
    OK "Clean done."
}

# ── 4. Configure ──────────────────────────────────────────────────────────────
Write-Host ""
Info "Configuring CMake ($Config)..."
$configureArgs = @(
    "-B", $buildDir,
    "-S", $scriptDir,
    "-G", $gen,
    "-A", "x64",
    "-DCMAKE_BUILD_TYPE=$Config",
    "-DJUCE_COPY_PLUGIN_AFTER_BUILD=OFF"
)
& cmake @configureArgs
if ($LASTEXITCODE -ne 0) { Fail "CMake configure failed (exit $LASTEXITCODE)." }
OK "Configuration complete."

# ── 5. Build ──────────────────────────────────────────────────────────────────
Write-Host ""
$cpuCount = [Environment]::ProcessorCount
Info "Building all plugins with $cpuCount parallel jobs — this may take 5-20 min on first run..."
Info "(JUCE is compiled from source; subsequent builds are incremental and much faster)"
Write-Host ""

& cmake --build $buildDir --config $Config --parallel $cpuCount
if ($LASTEXITCODE -ne 0) { Fail "Build failed (exit $LASTEXITCODE)." }
OK "Build succeeded."

# ── 6. Collect VST3 bundles ───────────────────────────────────────────────────
Write-Host ""
Info "Collecting VST3 files..."
New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null

$vst3Items = Get-ChildItem -Path $buildDir -Recurse -Filter "*.vst3" |
             Where-Object { $_.PSIsContainer }

if ($vst3Items.Count -eq 0) { Fail "No .vst3 bundles found under $buildDir" }

foreach ($item in $vst3Items) {
    $dest = Join-Path $stagingDir $item.Name
    Copy-Item -Recurse -Force $item.FullName $dest
    OK "  $($item.Name)"
}

Write-Host ""
OK "$($vst3Items.Count) plugins collected."

# ── 7. Write install notes ────────────────────────────────────────────────────
@"
VirgoAudioMasters VST3 Plugins — Windows x64 ($Config)
Built: $(Get-Date -Format "yyyy-MM-dd HH:mm")
=======================================================

INSTALLATION
  Copy each .vst3 folder into:
    C:\Program Files\Common Files\VST3\

  Then rescan plugins in your DAW.

PLUGINS
  Mastering:
    VA Utility        — Gain, pan, M/S width, drive
    VA Compressor     — Soft-knee, program-dependent auto-release, parallel mix
    VA Dynamic EQ     — 8-band parametric + per-band dynamics
    VA Exciter        — 3-band saturation (Warm/Tape/Tube/Retro)
    VA Imager         — 3-band M/S width + Haas stereoize
    VA Maximizer      — Look-ahead brickwall limiter
    VA Low End Focus  — Bass crossover punch/smooth shaper
    VA Clarity        — Adaptive high-shelf brightness
    VA Vintage Tape   — Wow, flutter, saturation, tape emulation

  Restoration:
    VA De-clip        — Hermite reconstruction of clipped peaks
    VA De-click       — Transient delta detection + interpolation
    VA De-crackle     — Sliding median vinyl crackle filter
    VA De-hum         — IIR notch bank (50/60 Hz + harmonics)
    VA De-noise       — 4-band adaptive spectral gate
    VA De-plosive     — LP/HP energy plosive detector + gate

"@ | Out-File -Encoding utf8 (Join-Path $stagingDir "INSTALL.txt")

# ── 8. Zip distribution ────────────────────────────────────────────────────────
$zipPath = Join-Path $distDir "VirgoAudioMasters-VST3-Windows-x64.zip"
Write-Host ""
Info "Zipping to $zipPath..."
Compress-Archive -Path $stagingDir -DestinationPath $zipPath -Force
OK "ZIP created: $zipPath"

# ── 9. Optional: auto-install to system VST3 folder ──────────────────────────
if (-not $NoCopy) {
    $vst3SystemDir = "C:\Program Files\Common Files\VST3"
    Write-Host ""
    $answer = Read-Host "Copy plugins to '$vst3SystemDir' now? (requires admin — y/N)"
    if ($answer -match "^[Yy]") {
        if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            Warn "Not running as Administrator. Re-launch PowerShell as Admin and re-run with -NoCopy to skip this step."
        } else {
            New-Item -ItemType Directory -Force -Path $vst3SystemDir | Out-Null
            foreach ($item in $vst3Items) {
                $dest = Join-Path $vst3SystemDir $item.Name
                Copy-Item -Recurse -Force $item.FullName $dest
                OK "  Installed $($item.Name)"
            }
            OK "All plugins installed to $vst3SystemDir"
            Warn "Rescan plugins in your DAW to detect them."
        }
    }
}

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host "  BUILD COMPLETE" -ForegroundColor Green
Write-Host "  Output: $zipPath" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Magenta
Write-Host ""
