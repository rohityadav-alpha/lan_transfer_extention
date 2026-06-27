# 🚀 LAN File Transfer — Production Deployment Guide

## Option 1: Chrome Web Store (Recommended)

This is the standard way to distribute Chrome extensions to the public.

### Step 1: Create a Developer Account
1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Sign in with your Google account
3. Pay the one-time **$5 developer registration fee**
4. Accept the developer agreement

### Step 2: Prepare the Extension Package
```bash
cd d:\lan-transfer-extension
```

Create a ZIP of **only the extension files** (NOT the signaling server or node_modules):

```bash
# Create a clean folder for packaging
mkdir dist
xcopy /E /I icons dist\icons
xcopy /E /I popup dist\popup
xcopy /E /I background dist\background
xcopy /E /I lib dist\lib
copy manifest.json dist\

# Then ZIP the dist folder contents
cd dist
# Right-click → Send to → Compressed (zipped) folder
# OR use PowerShell:
Compress-Archive -Path * -DestinationPath ..\lan-transfer-extension.zip
cd ..
```

### Step 3: Upload to Chrome Web Store
1. Go to the [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click **"New Item"**
3. Upload `lan-transfer-extension.zip`
4. Fill in the store listing:
   - **Name**: LAN File Transfer
   - **Description**: Transfer files directly between browsers on the same local network — no internet, no cloud, no USB. Peer-to-peer via WebRTC.
   - **Category**: Productivity
   - **Language**: English
5. Upload screenshots (1280×800 or 640×400)
6. Upload a promotional tile image (440×280)
7. Click **"Submit for Review"**

> [!NOTE]
> Review typically takes **1–3 business days**. Google checks for policy compliance.

---

## Option 2: Self-Distribution (.crx file)

If you don't want to publish on the Web Store (e.g., internal team use):

### Pack the Extension
1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **"Pack extension"**
4. Browse to `d:\lan-transfer-extension` as the extension root directory
5. Leave the private key field empty (first time)
6. Click **"Pack Extension"**

This creates:
- `lan-transfer-extension.crx` — the packaged extension
- `lan-transfer-extension.pem` — your private key (keep this safe for updates!)

### Distribute the .crx
Share the `.crx` file with your users. They can install it by:
1. Going to `chrome://extensions/`
2. Enabling Developer mode
3. Dragging the `.crx` file onto the page

> [!WARNING]
> Chrome will show a warning for extensions not from the Web Store. Users must explicitly confirm installation. Chrome may also disable it periodically.

---

## Option 3: Enterprise Deployment (Group Policy)

For corporate/organizational use:

1. Pack the extension as a `.crx` (see Option 2)
2. Host the `.crx` on an internal server
3. Create an `update.xml` manifest:
```xml
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='YOUR_EXTENSION_ID'>
    <updatecheck codebase='https://internal-server/lan-transfer.crx' version='1.0.0' />
  </app>
</gupdate>
```
4. Use Group Policy to force-install:
   - Policy: `ExtensionInstallForcelist`
   - Value: `YOUR_EXTENSION_ID;https://internal-server/update.xml`

---

## The Signaling Server

> [!IMPORTANT]
> The signaling server (`npm start`) must be running on the **sender's machine** for transfers to work. This is a Node.js process that runs locally — it does NOT need to be deployed to a cloud server.

### For end users, include these instructions:

**Prerequisites:**
- Node.js 18+ installed ([download](https://nodejs.org))

**Setup (one-time):**
```bash
cd lan-transfer-extension/
npm install
```

**Before each transfer:**
```bash
npm start
```

This starts the signaling server on port 3000. Share the displayed network IP with the receiver.

### Optional: Run as a Background Service

**Windows (using nssm):**
```bash
nssm install LANTransfer "C:\Program Files\nodejs\node.exe" "d:\lan-transfer-extension\signaling\signaling-server.js"
nssm start LANTransfer
```

**Linux/macOS (using pm2):**
```bash
npm install -g pm2
pm2 start signaling/signaling-server.js --name lan-transfer
pm2 save
pm2 startup
```

---

## Checklist Before Publishing

- [ ] Test on two different machines on the same LAN
- [ ] Test with small (<1MB), medium (~50MB), and large (500MB+) files
- [ ] Verify error handling (wrong code, wrong IP, server down)
- [ ] Remove any `console.log` statements for production (optional)
- [ ] Verify icons display correctly at all sizes
- [ ] Add privacy policy URL (required for Web Store)
- [ ] Take clean screenshots for the store listing
