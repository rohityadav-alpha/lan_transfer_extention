# Firefox Add-on Build Script
# Creates a clean firefox-build/ folder and packages it as .zip for AMO upload

$ErrorActionPreference = "Stop"

$buildDir = "firefox-build"
$zipName = "lan-transfer-firefox.zip"

Write-Host ""
Write-Host "Building Firefox Add-on..." -ForegroundColor Cyan

# Clean previous build
if (Test-Path $buildDir) {
    Remove-Item -Recurse -Force $buildDir
}
if (Test-Path $zipName) {
    Remove-Item -Force $zipName
}

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

# Create zip for AMO upload
Compress-Archive -Path "$buildDir\*" -DestinationPath $zipName -Force
Write-Host "Zip created: $zipName" -ForegroundColor Green
Write-Host ""
Write-Host "Ready to upload to https://addons.mozilla.org" -ForegroundColor Yellow
