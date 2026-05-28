# PowerShell script to download yt-dlp, spotdl, and ffmpeg binaries for Windows
# Run this script before building the app
#
# SECURITY: Each binary is verified against its expected SHA-256 hash after download.
# To update hashes: download the binary manually, run (Get-FileHash "file").Hash,
# then update the hash below.

$binariesDir = Join-Path $PSScriptRoot "binaries"
New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null

# Pin specific versions - update hashes when changing versions
$YTDLP_VERSION = "2025.05.22"
$SPOTDL_VERSION = "4.2.10"

# --- Expected SHA-256 checksums ---
# Update these after bumping binary versions. Use uppercase hex, no spaces.
$EXPECTED_HASHES = @{
    "yt-dlp.exe"  = "8065426BC01DAA47F6318E2C590D2A68D38AF26211148034BE74D91622CFCBD0"
    "spotdl.exe"  = "877682C405B8F4DA9383C37A65D64B65BA455D26CB4B34D017E1F73C859C38EA"
    "ffmpeg.exe"  = "EB784B999C8EF9370AE8515534857474328AC26EBBE8EDC8F2344A113A522AD2"
    "ffprobe.exe" = "DED04BE812B220378D1906BA1D2E0FE56C3C4810DC8D3814447741DB8198CF66"
}

function Verify-Checksum {
    param(
        [string]$FilePath,
        [string]$ExpectedHash,
        [string]$BinaryName
    )
    if ($ExpectedHash -match "^PLACEHOLDER") {
        Write-Host "  WARNING: No pinned hash for $BinaryName - skipping verification" -ForegroundColor Yellow
        Write-Host "  Run: (Get-FileHash '$FilePath').Hash  to get the hash, then update the script" -ForegroundColor Yellow
        return $true
    }
    $actual = (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash
    if ($actual -ne $ExpectedHash) {
        Write-Host "  FATAL: Checksum mismatch for $BinaryName!" -ForegroundColor Red
        Write-Host "    Expected: $ExpectedHash" -ForegroundColor Red
        Write-Host "    Actual:   $actual" -ForegroundColor Red
        Remove-Item $FilePath -Force -ErrorAction SilentlyContinue
        throw "Checksum verification failed for $BinaryName"
    }
    Write-Host "  Checksum verified: $actual" -ForegroundColor Green
    return $true
}

# --- yt-dlp ---
Write-Host "Downloading yt-dlp v$YTDLP_VERSION..." -ForegroundColor Cyan
$ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP_VERSION/yt-dlp.exe"
$ytdlpPath = Join-Path $binariesDir "yt-dlp.exe"
Invoke-WebRequest -Uri $ytdlpUrl -OutFile $ytdlpPath -ErrorAction Stop
Write-Host "  Downloaded to: $ytdlpPath" -ForegroundColor Green
Verify-Checksum -FilePath $ytdlpPath -ExpectedHash $EXPECTED_HASHES["yt-dlp.exe"] -BinaryName "yt-dlp.exe"

# --- SpotDL ---
Write-Host "Downloading SpotDL v$SPOTDL_VERSION..." -ForegroundColor Cyan
$spotdlUrl = "https://github.com/spotDL/spotify-downloader/releases/download/v$SPOTDL_VERSION/spotdl-$SPOTDL_VERSION-win32.exe"
$spotdlPath = Join-Path $binariesDir "spotdl.exe"
try {
    Invoke-WebRequest -Uri $spotdlUrl -OutFile $spotdlPath -ErrorAction Stop
    Write-Host "  Downloaded to: $spotdlPath" -ForegroundColor Green
    Verify-Checksum -FilePath $spotdlPath -ExpectedHash $EXPECTED_HASHES["spotdl.exe"] -BinaryName "spotdl.exe"
} catch {
    Write-Host "  Error downloading SpotDL: $_" -ForegroundColor Red
    Write-Host "  You may need to download manually from: https://github.com/spotDL/spotify-downloader/releases" -ForegroundColor Yellow
    throw
}

# --- FFmpeg ---
# NOTE: BtbN/FFmpeg-Builds uses rolling "latest" tags. The hash below must be
# updated each time FFmpeg is upgraded. Download manually, compute hash, update.
Write-Host "Downloading FFmpeg..." -ForegroundColor Cyan
$ffmpegZipUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
$ffmpegZipPath = Join-Path $binariesDir "ffmpeg.zip"
$ffmpegExtractPath = Join-Path $binariesDir "ffmpeg-temp"

Invoke-WebRequest -Uri $ffmpegZipUrl -OutFile $ffmpegZipPath -ErrorAction Stop
Write-Host "  Downloaded zip to: $ffmpegZipPath" -ForegroundColor Green

Write-Host "Extracting FFmpeg..." -ForegroundColor Cyan
Expand-Archive -Path $ffmpegZipPath -DestinationPath $ffmpegExtractPath -Force

# Find, verify, then copy - fail fast before overwriting existing binaries
$ffmpegExe = Get-ChildItem -Path $ffmpegExtractPath -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
$ffprobExe = Get-ChildItem -Path $ffmpegExtractPath -Recurse -Filter "ffprobe.exe" | Select-Object -First 1

if ($ffmpegExe) {
    Verify-Checksum -FilePath $ffmpegExe.FullName -ExpectedHash $EXPECTED_HASHES["ffmpeg.exe"] -BinaryName "ffmpeg.exe"
    Copy-Item $ffmpegExe.FullName -Destination (Join-Path $binariesDir "ffmpeg.exe")
    Write-Host "  Copied ffmpeg.exe to binaries folder" -ForegroundColor Green
}

if ($ffprobExe) {
    Verify-Checksum -FilePath $ffprobExe.FullName -ExpectedHash $EXPECTED_HASHES["ffprobe.exe"] -BinaryName "ffprobe.exe"
    Copy-Item $ffprobExe.FullName -Destination (Join-Path $binariesDir "ffprobe.exe")
    Write-Host "  Copied ffprobe.exe to binaries folder" -ForegroundColor Green
}

# Clean up
Write-Host "Cleaning up..." -ForegroundColor Cyan
Remove-Item $ffmpegZipPath -Force
Remove-Item $ffmpegExtractPath -Recurse -Force

Write-Host "`nDone! Binaries downloaded to: $binariesDir" -ForegroundColor Green
Get-ChildItem $binariesDir | ForEach-Object { Write-Host "  - $($_.Name) ($([math]::Round($_.Length / 1MB, 2)) MB)" }

# --- Final summary ---
Write-Host "`nChecksums for pinned versions:" -ForegroundColor Cyan
Get-ChildItem $binariesDir -Filter "*.exe" | ForEach-Object {
    $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash
    Write-Host "  $($_.Name): $hash" -ForegroundColor Gray
}
