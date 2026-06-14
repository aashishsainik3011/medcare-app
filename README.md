# 💊 MedCare Reminder — Installation Guide

A senior-friendly medicine reminder Progressive Web App (PWA).

---

## 📁 File Structure

```
medcare/
├── index.html          ← Main app file
├── manifest.json       ← PWA manifest (makes it installable)
├── sw.js               ← Service Worker (offline support)
├── css/
│   └── style.css       ← All styles
├── js/
│   └── app.js          ← All app logic
├── icons/
│   ├── icon-72.png
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-144.png
│   ├── icon-152.png
│   ├── icon-192.png
│   ├── icon-384.png
│   └── icon-512.png
└── README.md           ← This file
```

---

## 🚀 Option 1: Run Locally (Quickest Way)

### If you have Python installed:
1. Open a terminal / command prompt
2. Navigate to the `medcare` folder:
   ```
   cd path/to/medcare
   ```
3. Start a local web server:
   ```
   python -m http.server 8000
   ```
4. Open your browser and go to:
   ```
   http://localhost:8000
   ```

### If you have Node.js installed:
```bash
cd path/to/medcare
npx serve .
```
Then open the URL shown in the terminal.

### If you have VS Code:
1. Open the `medcare` folder in VS Code
2. Install the "Live Server" extension (by Ritwick Dey)
3. Right-click on `index.html`
4. Select **"Open with Live Server"**
5. The app opens automatically in your browser

---

## 📱 Option 2: Deploy Online (Install on Phone)

### Free hosting via Netlify (Recommended):
1. Go to **https://netlify.com** and sign up (free)
2. Drag and drop your entire `medcare` folder onto the Netlify dashboard
3. You'll get a free URL like `https://your-app.netlify.app`
4. Open that URL on your Android phone in Chrome
5. Tap the **three-dot menu (⋮)** → **"Add to Home Screen"**
6. The app installs like a native app! 📱

### Free hosting via GitHub Pages:
1. Create a free GitHub account at https://github.com
2. Create a new repository (e.g., `medcare-app`)
3. Upload all files from the `medcare` folder
4. Go to Settings → Pages → Deploy from `main` branch
5. Your app will be live at `https://yourusername.github.io/medcare-app`

---

## 📲 Installing on Android Phone as an App

Once the app is running at a URL (local or online):

1. Open **Chrome** on your Android phone
2. Navigate to the app URL
3. Tap the **three-dot menu (⋮)** in top-right
4. Tap **"Add to Home Screen"** or **"Install App"**
5. Confirm installation
6. The MedCare icon appears on your home screen!

**Note:** Local URLs (localhost) can only be installed from the same device.
For installing on a phone, use an online URL (Netlify, GitHub Pages, etc.)

---

## 🍎 Installing on iPhone (iOS)

1. Open **Safari** on iPhone (must be Safari, not Chrome)
2. Navigate to the app URL
3. Tap the **Share button** (box with arrow pointing up)
4. Scroll down and tap **"Add to Home Screen"**
5. Tap **"Add"** to confirm

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 💊 Add Medicine | Manual entry or camera photo |
| 📷 Camera + OCR | Scan medicine labels automatically |
| ⏰ Reminders | Local notifications at scheduled times |
| ✅ Mark as Taken | One-tap medicine confirmation |
| 📊 History | Daily/Weekly/Monthly adherence tracking |
| 🆘 Emergency SOS | One-tap emergency contact calling |
| 🔊 Voice Reminders | Text-to-speech medicine announcements |
| 🌙 Dark Mode | Eye-friendly night-time display |
| 🔤 Large Text | Adjustable font sizes for easy reading |
| 📴 Offline | Works without internet connection |

---

## 🔧 Browser Requirements

- **Android**: Chrome 80+ (recommended)
- **iPhone**: Safari 14+ (iOS 14+)
- **Desktop**: Chrome, Edge, Firefox, Safari

---

## 🛡️ Privacy

- **All data is stored locally** on your device only
- No internet connection required after first load
- No personal data is sent to any server
- Photos are stored in your browser's local storage

---

## 📞 Need Help?

If reminders aren't working:
1. Go to **Settings** in the app
2. Tap **"Enable Notifications"**
3. Allow notifications when your browser asks
4. Make sure your phone is not in Do Not Disturb mode

---

## 🔮 Future Features (Coming Soon)

- Family caregiver dashboard
- Cloud data sync across devices
- WhatsApp reminder integration
- AI-powered medicine recognition
- Doctor appointment integration
- Multi-user (family) support

---

Made with ❤️ for senior citizens and their families.
