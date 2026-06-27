# 🌐 Cloud Signaling & Private Extension Deployment Guide

Maine aapke project me ek `.gitignore` file bana di hai taaki extra files (jaise `node_modules` aur credentials) GitHub par push na hon. Ab niche diye gaye steps ko **one-by-one** follow karein.

---

## 📂 Phase 1: Code ko GitHub par push karna

Render cloud se connect karne ke liye aapka code GitHub par hona zaroori hai.

### Step 1.1: Git Repository Init karein
Apne project folder (`d:\lan-transfer-extension`) me ek naya Terminal/PowerShell open karein aur ye commands run karein:

```bash
# Git initialize karein
git init

# Apne code files ko stage karein (.gitignore ki wajah se node_modules skip ho jayega)
git add .

# Pehla commit karein
git commit -m "setup local and cloud hybrid signaling"
```

### Step 1.2: GitHub par Repository banayein
1. [GitHub](https://github.com/) par login karein.
2. Top-right corner me **`+`** icon par click karke **New repository** select karein.
3. Repository name daalein (jaise: `lan-file-transfer`).
4. Isse **Public** ya **Private** rakh sakte hain (dono me Render chalega). Baaki settings ko default chhod kar **Create repository** par click karein.

### Step 1.3: Code Push karein
GitHub page par jo commands dikhegi, unhe terminal me paste karein. Ya phir ye run karein:

```bash
# Apne local branch ko main name dein
git branch -M main

# Apne GitHub repository ko link karein (Apna URL replace karein)
git remote add origin https://github.com/YOUR_USERNAME/lan-file-transfer.git

# Code push karein
git push -u origin main
```

---

## 🚀 Phase 2: Signaling Server ko Render par Deploy karna

Render par humara server bina kisi cost ke (Free tier par) hamesha chalta rahega.

### Step 2.1: Render par Signup karein
1. [Render Dashboard](https://dashboard.render.com/) par jayein.
2. **GitHub** option select karke apna account link karein.

### Step 2.2: Web Service Create karein
1. Render Dashboard par right side me **New +** button par click karein aur **Web Service** select karein.
2. Apni GitHub repository (`lan-file-transfer`) ke samne **Connect** par click karein.

### Step 2.3: Configuration Settings bharein
Niche likhi hui details ko dhyan se set karein:
* **Name:** `lan-transfer-signaling`
* **Region:** Agar aap India me hain, toh **Singapore (Southeast Asia)** select karein (isase ping fast milegi).
* **Branch:** `main`
* **Root Directory:** ise **khali (blank)** chhod dein.
* **Runtime:** `Node`
* **Build Command:** `npm install`
* **Start Command:** `npm start`
* **Instance Type:** **Free** select karein.

Settings bharne ke baad sabse niche scroll karein aur **Deploy Web Service** par click kar dein.

### Step 2.4: Render WebSocket URL copy karein
1. 2-3 minute me status changed ho kar **"Live"** ho jayega.
2. Page ke top-left corner me aapko ek HTTP link dikhega, jaise:
   `https://lan-transfer-signaling-xxxx.onrender.com`
3. Is URL ko copy karein aur use **WebSocket URL** me convert karein:
   * URL ke aage se `https://` hata kar **`wss://`** likh dein.
   * **Example:** `wss://lan-transfer-signaling-xxxx.onrender.com`

---

## ⚙️ Phase 3: Extension Configuration Code Update

Ab extension ko batana hoga ki use cloud server se connect hona hai.

1. Apne editor me **[popup/popup.js](file:///d:/lan-transfer-extension/popup/popup.js)** open karein.
2. Sabse top par `CONFIG` block ko is tarah se edit karein:

```javascript
// ═══════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════
const CONFIG = {
  // Yahan apna Render wala wss:// link paste karein
  SIGNALING_URL: 'wss://lan-transfer-signaling-xxxx.onrender.com' 
};
```

3. File ko **Save** kar dein.

---

## 📦 Phase 4: Extension ko `.crx` file me compile karna

Aapko users ko Node.js run karne ya commands dene ki zaroorat nahi hai. Ab hum extension ka installable app bundle banayenge.

### Step 4.1: Chrome Extensions Console open karein
1. Chrome browser me new tab me jayein aur type karein: `chrome://extensions/`
2. Top-right corner me **Developer mode** toggle ko **ON** karein.

### Step 4.2: Extension Pack karein
1. Left side me **Pack extension** button par click karein.
2. Ek popup window khulegi:
   * **Extension root directory:** Click `Browse` aur select karein `d:\lan-transfer-extension` (jismein `manifest.json` file hai).
   * **Private key file (optional):** Ise **bilkul khali (empty)** chhod dein.
3. Niche **Pack Extension** par click kar dein.

### Step 4.3: Files Collect karein
Chrome browser is folder ke parallel me do files save karega (yani `d:\` drive me):
1. **`lan-transfer-extension.crx`**: Ye aapki final application file hai jo aapko users ko share karni hai.
2. **`lan-transfer-extension.pem`**: Ye aapki private cryptographic key hai. **Ise hamesha safe aur secret rakhein.** Future me jab aap extension me koi update karenge, toh isi key ki zaroorat padegi update sign karne ke liye.

---

## 📥 Phase 5: Users ke PC par Install karna

Ab aap `.crx` file ko WhatsApp, Email, Google Drive, ya USB ke through kisi ko bhi de sakte hain.

### User ke PC par Installation steps:
1. User se kahein ki wo apne Chrome browser me `chrome://extensions/` page open karein.
2. Page ke right-side me **Developer mode** toggle ko **ON** karne ko kahein.
3. Jo `.crx` file aapne unhe bheji hai, use folder se drag karke Chrome window ke andar **drop (phenk)** dene ko kahein.
4. Chrome ek popup dikhayega: *"Add LAN File Transfer?"* -> Click **Add extension**.

**🎉 Badhai ho!** Ab aapka extension unke system par bina Node.js setup ke, direct cloud signaling ke through 100% fast peer-to-peer transfers karega!
