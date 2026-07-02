# Firefox Add-on Build Script
# Creates a clean firefox-build/ folder and packages it as .zip for AMO upload
# Uses .NET ZipFile to ensure forward slashes in paths (required by AMO)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$buildDir = "firefox-build"
$zipName = "lan-transfer-firefox.zip"
$buildPath = Join-Path $PWD $buildDir
$zipPath = Join-Path $PWD $zipName

Write-Host ""
Write-Host "Building Firefox Add-on..." -ForegroundColor Cyan

# Clean previous build
if (Test-Path $buildDir) { Remove-Item -Recurse -Force $buildDir }
if (Test-Path $zipName) { Remove-Item -Force $zipName }

# Create build directory
New-Item -ItemType Directory -Path $buildDir | Out-Null

# Copy shared files (popup, icons, lib)
Copy-Item -Recurse "popup" "$buildDir\popup"
Copy-Item -Recurse "icons" "$buildDir\icons"
Copy-Item -Recurse "lib"   "$buildDir\lib"

# Copy Firefox-specific files
Copy-Item "firefox\manifest.json" "$buildDir\manifest.json"
Copy-Item -Recurse "firefox\background" "$buildDir\background"

Write-Host "Build folder created: $buildDir" -ForegroundColor Green

# Create zip with forward slashes (AMO requirement)
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')

Get-ChildItem -Path $buildPath -Recurse -File | ForEach-Object {
    $relativePath = $_.FullName.Substring($buildPath.Length + 1)
    # Convert Windows backslashes to forward slashes
    $entryName = $relativePath.Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entryName) | Out-Null
}

$zip.Dispose()

Write-Host "Zip created: $zipName (with forward-slash paths)" -ForegroundColor Green
Write-Host ""
Write-Host "Ready to upload to https://addons.mozilla.org" -ForegroundColor Yellow
