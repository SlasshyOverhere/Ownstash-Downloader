# PowerShell script to download yt-dlp, spotdl, and ffmpeg binaries for Windows
# Run this script before building the app

$binariesDir = Join-Path $PSScriptRoot "binaries"
New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null

Write-Host "Downloading yt-dlp..." -ForegroundColor Cyan
$ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
$ytdlpPath = Join-Path $binariesDir "yt-dlp.exe"
Invoke-WebRequest -Uri $ytdlpUrl -OutFile $ytdlpPath
Write-Host "  Downloaded to: $ytdlpPath" -ForegroundColor Green

Write-Host "Downloading SpotDL..." -ForegroundColor Cyan
# Get the latest release info from GitHub API
$spotdlReleasesUrl = "https://api.github.com/repos/spotDL/spotify-downloader/releases/latest"
try {
    $releaseInfo = Invoke-RestMethod -Uri $spotdlReleasesUrl -Headers @{ "User-Agent" = "PowerShell" }
    $spotdlAsset = $releaseInfo.assets | Where-Object { $_.name -match "spotdl.*win.*\.exe$" } | Select-Object -First 1
    
    if ($spotdlAsset) {
        $spotdlUrl = $spotdlAsset.browser_download_url
        $spotdlPath = Join-Path $binariesDir "spotdl.exe"
        Write-Host "  Downloading from: $spotdlUrl" -ForegroundColor Yellow
        Invoke-WebRequest -Uri $spotdlUrl -OutFile $spotdlPath
        Write-Host "  Downloaded to: $spotdlPath" -ForegroundColor Green
    } else {
        Write-Host "  Warning: Could not find SpotDL Windows executable in latest release" -ForegroundColor Yellow
        Write-Host "  Trying fallback URL..." -ForegroundColor Yellow
        $spotdlUrl = "https://github.com/spotDL/spotify-downloader/releases/latest/download/spotdl-4.2.10-win32.exe"
        $spotdlPath = Join-Path $binariesDir "spotdl.exe"
        Invoke-WebRequest -Uri $spotdlUrl -OutFile $spotdlPath
        Write-Host "  Downloaded to: $spotdlPath" -ForegroundColor Green
    }
} catch {
    Write-Host "  Error downloading SpotDL: $_" -ForegroundColor Red
    Write-Host "  You may need to download manually from: https://github.com/spotDL/spotify-downloader/releases" -ForegroundColor Yellow
}

Write-Host "Downloading FFmpeg..." -ForegroundColor Cyan
$ffmpegZipUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
$ffmpegZipPath = Join-Path $binariesDir "ffmpeg.zip"
$ffmpegExtractPath = Join-Path $binariesDir "ffmpeg-temp"

Invoke-WebRequest -Uri $ffmpegZipUrl -OutFile $ffmpegZipPath
Write-Host "  Downloaded zip to: $ffmpegZipPath" -ForegroundColor Green

Write-Host "Extracting FFmpeg..." -ForegroundColor Cyan
Expand-Archive -Path $ffmpegZipPath -DestinationPath $ffmpegExtractPath -Force

# Find and copy the ffmpeg.exe file
$ffmpegExe = Get-ChildItem -Path $ffmpegExtractPath -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
$ffprobExe = Get-ChildItem -Path $ffmpegExtractPath -Recurse -Filter "ffprobe.exe" | Select-Object -First 1

if ($ffmpegExe) {
    Copy-Item $ffmpegExe.FullName -Destination (Join-Path $binariesDir "ffmpeg.exe")
    Write-Host "  Copied ffmpeg.exe to binaries folder" -ForegroundColor Green
}

if ($ffprobExe) {
    Copy-Item $ffprobExe.FullName -Destination (Join-Path $binariesDir "ffprobe.exe")
    Write-Host "  Copied ffprobe.exe to binaries folder" -ForegroundColor Green
}

# Clean up
Write-Host "Cleaning up..." -ForegroundColor Cyan
Remove-Item $ffmpegZipPath -Force
Remove-Item $ffmpegExtractPath -Recurse -Force

Write-Host "`nDone! Binaries downloaded to: $binariesDir" -ForegroundColor Green
Get-ChildItem $binariesDir | ForEach-Object { Write-Host "  - $($_.Name) ($([math]::Round($_.Length / 1MB, 2)) MB)" }

