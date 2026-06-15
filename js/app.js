/* ============================================
   MEDCARE REMINDER - MAIN APP LOGIC
   v1.0.0
============================================ */

'use strict';

// ============================================
// DATA LAYER
// ============================================
const DB = {
  get(key) {
    try { return JSON.parse(localStorage.getItem('mc_' + key)) || null; } catch { return null; }
  },
  set(key, val) {
    try { localStorage.setItem('mc_' + key, JSON.stringify(val)); return true; } catch { return false; }
  },
  push(key, item) {
    const arr = this.get(key) || [];
    arr.push(item);
    return this.set(key, arr);
  },
  remove(key, id) {
    const arr = (this.get(key) || []).filter(i => i.id !== id);
    return this.set(key, arr);
  },
  update(key, id, updater) {
    const arr = (this.get(key) || []).map(i => i.id === id ? updater(i) : i);
    return this.set(key, arr);
  }
};

// ============================================
// UTILITIES
// ============================================
const Util = {
  uid: () => Date.now().toString(36) + Math.random().toString(36).slice(2),
  today: () => new Date().toISOString().split('T')[0],
  now: () => new Date().toTimeString().slice(0, 5),
  fmtDate: (d) => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  },
  fmtTime: (t) => {
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 || 12;
    return `${hh}:${m.toString().padStart(2, '0')} ${ampm}`;
  },
  slotToTime: (slot) => {
    const map = { morning: '08:00', afternoon: '13:00', evening: '18:00', night: '21:00' };
    return map[slot] || '08:00';
  },
  slotLabel: (slot) => {
    const map = { morning: '🌅 Morning', afternoon: '☀️ Afternoon', evening: '🌆 Evening', night: '🌙 Night' };
    return map[slot] || slot;
  },
  typeEmoji: (type) => {
    const map = { tablet: '💊', capsule: '💉', syrup: '🧴', injection: '💉', drops: '💧', other: '📦' };
    return map[type] || '💊';
  },
  greeting: () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning!';
    if (h < 17) return 'Good Afternoon!';
    if (h < 20) return 'Good Evening!';
    return 'Good Night!';
  },
  timeToMinutes: (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  },

  // Returns true if a medicine should appear/fire on a given date string
  isScheduledOnDate(med, dateStr) {
    const freq = med.frequency || 'daily';
    if (freq === 'daily' || freq === 'as-needed') return true;

    if (freq === 'monthly') {
      if (!med.startDate) return true;
      return dateStr.slice(8) === med.startDate.slice(8);
    }

    if (freq === 'weekly') {
      // Parse day-of-week from the date string directly (avoids timezone issues)
      const [y, mo, d] = dateStr.split('-').map(Number);
      const dayOfWeek = new Date(y, mo - 1, d).getDay(); // 0=Sun … 6=Sat

      if (med.weekdays && med.weekdays.length > 0) {
        return med.weekdays.includes(dayOfWeek);
      }
      // Legacy medicine with no weekdays saved — use start date's weekday
      if (med.startDate) {
        const [sy, sm, sd] = med.startDate.split('-').map(Number);
        const startDay = new Date(sy, sm - 1, sd).getDay();
        return dayOfWeek === startDay;
      }
      // Absolute fallback — only on Mondays
      return dayOfWeek === 1;
    }

    return true;
  }
};

// ============================================
// OCR ENGINE (Tesseract.js via CDN or fallback)
// ============================================
const OCR = {
  async extractText(imageData) {
    // Try Tesseract.js if loaded
    if (typeof Tesseract !== 'undefined') {
      try {
        const result = await Tesseract.recognize(imageData, 'eng', {
          logger: () => {}
        });
        return result.data.text;
      } catch (e) {
        console.warn('Tesseract error:', e);
      }
    }
    // Fallback: simulate OCR with common medicine patterns
    return null;
  },

  parseMedicineText(text) {
    if (!text) return { name: '', dosage: '', extra: '' };

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Dosage patterns: 500mg, 650 mg, 10ml, 5mg/5ml
    const dosageRegex = /(\d+\.?\d*)\s*(mg|mcg|ml|g|iu|%|mg\/ml|mg\/5ml)/i;
    let dosage = '';
    let name = '';
    let extra = '';

    for (const line of lines) {
      const dMatch = line.match(dosageRegex);
      if (dMatch && !dosage) {
        dosage = dMatch[0].replace(/\s+/g, '');
        // Name is usually on same or previous line
        const namePart = line.replace(dosageRegex, '').trim();
        if (namePart.length > 2) name = namePart;
      } else if (!name && line.length > 3 && line.length < 40) {
        // First reasonable-length line is likely the name
        name = line;
      } else if (name && dosage && !extra && line.length > 3) {
        extra = line;
      }
    }

    // Clean up name
    name = name.replace(/[^a-zA-Z0-9\s\-\+]/g, '').trim();

    return { name: name || '', dosage: dosage || '', extra: extra || '' };
  }
};

// ============================================
// ALARM AUDIO ENGINE
// Uses Web Audio API — no audio file needed.
// Generates a real alarm tone in the browser.
// ============================================
const AlarmAudio = {
  ctx: null,
  nodes: [],
  playing: false,

  _getCtx() {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (browser autoplay policy)
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },

  // Plays a repeating medical-alert beep pattern
  play() {
    if (this.playing) return;
    this.playing = true;
    this._loop();
  },

  _loop() {
    if (!this.playing) return;
    try {
      const ctx = this._getCtx();
      const settings = DB.get('settings') || {};
      const vol = parseFloat(settings.volume ?? 0.8);

      // Pattern: three rising beeps
      const pattern = [
        { freq: 880, start: 0,    dur: 0.18 },
        { freq: 988, start: 0.22, dur: 0.18 },
        { freq: 1100,start: 0.44, dur: 0.28 },
      ];

      pattern.forEach(({ freq, start, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + start);

        gain.gain.setValueAtTime(0, ctx.currentTime + start);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);

        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.05);
        this.nodes.push(osc);
      });

      // Repeat every 2 seconds
      this._loopTimer = setTimeout(() => this._loop(), 2000);
    } catch (e) {
      console.warn('AlarmAudio error:', e);
    }
  },

  stop() {
    this.playing = false;
    clearTimeout(this._loopTimer);
    this.nodes.forEach(n => { try { n.stop(); } catch(_) {} });
    this.nodes = [];
  },

  // One-shot beep for "taken" confirmation
  beepSuccess() {
    try {
      const ctx = this._getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 660;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } catch(_) {}
  }
};

// ============================================
// REMINDER ENGINE
// Uses setInterval polling (every 30s) instead
// of setTimeout — survives screen lock & bg tabs.
// ============================================
const Reminders = {
  _pollInterval: null,
  _firedToday: {},   // key: "medId_time_date" → true, prevents double-firing
  _snoozeUntil: {},  // key: "medId_time" → timestamp when snooze expires
  _activeAlarm: null,// currently showing alarm data

  // Call once on app start
  startPolling() {
    // Restore fired-today from storage so page reload doesn't re-fire
    this._firedToday = DB.get('firedToday') || {};
    this._snoozeUntil = DB.get('snoozeUntil') || {};

    // Clear yesterday's fired records
    const today = Util.today();
    let dirty = false;
    Object.keys(this._firedToday).forEach(k => {
      if (!k.endsWith('_' + today)) { delete this._firedToday[k]; dirty = true; }
    });
    if (dirty) DB.set('firedToday', this._firedToday);

    // ── ONE-TIME CLEANUP ────────────────────
    // Remove any 'missed' history entries that were written on a day the
    // medicine was not actually scheduled (bug from earlier code versions).
    this._cleanupBadMissedEntries();

    // Poll immediately, then every 30 seconds
    this._poll();
    this._pollInterval = setInterval(() => this._poll(), 30_000);

    // Also poll when tab becomes visible again (user returns to app)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this._poll();
    });
  },

  _cleanupBadMissedEntries() {
    const medicines = DB.get('medicines') || [];
    const history = DB.get('history') || [];
    const before = history.length;

    const cleaned = history.filter(h => {
      if (h.status !== 'missed') return true; // keep all non-missed entries
      const med = medicines.find(m => m.id === h.medicineId);
      if (!med) return true; // medicine deleted — keep entry
      // Remove if the medicine was NOT scheduled on the day this entry was logged
      return Util.isScheduledOnDate(med, h.date);
    });

    if (cleaned.length !== before) {
      DB.set('history', cleaned);
      console.log(`MedCare: cleaned ${before - cleaned.length} invalid missed entries`);
    }
  },

  _poll() {
    const now = new Date();
    const today = Util.today();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    const medicines = DB.get('medicines') || [];
    const history = DB.get('history') || [];

    medicines.forEach(med => {
      if (!med.active) return;
      if (med.startDate && today < med.startDate) return;
      if (med.endDate && today > med.endDate) return;

      // Skip if not scheduled today (weekly/monthly frequency check)
      if (!Util.isScheduledOnDate(med, today)) return;

      (med.reminders || []).forEach(r => {
        const [rh, rm] = r.time.split(':').map(Number);
        const rMin = rh * 60 + rm;
        const firedKey = `${med.id}_${r.time}_${today}`;
        const snoozeKey = `${med.id}_${r.time}`;

        // Already logged as taken/taken-late/skipped → skip
        const logged = history.some(h =>
          h.medicineId === med.id && h.date === today &&
          h.scheduledTime === r.time &&
          (h.status === 'taken' || h.status === 'taken-late' || h.status === 'skipped')
        );
        if (logged) return;

        // Within the fire window: from scheduled time up to 29 min after
        const diff = nowMin - rMin;
        if (diff < 0 || diff >= 29) return;

        // Check snooze
        const snoozeTs = this._snoozeUntil[snoozeKey] || 0;
        if (Date.now() < snoozeTs) return;

        // Already fired this slot today?
        if (this._firedToday[firedKey]) return;

        // 🔥 FIRE
        this._firedToday[firedKey] = true;
        DB.set('firedToday', this._firedToday);
        this._fireAlarm(med, r.time);
      });

      // Missed check: 30+ min past with no log → mark missed
      // Only runs if today is a scheduled day for this medicine (guard already
      // checked above, but kept here explicitly for clarity)
      if (!Util.isScheduledOnDate(med, today)) return;

      (med.reminders || []).forEach(r => {
        const [rh, rm] = r.time.split(':').map(Number);
        const rMin = rh * 60 + rm;
        const diff = nowMin - rMin;
        if (diff < 30) return;

        const alreadyLogged = history.some(h =>
          h.medicineId === med.id && h.date === today &&
          h.scheduledTime === r.time &&
          (h.status === 'taken' || h.status === 'taken-late' || h.status === 'skipped')
        );
        if (alreadyLogged) return;

        const missedKey = `missed_${med.id}_${r.time}_${today}`;
        if (this._firedToday[missedKey]) return;

        this._firedToday[missedKey] = true;
        DB.set('firedToday', this._firedToday);

        DB.push('history', {
          id: Util.uid(),
          medicineId: med.id,
          medicineName: med.name,
          dosage: med.dosage,
          date: today,
          scheduledTime: r.time,
          actualTime: null,
          status: 'missed',
          timestamp: Date.now()
        });
        App.refreshDashboard();
      });
    });
  },

  _fireAlarm(medicine, time) {
    // System notification (works even if tab is in background)
    Notify.send(
      `💊 Time to take ${medicine.name}`,
      `${medicine.dosage} — scheduled at ${Util.fmtTime(time)}`,
      `${medicine.id}_${time}`
    );

    // Vibration
    const settings = DB.get('settings') || {};
    if (settings.vibration !== false && navigator.vibrate) {
      navigator.vibrate([400, 150, 400, 150, 600]);
    }

    // Voice
    if (settings.voice) {
      Speech.say(`Time to take ${medicine.name}, ${medicine.dosage}`);
    }

    // Full-screen alarm dialog + audio
    App.showAlarmDialog(medicine, time);

    // Repeat alarm every 5 min if not dismissed and setting is on
    if (settings.repeat !== false) {
      const snoozeKey = `${medicine.id}_${time}`;
      this._snoozeUntil[snoozeKey] = Date.now() + 5 * 60 * 1000;
      DB.set('snoozeUntil', this._snoozeUntil);
    }
  },

  snooze(medicineId, time, minutes = 5) {
    const key = `${medicineId}_${time}`;
    this._snoozeUntil[key] = Date.now() + minutes * 60 * 1000;
    DB.set('snoozeUntil', this._snoozeUntil);

    // Also clear fired flag so it re-fires after snooze
    const today = Util.today();
    const firedKey = `${medicineId}_${time}_${today}`;
    delete this._firedToday[firedKey];
    DB.set('firedToday', this._firedToday);
  },

  dismiss(medicineId, time) {
    // Mark snooze far in future so it never re-fires today
    const key = `${medicineId}_${time}`;
    this._snoozeUntil[key] = Date.now() + 24 * 60 * 60 * 1000;
    DB.set('snoozeUntil', this._snoozeUntil);
  },

  scheduleAll() {
    // Legacy shim — polling handles everything now
    this.startPolling();
  },

  schedule() {
    // No-op — polling handles scheduling
  },

  clear() {
    // No-op — polling checks active flag
  }
};

// ============================================
// NOTIFICATIONS
// ============================================
const Notify = {
  async requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const result = await Notification.requestPermission();
    return result === 'granted';
  },

  send(title, body, tag = 'medcare') {
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, {
        body,
        tag,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-72.png',
        requireInteraction: true
      });
    } catch (e) {
      console.warn('Notification error:', e);
    }
  }
};

// ============================================
// SPEECH / VOICE
// ============================================
const Speech = {
  say(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.85;
    utter.pitch = 1;
    utter.volume = 1;
    window.speechSynthesis.speak(utter);
  },
  readMedicine(med) {
    this.say(`${med.name}, ${med.dosage}. ${med.notes || ''}`);
  }
};

// ============================================
// MAIN APP
// ============================================
const App = {
  currentScreen: 'dashboard',
  currentMedicineType: 'tablet',
  capturedImageData: null,
  scheduleDate: new Date(),
  deferredInstallPrompt: null,
  activeNotifPopup: null,

  // ── INIT ─────────────────────────────────
  init() {
    this.applySettings();
    this.updateDashboard();
    this.loadSchedule();
    Reminders.scheduleAll();

    // Splash → App
    setTimeout(() => {
      const splash = document.getElementById('splash-screen');
      splash.classList.add('fade-out');
      setTimeout(() => {
        splash.style.display = 'none';
        document.getElementById('app').classList.remove('hidden');
      }, 500);
    }, 2000);

    // PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      this.showInstallBanner();
    });

    // Notification permission
    setTimeout(() => Notify.requestPermission(), 3000);

    // Set today's date on add form
    const today = Util.today();
    const startEl = document.getElementById('med-start');
    if (startEl) startEl.value = today;

    // Check every minute for reminders
    setInterval(() => {
      this.refreshDashboard();
    }, 60000);
  },

  // ── NAVIGATION ────────────────────────────
  navigate(screen, data = null) {
    // Track previous screen for smart back button
    if (this.currentScreen !== screen) {
      this.previousScreen = this.currentScreen;
    }

    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

    // Show target screen
    const el = document.getElementById('screen-' + screen);
    if (!el) return;
    el.classList.add('active');

    this.currentScreen = screen;

    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const navBtn = document.querySelector(`.nav-btn[data-screen="${screen}"]`);
    if (navBtn) navBtn.classList.add('active');

    // Header
    const headerTitles = {
      dashboard: 'MedCare',
      'add-medicine': 'Add Medicine',
      schedule: 'Medicine Schedule',
      'medicine-detail': 'Medicine Details',
      'my-medicines': 'My Medicines',
      history: 'History',
      emergency: 'Emergency',
      profile: 'My Profile',
      settings: 'Settings'
    };
    document.getElementById('header-title').textContent = headerTitles[screen] || 'MedCare';

    const backBtn = document.getElementById('back-btn');
    if (screen === 'dashboard') {
      backBtn.classList.add('hidden');
    } else {
      backBtn.classList.remove('hidden');
    }

    // Screen-specific setup
    if (screen === 'schedule') this.loadSchedule();
    if (screen === 'history') this.loadHistory('daily');
    if (screen === 'emergency') this.loadContacts();
    if (screen === 'dashboard') this.refreshDashboard();
    if (screen === 'my-medicines') this.loadMyMedicines();
    if (screen === 'profile') this.loadProfile();
    if (screen === 'medicine-detail') {
      if (data) {
        this.showMedicineDetail(data);
      } else {
        this.goBack(); return;
      }
    }

    // Scroll to top
    el.scrollTop = 0;
  },

  goBack() {
    const prev = this.previousScreen || 'dashboard';
    this.navigate(prev);
  },

  // ── DASHBOARD STAT CARDS ──────────────────
  showStatDetail(type) {
    const medicines = DB.get('medicines') || [];
    const history   = DB.get('history')   || [];
    const today     = Util.today();
    const nowMin    = Util.timeToMinutes(Util.now());

    const titles = {
      today:    "Today's Medicines",
      taken:    "Taken Today",
      upcoming: "Upcoming Reminders",
      missed:   "Missed Today"
    };

    let rows = [];

    if (type === 'today') {
      // All slots scheduled for today
      medicines.forEach(med => {
        if (!med.active) return;
        if (med.startDate && today < med.startDate) return;
        if (med.endDate   && today > med.endDate)   return;
        if (!Util.isScheduledOnDate(med, today))    return;
        (med.reminders || []).forEach(r => {
          const hist = history.find(h =>
            h.medicineId === med.id && h.date === today && h.scheduledTime === r.time
          );
          const status = hist ? hist.status : 'pending';
          rows.push({ med, time: r.time, status });
        });
      });

    } else if (type === 'taken') {
      // Taken or taken-late today
      history
        .filter(h => h.date === today && (h.status === 'taken' || h.status === 'taken-late'))
        .forEach(h => {
          const med = medicines.find(m => m.id === h.medicineId);
          if (med) rows.push({ med, time: h.scheduledTime, status: 'taken', actual: h.actualTime });
        });

    } else if (type === 'upcoming') {
      // Pending slots whose time hasn't passed yet
      medicines.forEach(med => {
        if (!med.active) return;
        if (med.startDate && today < med.startDate) return;
        if (med.endDate   && today > med.endDate)   return;
        if (!Util.isScheduledOnDate(med, today))    return;
        (med.reminders || []).forEach(r => {
          const rMin = Util.timeToMinutes(r.time);
          if (rMin <= nowMin) return; // already past
          const logged = history.some(h =>
            h.medicineId === med.id && h.date === today && h.scheduledTime === r.time
          );
          if (!logged) rows.push({ med, time: r.time, status: 'pending' });
        });
      });
      // Sort by time ascending
      rows.sort((a, b) => Util.timeToMinutes(a.time) - Util.timeToMinutes(b.time));

    } else if (type === 'missed') {
      // Missed entries logged today where medicine was actually scheduled
      history
        .filter(h => h.date === today && h.status === 'missed')
        .forEach(h => {
          const med = medicines.find(m => m.id === h.medicineId);
          if (!med) return;
          if (!Util.isScheduledOnDate(med, h.date)) return;
          rows.push({ med, time: h.scheduledTime, status: 'missed' });
        });
    }

    // Build modal content
    const emptyHtml = `
      <div style="text-align:center;padding:32px 0;color:var(--text-secondary);">
        <div style="font-size:48px;margin-bottom:12px">${type === 'missed' ? '✅' : '📋'}</div>
        <p style="font-weight:700;font-size:var(--font-size-base)">
          ${type === 'missed' ? 'No missed medicines!' : 'Nothing to show'}
        </p>
      </div>`;

    const rowsHtml = rows.map(({ med, time, status, actual }) => {
      const photoHtml = med.photo
        ? `<img src="${med.photo}" style="width:44px;height:44px;border-radius:10px;object-fit:cover;flex-shrink:0;border:2px solid var(--border)"/>`
        : `<div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,var(--primary),var(--primary-light));display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${Util.typeEmoji(med.type)}</div>`;

      const badgeColor =
        status === 'taken' || status === 'taken-late' ? '#3A7D44' :
        status === 'missed' ? 'var(--red)' :
        status === 'pending' ? '#9B8FD4' : 'var(--text-secondary)';

      const badgeLabel =
        status === 'taken' || status === 'taken-late' ? 'Taken' :
        status === 'missed' ? 'Missed' : 'Pending';

      const timeNote = actual
        ? `Scheduled ${Util.fmtTime(time)} · Taken ${Util.fmtTime(actual)}`
        : `Scheduled ${Util.fmtTime(time)}`;

      // Show Mark as Taken button for missed items
      const actionBtn = status === 'missed'
        ? `<button onclick="App.closeModal();App.markTaken('${med.id}','${time}','${today}',true)"
            style="margin-top:8px;width:100%;background:var(--primary);color:white;border:none;border-radius:10px;padding:10px;font-size:14px;font-weight:800;font-family:'Nunito',sans-serif;cursor:pointer;">
            Mark as Taken
           </button>`
        : '';

      return `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:14px 0;border-bottom:1px solid var(--border);">
          ${photoHtml}
          <div style="flex:1;min-width:0;">
            <div style="font-size:var(--font-size-base);font-weight:800;color:var(--text)">${med.name}</div>
            <div style="font-size:13px;color:var(--primary);font-weight:700">${med.dosage}</div>
            <div style="font-size:13px;color:var(--text-secondary);font-weight:600">${timeNote}</div>
            ${actionBtn}
          </div>
          <span style="font-size:12px;font-weight:800;color:white;background:${badgeColor};padding:3px 10px;border-radius:20px;flex-shrink:0;">${badgeLabel}</span>
        </div>`;
    }).join('');

    this.showModal(`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div class="modal-title" style="margin-bottom:0">${titles[type]}</div>
        <span style="font-size:24px;font-weight:900;color:var(--primary)">${rows.length}</span>
      </div>
      ${rows.length === 0 ? emptyHtml : rowsHtml}
      <button class="modal-btn modal-btn--secondary" style="margin-top:16px" onclick="App.closeModal()">Close</button>
    `);
  },

  // ── DASHBOARD ─────────────────────────────
  refreshDashboard() {
    this.updateDashboard();
  },

  updateDashboard() {
    const settings = DB.get('settings') || {};
    const profile = DB.get('profile') || {};
    const name = profile.name || settings.name || '';

    document.getElementById('greeting-time').textContent = Util.greeting();
    document.getElementById('user-name-display').textContent =
      name ? `Hello, ${name}!` : 'Welcome!';

    // Profile photo on dashboard
    this._applyAvatarToElement(
      document.getElementById('dash-avatar-img'),
      document.getElementById('dash-avatar-placeholder'),
      profile.photo
    );

    const medicines = DB.get('medicines') || [];
    const history = DB.get('history') || [];
    const today = Util.today();
    const now = Util.timeToMinutes(Util.now());

    // Today's medicines — only those scheduled for today
    const todayMeds = medicines.filter(m => {
      if (!m.active) return false;
      if (m.startDate && today < m.startDate) return false;
      if (m.endDate && today > m.endDate) return false;
      if (!Util.isScheduledOnDate(m, today)) return false;
      return true;
    });

    const totalSlots = todayMeds.reduce((acc, m) => acc + (m.reminders || []).length, 0);
    document.getElementById('stat-today').textContent = totalSlots;

    // Taken today (includes taken-late)
    const takenCount = history.filter(h => h.date === today && (h.status === 'taken' || h.status === 'taken-late')).length;
    const takenEl = document.getElementById('stat-taken');
    takenEl.textContent = takenCount;
    takenEl.style.color = takenCount > 0 ? '#3A7D44' : '#212121';

    // Missed today — only count if the medicine was actually scheduled on that date
    const missedCount = history.filter(h => {
      if (h.date !== today) return false;
      if (h.status !== 'missed') return false;
      // Find the medicine and verify it was scheduled on the date the entry was logged
      const med = medicines.find(m => m.id === h.medicineId);
      if (!med) return false;
      return Util.isScheduledOnDate(med, h.date);
    }).length;
    const missedEl = document.getElementById('stat-missed');
    missedEl.textContent = missedCount;
    missedEl.style.color = missedCount > 0 ? '#C0392B' : '#3A7D44';

    // Upcoming (scheduled after now)
    let upcoming = 0;
    todayMeds.forEach(m => {
      (m.reminders || []).forEach(r => {
        const rMin = Util.timeToMinutes(r.time);
        const alreadyLogged = history.some(h =>
          h.medicineId === m.id && h.date === today && h.scheduledTime === r.time
        );
        if (rMin > now && !alreadyLogged) upcoming++;
      });
    });
    document.getElementById('stat-upcoming').textContent = upcoming;

    // Next reminder
    let nextMed = null, nextTime = Infinity, nextTimeStr = '';
    todayMeds.forEach(m => {
      (m.reminders || []).forEach(r => {
        const rMin = Util.timeToMinutes(r.time);
        const alreadyLogged = history.some(h =>
          h.medicineId === m.id && h.date === today && h.scheduledTime === r.time
        );
        if (rMin > now && !alreadyLogged && rMin < nextTime) {
          nextTime = rMin;
          nextTimeStr = r.time;
          nextMed = m;
        }
      });
    });

    const nextCard = document.getElementById('next-reminder-card');
    if (nextMed) {
      nextCard.style.display = 'flex';
      document.getElementById('next-med-name').textContent = `${nextMed.name} ${nextMed.dosage}`;
      document.getElementById('next-med-time').textContent = Util.fmtTime(nextTimeStr);
    } else {
      nextCard.style.display = 'none';
    }
  },

  onFrequencyChange(val) {
    const group = document.getElementById('weekday-group');
    if (group) group.classList.toggle('hidden', val !== 'weekly');
  },

  toggleWeekday(btn) {
    btn.classList.toggle('active');
  },

  getSelectedWeekdays() {
    const chips = document.querySelectorAll('#weekday-group .weekday-chip.active');
    return Array.from(chips).map(c => parseInt(c.dataset.day));
  },

  // ── ADD MEDICINE ──────────────────────────
  switchTab(tab) {
    document.getElementById('tab-manual').classList.toggle('active', tab === 'manual');
    document.getElementById('tab-camera').classList.toggle('active', tab === 'camera');
    document.getElementById('manual-entry').classList.toggle('hidden', tab !== 'manual');
    document.getElementById('camera-entry').classList.toggle('hidden', tab !== 'camera');
  },

  selectType(btn) {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.currentMedicineType = btn.dataset.type;
  },

  addTimeSlot() {
    const list = document.getElementById('reminder-times-list');
    const row = document.createElement('div');
    row.className = 'reminder-time-row';
    row.innerHTML = `
      <select class="form-input time-slot-select">
        <option value="morning">🌅 Morning (8:00 AM)</option>
        <option value="afternoon">☀️ Afternoon (1:00 PM)</option>
        <option value="evening">🌆 Evening (6:00 PM)</option>
        <option value="night">🌙 Night (9:00 PM)</option>
      </select>
      <input type="time" class="form-input time-custom" value="08:00" />
      <button onclick="this.parentElement.remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:#D32F2F;padding:0 4px;">✕</button>
    `;
    list.appendChild(row);
  },

  collectReminders(containerSelector) {
    const reminders = [];
    const rows = document.querySelectorAll(`${containerSelector} .reminder-time-row`);
    rows.forEach(row => {
      const slot = row.querySelector('.time-slot-select')?.value || 'morning';
      const customTime = row.querySelector('.time-custom')?.value;
      reminders.push({
        slot,
        time: customTime || Util.slotToTime(slot)
      });
    });
    return reminders;
  },

  saveMedicine() {
    const name = document.getElementById('med-name').value.trim();
    const dosage = document.getElementById('med-dosage').value.trim();
    if (!name) { this.toast('Please enter medicine name', 'error'); return; }

    const frequency = document.getElementById('med-frequency').value;

    // Validate weekday selection for weekly medicines
    let weekdays = [];
    if (frequency === 'weekly') {
      weekdays = this.getSelectedWeekdays();
      if (weekdays.length === 0) {
        this.toast('Please select at least one day of the week', 'error');
        return;
      }
    }

    const medicine = {
      id: Util.uid(),
      name,
      dosage: dosage || '',
      type: this.currentMedicineType,
      frequency,
      weekdays,  // empty array for daily/monthly/as-needed
      reminders: this.collectReminders('#manual-entry'),
      startDate: document.getElementById('med-start').value || Util.today(),
      endDate: document.getElementById('med-end').value || '',
      notes: document.getElementById('med-notes').value.trim(),
      photo: null,
      active: true,
      createdAt: Date.now()
    };

    DB.push('medicines', medicine);
    Reminders.schedule(medicine);
    this.toast('✅ Medicine saved!', 'success');
    this.resetAddForm();
    setTimeout(() => this.navigate('dashboard'), 800);
  },

  saveOCRMedicine() {
    const name = document.getElementById('ocr-med-name').value.trim();
    const dosage = document.getElementById('ocr-dosage').value.trim();
    if (!name) { this.toast('Please enter medicine name', 'error'); return; }

    const medicine = {
      id: Util.uid(),
      name,
      dosage,
      type: 'tablet',
      frequency: 'daily',
      reminders: this.collectReminders('#camera-entry'),
      startDate: Util.today(),
      endDate: '',
      notes: (document.getElementById('ocr-notes')?.value || '').trim(),
      photo: this.capturedImageData,
      extra: document.getElementById('ocr-extra').value.trim(),
      active: true,
      createdAt: Date.now()
    };

    DB.push('medicines', medicine);
    Reminders.schedule(medicine);
    this.toast('✅ Medicine saved with photo!', 'success');
    this.capturedImageData = null;
    setTimeout(() => this.navigate('dashboard'), 800);
  },

  resetAddForm() {
    document.getElementById('med-name').value = '';
    document.getElementById('med-dosage').value = '';
    document.getElementById('med-notes').value = '';
    document.getElementById('med-start').value = Util.today();
    document.getElementById('med-end').value = '';
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.type-btn[data-type="tablet"]').classList.add('active');
    this.currentMedicineType = 'tablet';
  },

  // ── CAMERA / OCR ──────────────────────────
  openCamera() {
    document.getElementById('camera-input').click();
  },

  openGallery() {
    document.getElementById('gallery-input').click();
  },

  retakePhoto() {
    document.getElementById('camera-placeholder').classList.remove('hidden');
    document.getElementById('camera-preview').classList.add('hidden');
    document.getElementById('ocr-result').classList.add('hidden');
    this.capturedImageData = null;
  },

  async handleImageCapture(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const imageData = e.target.result;
      this.capturedImageData = imageData;

      // Show preview
      document.getElementById('captured-image').src = imageData;
      document.getElementById('camera-placeholder').classList.add('hidden');
      document.getElementById('camera-preview').classList.remove('hidden');

      // Show OCR panel
      document.getElementById('ocr-result').classList.remove('hidden');
      document.getElementById('ocr-spinner').classList.remove('hidden');
      document.getElementById('ocr-done').classList.add('hidden');

      // Run OCR
      let parsedData = { name: '', dosage: '', extra: '' };
      try {
        // Load Tesseract dynamically
        if (typeof Tesseract === 'undefined') {
          await this.loadTesseract();
        }
        const rawText = await OCR.extractText(imageData);
        parsedData = OCR.parseMedicineText(rawText);
      } catch (err) {
        console.warn('OCR failed:', err);
      }

      // Populate fields
      document.getElementById('ocr-med-name').value = parsedData.name || '';
      document.getElementById('ocr-dosage').value = parsedData.dosage || '';
      document.getElementById('ocr-extra').value = parsedData.extra || '';

      // Hide spinner, show done
      document.getElementById('ocr-spinner').classList.add('hidden');
      document.getElementById('ocr-done').classList.remove('hidden');
    };
    reader.readAsDataURL(file);

    // Reset input
    event.target.value = '';
  },

  async loadTesseract() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  },

  // ── SCHEDULE ──────────────────────────────
  loadSchedule() {
    const dateStr = this.scheduleDate.toISOString().split('T')[0];
    const isToday = dateStr === Util.today();

    // Format date display
    const display = isToday ? 'Today' :
      this.scheduleDate.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    document.getElementById('schedule-date-display').textContent = display;

    const medicines = DB.get('medicines') || [];
    const history = DB.get('history') || [];

    const slots = { morning: [], afternoon: [], evening: [], night: [] };

    medicines.forEach(m => {
      if (!m.active) return;
      if (m.startDate && dateStr < m.startDate) return;
      if (m.endDate && dateStr > m.endDate) return;

      // Skip if not scheduled on this date (weekly/monthly)
      if (!Util.isScheduledOnDate(m, dateStr)) return;

      (m.reminders || []).forEach(r => {
        const histEntry = history.find(h =>
          h.medicineId === m.id && h.date === dateStr && h.scheduledTime === r.time
        );
        const status = histEntry ? histEntry.status : 'pending';
        // Always derive slot from actual time
        const slotKey = this.timeToSlot(r.time);
        slots[slotKey].push({ medicine: m, time: r.time, status, histEntry });
      });
    });

    let hasAny = false;
    ['morning', 'afternoon', 'evening', 'night'].forEach(slot => {
      const container = document.getElementById('schedule-' + slot);
      container.innerHTML = '';
      if (slots[slot].length === 0) {
        container.innerHTML = '<p style="color:var(--text-secondary);font-size:14px;padding:8px 0;font-weight:600;">Nothing scheduled</p>';
      } else {
        hasAny = true;
        slots[slot].forEach(item => {
          container.appendChild(this.buildMedCard(item, dateStr));
        });
      }
    });

    const emptyEl = document.getElementById('empty-schedule');
    emptyEl.classList.toggle('hidden', hasAny);
  },

  buildMedCard(item, dateStr) {
    const { medicine: m, time, status } = item;
    const card = document.createElement('div');
    card.className = `med-card ${status !== 'pending' ? status : ''}`;
    card.dataset.medId = m.id;

    const statusBadge =
      status === 'taken'      ? '<span class="med-status-badge badge-taken">✓ Taken</span>' :
      status === 'taken-late' ? '<span class="med-status-badge badge-taken">✓ Taken</span>' :
      status === 'missed'     ? '<span class="med-status-badge badge-missed">✕ Missed</span>' :
      status === 'skipped'    ? '<span class="med-status-badge badge-skipped">⏩ Skipped</span>' :
                                '<span class="med-status-badge badge-pending">Pending</span>';

    const photoHtml = m.photo
      ? `<div class="med-photo"><img src="${m.photo}" alt="${m.name}" /></div>`
      : `<div class="med-photo">${Util.typeEmoji(m.type)}</div>`;

    const isToday = dateStr === Util.today();
    const scheduledMin = Util.timeToMinutes(time);
    const nowMin = isToday ? Util.timeToMinutes(Util.now()) : 0;
    const isPastTime = isToday && nowMin > scheduledMin;

    const canMarkTaken = status === 'pending' || status === 'missed';
    const isLateAction = status === 'missed' || (status === 'pending' && isPastTime);

    // Always show "Mark as Taken" — never say Late in the UI
    const takenBtn = canMarkTaken
      ? `<button class="mark-taken-btn">Mark as Taken</button>`
      : '';

    card.innerHTML = `
      ${photoHtml}
      <div class="med-info">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div class="med-name">${m.name}</div>
          <button class="card-delete-btn" data-medid="${m.id}" data-medname="${m.name}" aria-label="Delete" title="Delete medicine">Delete</button>
        </div>
        <div class="med-dosage">${m.dosage}</div>
        <div class="med-time">${Util.fmtTime(time)}</div>
        ${m.notes ? `<div class="med-notes">${m.notes}</div>` : ''}
        ${statusBadge}
        ${takenBtn}
        <button class="view-detail-btn">View Details</button>
      </div>
    `;

    const takenBtnEl = card.querySelector('.mark-taken-btn');
    if (takenBtnEl) {
      takenBtnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.markTaken(m.id, time, dateStr, isLateAction);
      });
    }

    card.querySelector('.card-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.confirmDelete(m.id, m.name);
    });

    card.querySelector('.view-detail-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openMedicineDetail(m.id);
    });

    return card;
  },

  openMedicineDetail(medicineId) {
    const medicines = DB.get('medicines') || [];
    const med = medicines.find(m => m.id === medicineId);
    if (!med) { this.toast('Medicine not found', 'error'); return; }
    this.navigate('medicine-detail', med);
  },

  timeToSlot(time) {
    const min = Util.timeToMinutes(time);
    if (min < 720) return 'morning';
    if (min < 960) return 'afternoon';
    if (min < 1140) return 'evening';
    return 'night';
  },

  changeScheduleDate(delta) {
    this.scheduleDate.setDate(this.scheduleDate.getDate() + delta);
    this.loadSchedule();
  },

  markTaken(medicineId, time, date, isLate = false) {
    const medicines = DB.get('medicines') || [];
    const med = medicines.find(m => m.id === medicineId);
    if (!med) return;

    const actualTime = Util.now();
    const status = isLate ? 'taken-late' : 'taken';

    // If there's an existing missed entry for this slot, UPDATE it instead of adding a duplicate
    const history = DB.get('history') || [];
    const existingIdx = history.findIndex(h =>
      h.medicineId === medicineId && h.date === date &&
      h.scheduledTime === time && h.status === 'missed'
    );

    if (existingIdx !== -1) {
      // Update the missed record to taken-late
      history[existingIdx].status = 'taken-late';
      history[existingIdx].actualTime = actualTime;
      history[existingIdx].timestamp = Date.now();
      DB.set('history', history);
    } else {
      // No existing entry — push a fresh one
      DB.push('history', {
        id: Util.uid(),
        medicineId,
        medicineName: med.name,
        dosage: med.dosage,
        date,
        scheduledTime: time,
        actualTime,
        status,
        timestamp: Date.now()
      });
    }

    this.toast(`✅ ${med.name} marked as taken!`, 'success');

    const settings = DB.get('settings') || {};
    if (settings.voice) Speech.say(`${med.name} has been marked as taken.`);

    this.loadSchedule();
    this.refreshDashboard();
  },

  // ── MEDICINE DETAIL ───────────────────────
  showMedicineDetail(med) {
    const history = DB.get('history') || [];
    const total = history.filter(h => h.medicineId === med.id).length;
    const taken = history.filter(h => h.medicineId === med.id && h.status === 'taken').length;
    const adherence = total ? Math.round((taken / total) * 100) : 0;

    const photoHtml = med.photo
      ? `<div class="detail-photo"><img src="${med.photo}" alt="${med.name}" /></div>`
      : `<div class="detail-photo">${Util.typeEmoji(med.type)}</div>`;

    const reminderList = (med.reminders || [])
      .map(r => `<span style="background:var(--primary-light);color:white;padding:4px 12px;border-radius:20px;font-size:14px;font-weight:700;">${Util.fmtTime(r.time)}</span>`)
      .join(' ');

    document.getElementById('medicine-detail-content').innerHTML = `
      ${photoHtml}
      <div class="detail-name">${med.name}</div>
      <div class="detail-dosage">${med.dosage}</div>

      <div class="detail-info-grid">
        <div class="detail-info-item">
          <div class="detail-info-label">Type</div>
          <div class="detail-info-value">${Util.typeEmoji(med.type)} ${med.type}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">Frequency</div>
          <div class="detail-info-value">${med.frequency || 'Daily'}</div>
        </div>
        ${med.frequency === 'weekly' && med.weekdays && med.weekdays.length > 0 ? `
        <div class="detail-info-item" style="grid-column:span 2">
          <div class="detail-info-label">Scheduled Days</div>
          <div class="detail-info-value">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].filter((_,i) => med.weekdays.includes(i)).join(', ')}</div>
        </div>` : ''}
        <div class="detail-info-item">
          <div class="detail-info-label">Start Date</div>
          <div class="detail-info-value">${med.startDate ? Util.fmtDate(med.startDate) : '—'}</div>
        </div>
        <div class="detail-info-item">
          <div class="detail-info-label">End Date</div>
          <div class="detail-info-value">${med.endDate ? Util.fmtDate(med.endDate) : 'Ongoing'}</div>
        </div>
      </div>

      <div style="margin-bottom:16px">
        <div class="form-label">Reminder Times</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;">${reminderList || 'None set'}</div>
      </div>

      ${med.notes ? `<div style="background:var(--surface);border:2px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px;">
        <div class="detail-info-label">Notes</div>
        <div style="margin-top:6px;font-weight:600;">${med.notes}</div>
      </div>` : ''}

      <div class="detail-adherence">
        <div class="detail-adherence-pct">${adherence}%</div>
        <div class="detail-adherence-label">Adherence Rate (${taken}/${total} doses taken)</div>
      </div>

      <div style="margin-bottom:12px">
        <button class="save-btn" onclick="Speech.readMedicine(${JSON.stringify(med).replace(/"/g, '&quot;')})">🔊 Read Details Aloud</button>
      </div>

      <div class="detail-actions">
        <button class="detail-btn detail-btn--edit" onclick="App.editMedicine('${med.id}')">✏️ Edit</button>
        <button class="detail-btn detail-btn--delete" onclick="App.confirmDelete('${med.id}','${med.name}')">Delete</button>
      </div>
    `;
  },

  editMedicine(id) {
    const medicines = DB.get('medicines') || [];
    const med = medicines.find(m => m.id === id);
    if (!med) { this.toast('Medicine not found', 'error'); return; }

    // Build reminder rows HTML
    const reminderRowsHtml = (med.reminders || [{ slot: 'morning', time: '08:00' }]).map((r, i) => `
      <div class="reminder-time-row" id="edit-reminder-row-${i}">
        <select class="form-input time-slot-select">
          <option value="morning"  ${r.slot === 'morning'   ? 'selected' : ''}>🌅 Morning</option>
          <option value="afternoon"${r.slot === 'afternoon' ? 'selected' : ''}>☀️ Afternoon</option>
          <option value="evening"  ${r.slot === 'evening'   ? 'selected' : ''}>🌆 Evening</option>
          <option value="night"    ${r.slot === 'night'     ? 'selected' : ''}>🌙 Night</option>
        </select>
        <input type="time" class="form-input time-custom" value="${r.time}" />
        ${i > 0 ? `<button onclick="this.parentElement.remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--red);padding:0 4px">✕</button>` : ''}
      </div>
    `).join('');

    this.showModal(`
      <div class="modal-title">✏️ Edit Medicine</div>

      <div class="form-group">
        <label class="form-label">Medicine Name *</label>
        <input type="text" id="edit-name" class="form-input" value="${med.name}" />
      </div>
      <div class="form-group">
        <label class="form-label">Dosage</label>
        <input type="text" id="edit-dosage" class="form-input" value="${med.dosage || ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">Type</label>
        <select id="edit-type" class="form-input form-select">
          <option value="tablet"   ${med.type === 'tablet'    ? 'selected' : ''}>💊 Tablet</option>
          <option value="capsule"  ${med.type === 'capsule'   ? 'selected' : ''}>💉 Capsule</option>
          <option value="syrup"    ${med.type === 'syrup'     ? 'selected' : ''}>🧴 Syrup</option>
          <option value="injection"${med.type === 'injection' ? 'selected' : ''}>💉 Injection</option>
          <option value="drops"    ${med.type === 'drops'     ? 'selected' : ''}>💧 Drops</option>
          <option value="other"    ${med.type === 'other'     ? 'selected' : ''}>📦 Other</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Frequency</label>
        <select id="edit-freq" class="form-input form-select" onchange="App._toggleEditWeekdays(this.value)">
          <option value="daily"    ${med.frequency === 'daily'     ? 'selected' : ''}>Daily</option>
          <option value="weekly"   ${med.frequency === 'weekly'    ? 'selected' : ''}>Weekly</option>
          <option value="monthly"  ${med.frequency === 'monthly'   ? 'selected' : ''}>Monthly</option>
          <option value="as-needed"${med.frequency === 'as-needed' ? 'selected' : ''}>As Needed</option>
        </select>
      </div>
      <div class="form-group ${med.frequency !== 'weekly' ? 'hidden' : ''}" id="edit-weekday-group">
        <label class="form-label">Which day(s) of the week?</label>
        <div class="weekday-chips">
          ${[0,1,2,3,4,5,6].map(d => {
            const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            const isActive = (med.weekdays || []).includes(d) ? 'active' : '';
            return `<button type="button" class="weekday-chip ${isActive}" data-day="${d}" onclick="this.classList.toggle('active')">${labels[d]}</button>`;
          }).join('')}
        </div>
        <p class="weekday-hint">Tap to select one or more days</p>
      </div>
      <div class="form-group">
        <label class="form-label">Reminder Times</label>
        <div id="edit-reminder-list">${reminderRowsHtml}</div>
        <button class="add-time-btn" onclick="App._addEditReminderRow()">+ Add Another Time</button>
      </div>
      <div class="form-group">
        <label class="form-label">Start Date</label>
        <input type="date" id="edit-start" class="form-input" value="${med.startDate || ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">End Date</label>
        <input type="date" id="edit-end" class="form-input" value="${med.endDate || ''}" />
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea id="edit-notes" class="form-input form-textarea">${med.notes || ''}</textarea>
      </div>

      <button class="modal-btn modal-btn--primary" onclick="App._saveEditedMedicine('${id}')">Save Changes</button>
      <button class="modal-btn modal-btn--secondary" style="margin-top:10px" onclick="App.closeModal()">Cancel</button>
    `);
  },

  _addEditReminderRow() {
    const list = document.getElementById('edit-reminder-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'reminder-time-row';
    row.innerHTML = `
      <select class="form-input time-slot-select">
        <option value="morning">🌅 Morning</option>
        <option value="afternoon">☀️ Afternoon</option>
        <option value="evening">🌆 Evening</option>
        <option value="night">🌙 Night</option>
      </select>
      <input type="time" class="form-input time-custom" value="08:00" />
      <button onclick="this.parentElement.remove()" style="border:none;background:none;font-size:22px;cursor:pointer;color:var(--red);padding:0 4px">✕</button>
    `;
    list.appendChild(row);
  },

  _toggleEditWeekdays(val) {
    const g = document.getElementById('edit-weekday-group');
    if (g) g.classList.toggle('hidden', val !== 'weekly');
  },

  _saveEditedMedicine(id) {
    const name = (document.getElementById('edit-name')?.value || '').trim();
    if (!name) { this.toast('Medicine name is required', 'error'); return; }

    const frequency = document.getElementById('edit-freq')?.value || 'daily';

    // Collect weekdays if weekly
    let weekdays = [];
    if (frequency === 'weekly') {
      const chips = document.querySelectorAll('#edit-weekday-group .weekday-chip.active');
      weekdays = Array.from(chips).map(c => parseInt(c.dataset.day));
      if (weekdays.length === 0) {
        this.toast('Please select at least one day of the week', 'error');
        return;
      }
    }

    // Collect reminder rows
    const reminders = [];
    document.querySelectorAll('#edit-reminder-list .reminder-time-row').forEach(row => {
      const slot = row.querySelector('.time-slot-select')?.value || 'morning';
      const time = row.querySelector('.time-custom')?.value || '08:00';
      reminders.push({ slot, time });
    });

    DB.update('medicines', id, (med) => ({
      ...med,
      name,
      dosage:    (document.getElementById('edit-dosage')?.value || '').trim(),
      type:      document.getElementById('edit-type')?.value || med.type,
      frequency,
      weekdays,
      reminders: reminders.length ? reminders : med.reminders,
      startDate: document.getElementById('edit-start')?.value || med.startDate,
      endDate:   document.getElementById('edit-end')?.value || '',
      notes:     (document.getElementById('edit-notes')?.value || '').trim(),
    }));

    const updated = (DB.get('medicines') || []).find(m => m.id === id);
    if (updated) Reminders.schedule(updated);

    this.closeModal();
    this.toast('✅ Medicine updated!', 'success');
    if (updated) this.showMedicineDetail(updated);
  },

  confirmDelete(id, name) {
    this.showModal(`
      <div class="modal-title">Delete Medicine?</div>
      <p style="font-size:var(--font-size-base);color:var(--text-secondary);margin-bottom:20px;font-weight:600;">Are you sure you want to delete <strong>${name}</strong>? This cannot be undone.</p>
      <button class="modal-btn modal-btn--red" onclick="App.deleteMedicine('${id}')">Yes, Delete</button>
      <button class="modal-btn modal-btn--secondary" onclick="App.closeModal()">Cancel</button>
    `);
  },

  deleteMedicine(id) {
    Reminders.clear(id);
    DB.remove('medicines', id);
    this.closeModal();
    this.toast('Medicine deleted', 'error');
    // Refresh whichever screen we came from
    if (this.previousScreen === 'schedule') {
      this.navigate('schedule');
    } else if (this.previousScreen === 'my-medicines') {
      this.navigate('my-medicines');
    } else {
      this.navigate('dashboard');
    }
  },

  // ── MY MEDICINES LIST ─────────────────────
  loadMyMedicines() {
    const medicines = DB.get('medicines') || [];
    const container = document.getElementById('my-medicines-list');
    const empty = document.getElementById('my-medicines-empty');
    if (!container) return;

    container.innerHTML = '';

    if (medicines.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    medicines.forEach(med => {
      const card = document.createElement('div');
      card.className = 'med-list-card';
      const reminderTimes = (med.reminders || []).map(r => Util.fmtTime(r.time)).join(', ');
      const photoHtml = med.photo
        ? `<img src="${med.photo}" alt="${med.name}" style="width:52px;height:52px;border-radius:10px;object-fit:cover;border:2px solid var(--border);flex-shrink:0;" />`
        : `<div style="width:52px;height:52px;border-radius:10px;background:linear-gradient(135deg,var(--primary),var(--primary-light));display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;">${Util.typeEmoji(med.type)}</div>`;

      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:14px;padding:16px;background:var(--surface);border-radius:var(--radius);border:2px solid var(--border);margin-bottom:12px;box-shadow:var(--shadow-sm);">
          ${photoHtml}
          <div style="flex:1;min-width:0;">
            <div style="font-size:var(--font-size-base);font-weight:800;color:var(--text);">${med.name}</div>
            <div style="font-size:var(--font-size-sm);color:var(--primary);font-weight:700;">${med.dosage}</div>
            <div style="font-size:13px;color:var(--text-secondary);font-weight:600;">${reminderTimes || 'No reminders'}</div>
            ${med.notes ? `<div style="font-size:12px;color:var(--text-secondary);font-style:italic;">${med.notes}</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;">
            <button class="detail-btn detail-btn--edit" style="padding:10px 14px;font-size:13px;" data-medid="${med.id}">Details</button>
            <button class="detail-btn detail-btn--delete" style="padding:10px 14px;font-size:13px;" data-medid="${med.id}" data-medname="${med.name}">Delete</button>
          </div>
        </div>
      `;

      card.querySelector('[class*="detail-btn--edit"]').addEventListener('click', () => {
        this.openMedicineDetail(med.id);
      });
      card.querySelector('[class*="detail-btn--delete"]').addEventListener('click', () => {
        this.confirmDelete(med.id, med.name);
      });

      container.appendChild(card);
    });
  },

  // ── HISTORY ───────────────────────────────
  loadHistory(view) {
    const history = (DB.get('history') || []).sort((a, b) => b.timestamp - a.timestamp);
    const today = Util.today();
    let filtered = [];

    if (view === 'daily') {
      filtered = history.filter(h => h.date === today);
    } else if (view === 'weekly') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      filtered = history.filter(h => new Date(h.date) >= weekAgo);
    } else {
      const monthAgo = new Date();
      monthAgo.setDate(monthAgo.getDate() - 30);
      filtered = history.filter(h => new Date(h.date) >= monthAgo);
    }

    // Adherence — count both taken and taken-late as positive
    const taken = filtered.filter(h => h.status === 'taken' || h.status === 'taken-late').length;
    const pct = filtered.length ? Math.round((taken / filtered.length) * 100) : 0;
    document.getElementById('adherence-pct').textContent = `${pct}%`;
    document.getElementById('adherence-bar-fill').style.width = `${pct}%`;

    const list = document.getElementById('history-list');
    list.innerHTML = '';

    if (filtered.length === 0) {
      document.getElementById('empty-history').classList.remove('hidden');
      return;
    }
    document.getElementById('empty-history').classList.add('hidden');

    // Group by date
    const byDate = {};
    filtered.forEach(h => {
      if (!byDate[h.date]) byDate[h.date] = [];
      byDate[h.date].push(h);
    });

    Object.keys(byDate).sort((a, b) => b.localeCompare(a)).forEach(date => {
      const dateHeader = document.createElement('div');
      dateHeader.style.cssText = 'font-size:14px;font-weight:900;color:var(--text-secondary);text-transform:uppercase;padding:12px 0 6px;letter-spacing:1px;';
      dateHeader.textContent = date === today ? 'Today' : Util.fmtDate(date);
      list.appendChild(dateHeader);

      byDate[date].forEach(h => {
        const isTaken = h.status === 'taken' || h.status === 'taken-late';
        const iconColor = isTaken ? '#3A7D44' : h.status === 'missed' ? '#C0392B' : '#9B8FD4';
        const iconChar = isTaken ? '✓' : h.status === 'missed' ? '✕' : '›';
        const badgeClass = isTaken ? 'badge-taken' : h.status === 'missed' ? 'badge-missed' : 'badge-pending';
        const badgeLabel = isTaken ? 'Taken' : h.status === 'missed' ? 'Missed' : 'Skipped';

        const item = document.createElement('div');
        item.className = 'history-item';
        item.innerHTML = `
          <div class="hist-icon-svg" style="color:${iconColor}">${iconChar}</div>
          <div class="hist-info">
            <div class="hist-med-name">${h.medicineName} ${h.dosage || ''}</div>
            <div class="hist-time">Scheduled: ${Util.fmtTime(h.scheduledTime)}${h.actualTime ? ' · Taken: ' + Util.fmtTime(h.actualTime) : ''}</div>
          </div>
          <span class="med-status-badge ${badgeClass}">${badgeLabel}</span>
        `;
        list.appendChild(item);
      });
    });
  },

  switchHistoryView(view, btn) {
    document.querySelectorAll('.hist-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    this.loadHistory(view);
  },

  // ── EMERGENCY CONTACTS ────────────────────
  loadContacts() {
    const contacts = DB.get('contacts') || [];
    const list = document.getElementById('contacts-list');
    const empty = document.getElementById('empty-contacts');
    list.innerHTML = '';

    if (contacts.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    contacts.forEach(c => {
      const card = document.createElement('div');
      card.className = 'contact-card';
      const initial = c.name ? c.name[0].toUpperCase() : '?';
      const relEmoji = this.relationEmoji(c.relation);
      card.innerHTML = `
        <div class="contact-avatar">${relEmoji || initial}</div>
        <div class="contact-info">
          <div class="contact-name">${c.name}</div>
          <div class="contact-relation">${c.relation || ''}</div>
          <div class="contact-phone">📞 ${c.phone}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;">
          <button class="contact-call-btn" onclick="App.callContact('${c.phone}')" aria-label="Call ${c.name}">📞</button>
          <button onclick="App.deleteContact('${c.id}')" style="border:none;background:none;font-size:20px;cursor:pointer;color:var(--red);" aria-label="Delete">Delete</button>
        </div>
      `;
      list.appendChild(card);
    });
  },

  relationEmoji(rel) {
    if (!rel) return '';
    const r = rel.toLowerCase();
    if (r.includes('son')) return '👦';
    if (r.includes('daughter')) return '👧';
    if (r.includes('wife') || r.includes('husband') || r.includes('spouse')) return '💑';
    if (r.includes('doctor') || r.includes('physician')) return '👨‍⚕️';
    if (r.includes('nurse')) return '👩‍⚕️';
    if (r.includes('care') || r.includes('helper')) return '🤝';
    if (r.includes('friend')) return '👫';
    return '';
  },

  showAddContact() {
    this.showModal(`
      <div class="modal-title">Add Emergency Contact</div>
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input type="text" id="contact-name" class="form-input" placeholder="e.g. Rahul (Son)" />
      </div>
      <div class="form-group">
        <label class="form-label">Relationship</label>
        <select id="contact-relation" class="form-input form-select">
          <option value="Son">Son</option>
          <option value="Daughter">Daughter</option>
          <option value="Spouse">Spouse / Partner</option>
          <option value="Doctor">Doctor</option>
          <option value="Caregiver">Caregiver</option>
          <option value="Friend">Friend</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Phone Number *</label>
        <input type="tel" id="contact-phone" class="form-input" placeholder="e.g. +91 98765 43210" />
      </div>
      <button class="modal-btn modal-btn--primary" onclick="App.saveContact()">Save Contact</button>
      <button class="modal-btn modal-btn--secondary" onclick="App.closeModal()">Cancel</button>
    `);
  },

  saveContact() {
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    if (!name || !phone) { this.toast('Name and phone required', 'error'); return; }

    DB.push('contacts', {
      id: Util.uid(),
      name,
      relation: document.getElementById('contact-relation').value,
      phone,
      createdAt: Date.now()
    });
    this.closeModal();
    this.toast('✅ Contact saved!', 'success');
    this.loadContacts();
  },

  deleteContact(id) {
    DB.remove('contacts', id);
    this.toast('Contact deleted', 'error');
    this.loadContacts();
  },

  callContact(phone) {
    window.location.href = `tel:${phone}`;
  },

  // Step 1 — ask for confirmation (accidental-press guard)
  triggerSOS() {
    this.showModal(`
      <div style="text-align:center;padding:10px 0 6px;">
        <div style="font-size:52px;margin-bottom:12px;">🆘</div>
        <div class="modal-title" style="color:var(--red);">Emergency SOS?</div>
        <p style="font-size:var(--font-size-base);color:var(--text-secondary);margin-bottom:24px;font-weight:600;line-height:1.5;">
          This will show your emergency contacts so you can call for help.
        </p>
        <button class="modal-btn modal-btn--red" onclick="App.closeModal();App.confirmSOS()">
          🆘 Yes, Show Contacts
        </button>
        <button class="modal-btn modal-btn--secondary" onclick="App.closeModal()" style="margin-top:10px;">
          ✕ Cancel — I'm Fine
        </button>
      </div>
    `);
  },

  // Step 2 — show contacts after confirmation
  confirmSOS() {
    const contacts = DB.get('contacts') || [];
    if (contacts.length === 0) {
      this.showModal(`
        <div class="modal-title">🆘 Emergency SOS</div>
        <p style="font-size:var(--font-size-base);color:var(--text-secondary);margin-bottom:20px;font-weight:600;">No emergency contacts saved yet. Please add contacts first.</p>
        <button class="modal-btn modal-btn--primary" onclick="App.closeModal();App.navigate('emergency');App.showAddContact()">+ Add Emergency Contact</button>
        <button class="modal-btn modal-btn--secondary" onclick="App.closeModal()">Close</button>
      `);
      return;
    }

    // Vibrate to signal SOS is active
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);

    const contactsHtml = contacts.map(c => `
      <div class="contact-card" style="margin-bottom:12px;">
        <div class="contact-avatar">${this.relationEmoji(c.relation) || c.name[0]}</div>
        <div class="contact-info">
          <div class="contact-name">${c.name}</div>
          <div class="contact-relation">${c.relation}</div>
          <div class="contact-phone">${c.phone}</div>
        </div>
        <button class="contact-call-btn" onclick="App.callContact('${c.phone}')">📞</button>
      </div>
    `).join('');

    this.showModal(`
      <div class="modal-title" style="color:var(--red);">🆘 Call for Help</div>
      <p style="font-size:var(--font-size-base);color:var(--text-secondary);margin-bottom:16px;font-weight:600;">Tap 📞 to call immediately:</p>
      ${contactsHtml}
      <button class="modal-btn modal-btn--secondary" onclick="App.closeModal()">Close</button>
    `);
  },


  // ── PROFILE ───────────────────────────────
  _pendingPhotoData: null,  // holds compressed base64 before user confirms

  loadProfile() {
    const profile = DB.get('profile') || {};
    // Fill form fields
    if (profile.name)   document.getElementById('profile-name').value   = profile.name;
    if (profile.age)    document.getElementById('profile-age').value    = profile.age;
    if (profile.blood)  document.getElementById('profile-blood').value  = profile.blood;
    if (profile.doctor) document.getElementById('profile-doctor').value = profile.doctor;
    if (profile.notes)  document.getElementById('profile-notes').value  = profile.notes;

    // Display name under photo
    document.getElementById('profile-display-name').textContent =
      profile.name || 'Your Name';

    // Show photo if exists
    this._applyAvatarToElement(
      document.getElementById('profile-photo-img'),
      document.getElementById('profile-photo-placeholder'),
      profile.photo
    );
  },

  saveProfile() {
    const profile = DB.get('profile') || {};
    profile.name   = document.getElementById('profile-name').value.trim();
    profile.age    = document.getElementById('profile-age').value;
    profile.blood  = document.getElementById('profile-blood').value;
    profile.doctor = document.getElementById('profile-doctor').value.trim();
    profile.notes  = document.getElementById('profile-notes').value.trim();
    // photo is saved separately via saveProfilePhoto()
    DB.set('profile', profile);
    this.toast('✅ Profile saved!', 'success');

    // Refresh dashboard name & avatar
    this.refreshDashboard();

    // Update display name on profile screen
    document.getElementById('profile-display-name').textContent =
      profile.name || 'Your Name';
  },

  // Show action sheet: camera / gallery / remove / cancel
  showPhotoOptions() {
    const profile = DB.get('profile') || {};
    const hasPhoto = !!profile.photo;
    this.showModal(`
      <div class="modal-title">Profile Photo</div>
      <button class="modal-btn modal-btn--primary" onclick="App.closeModal();App.openProfileCamera()">📸 Take Photo</button>
      <button class="modal-btn modal-btn--primary" style="margin-top:10px;background:var(--blue);" onclick="App.closeModal();App.openProfileGallery()">🖼️ Choose from Gallery</button>
      ${hasPhoto ? `<button class="modal-btn modal-btn--secondary" style="margin-top:10px;color:var(--red);border-color:var(--red);" onclick="App.closeModal();App.removeProfilePhoto()">Remove Current Photo</button>` : ''}
      <button class="modal-btn modal-btn--secondary" style="margin-top:10px;" onclick="App.closeModal()">✕ Cancel</button>
    `);
  },

  openProfileCamera() {
    document.getElementById('profile-cam-input').click();
  },

  openProfileGallery() {
    document.getElementById('profile-gal-input').click();
  },

  handleProfilePhoto(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = ''; // reset so same file can be picked again

    const reader = new FileReader();
    reader.onload = (e) => {
      // Compress & crop into circle via canvas, then show preview
      this._processProfileImage(e.target.result);
    };
    reader.readAsDataURL(file);
  },

  _processProfileImage(rawDataUrl) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.getElementById('profile-canvas');
      const ctx = canvas.getContext('2d');
      const SIZE = 300;
      canvas.width = SIZE;
      canvas.height = SIZE;

      // Draw circular clip
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();

      // Cover-fit the image into the circle
      const scale = Math.max(SIZE / img.width, SIZE / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (SIZE - w) / 2;
      const y = (SIZE - h) / 2;
      ctx.drawImage(img, x, y, w, h);

      // Compress to JPEG at 85% quality (keeps file small for localStorage)
      this._pendingPhotoData = canvas.toDataURL('image/jpeg', 0.85);

      // Show preview overlay with animation
      const overlay = document.getElementById('profile-preview-overlay');
      overlay.classList.remove('hidden');
      overlay.style.animation = 'fadeInUp 0.3s ease';
    };
    img.src = rawDataUrl;
  },

  saveProfilePhoto() {
    if (!this._pendingPhotoData) return;
    const profile = DB.get('profile') || {};
    profile.photo = this._pendingPhotoData;
    DB.set('profile', profile);
    this._pendingPhotoData = null;

    // Hide preview
    document.getElementById('profile-preview-overlay').classList.add('hidden');

    // Apply to profile screen
    this._applyAvatarToElement(
      document.getElementById('profile-photo-img'),
      document.getElementById('profile-photo-placeholder'),
      profile.photo
    );

    // Apply to dashboard immediately
    this._applyAvatarToElement(
      document.getElementById('dash-avatar-img'),
      document.getElementById('dash-avatar-placeholder'),
      profile.photo
    );

    this.toast('✅ Profile photo saved!', 'success');
  },

  cancelProfilePhoto() {
    this._pendingPhotoData = null;
    document.getElementById('profile-preview-overlay').classList.add('hidden');
  },

  removeProfilePhoto() {
    const profile = DB.get('profile') || {};
    delete profile.photo;
    DB.set('profile', profile);

    // Reset profile screen avatar
    this._applyAvatarToElement(
      document.getElementById('profile-photo-img'),
      document.getElementById('profile-photo-placeholder'),
      null
    );
    // Reset dashboard avatar
    this._applyAvatarToElement(
      document.getElementById('dash-avatar-img'),
      document.getElementById('dash-avatar-placeholder'),
      null
    );
    this.toast('Photo removed', '');
  },

  // Helper: show photo in an <img> or fall back to placeholder emoji
  _applyAvatarToElement(imgEl, placeholderEl, photoData) {
    if (!imgEl || !placeholderEl) return;
    if (photoData) {
      imgEl.src = photoData;
      imgEl.style.display = 'block';
      placeholderEl.style.display = 'none';
    } else {
      imgEl.style.display = 'none';
      placeholderEl.style.display = 'block';
    }
  },

  // ── SETTINGS ──────────────────────────────
  applySettings() {
    const s = DB.get('settings') || {};

    if (s.darkMode) document.body.classList.add('dark-mode');
    if (s.highContrast) document.body.classList.add('high-contrast');
    if (s.fontSize) document.body.classList.add('font-' + s.fontSize);

    document.getElementById('toggle-dark').checked = !!s.darkMode;
    document.getElementById('toggle-contrast').checked = !!s.highContrast;
    document.getElementById('toggle-sound').checked = s.sound !== false;
    document.getElementById('toggle-vibration').checked = s.vibration !== false;
    document.getElementById('toggle-voice').checked = !!s.voice;
    document.getElementById('toggle-repeat').checked = s.repeat !== false;
    document.getElementById('toggle-summary').checked = s.summary !== false;
    document.getElementById('alarm-volume').value = s.volume ?? 0.8;

    if (s.name) document.getElementById('setting-name').value = s.name;
    if (s.age) document.getElementById('setting-age').value = s.age;
    if (s.fontSize) document.getElementById('font-size-select').value = s.fontSize;
  },

  saveSettings() {
    const s = {
      name: document.getElementById('setting-name').value.trim(),
      age: document.getElementById('setting-age').value,
      darkMode: document.getElementById('toggle-dark').checked,
      highContrast: document.getElementById('toggle-contrast').checked,
      fontSize: document.getElementById('font-size-select').value,
      sound: document.getElementById('toggle-sound').checked,
      vibration: document.getElementById('toggle-vibration').checked,
      voice: document.getElementById('toggle-voice').checked,
      repeat: document.getElementById('toggle-repeat').checked,
      summary: document.getElementById('toggle-summary').checked,
      volume: parseFloat(document.getElementById('alarm-volume').value)
    };
    DB.set('settings', s);
    this.applySettings();
    this.toast('✅ Settings saved!', 'success');
  },

  toggleDarkMode(cb) {
    document.body.classList.toggle('dark-mode', cb.checked);
    this.saveSettings();
  },

  toggleContrast(cb) {
    document.body.classList.toggle('high-contrast', cb.checked);
    this.saveSettings();
  },

  changeFontSize(val) {
    document.body.classList.remove('font-large', 'font-xlarge');
    if (val !== 'normal') document.body.classList.add('font-' + val);
    this.saveSettings();
  },

  requestNotificationPermission() {
    Notify.requestPermission().then(granted => {
      this.toast(granted ? '✅ Notifications enabled!' : '❌ Notifications denied', granted ? 'success' : 'error');
    });
  },

  exportData() {
    const data = {
      medicines: DB.get('medicines') || [],
      history: DB.get('history') || [],
      contacts: DB.get('contacts') || [],
      settings: DB.get('settings') || {},
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `medcare-backup-${Util.today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.toast('✅ Data exported!', 'success');
  },

  clearAllData() {
    this.showModal(`
      <div class="modal-title">⚠️ Clear All Data?</div>
      <p style="font-size:var(--font-size-base);color:var(--text-secondary);margin-bottom:20px;font-weight:600;">This will permanently delete all medicines, history, and contacts. This cannot be undone.</p>
      <button class="modal-btn modal-btn--red" onclick="App._doClear()">Yes, Clear Everything</button>
      <button class="modal-btn modal-btn--secondary" onclick="App.closeModal()">Cancel</button>
    `);
  },

  _doClear() {
    ['medicines', 'history', 'contacts'].forEach(k => localStorage.removeItem('mc_' + k));
    this.closeModal();
    this.toast('All data cleared', 'error');
    this.navigate('dashboard');
  },

  // ── ALARM DIALOG (full-screen) ─────────────
  showAlarmDialog(medicine, time) {
    // Populate dialog
    document.getElementById('alarm-med-name').textContent = medicine.name;
    document.getElementById('alarm-dosage').textContent = medicine.dosage || '';
    document.getElementById('alarm-time-val').textContent = Util.fmtTime(time);

    // Show overlay
    const overlay = document.getElementById('alarm-overlay');
    overlay.classList.remove('hidden');

    // Start alarm sound
    const settings = DB.get('settings') || {};
    if (settings.sound !== false) AlarmAudio.play();

    // Wire buttons (replace to remove old listeners)
    const takenBtn = document.getElementById('alarm-btn-taken');
    const snoozeBtn = document.getElementById('alarm-btn-snooze');
    const skipBtn = document.getElementById('alarm-btn-skip');

    const closeAlarm = () => {
      overlay.classList.add('hidden');
      AlarmAudio.stop();
    };

    takenBtn.onclick = () => {
      closeAlarm();
      AlarmAudio.beepSuccess();
      const scheduledMin = Util.timeToMinutes(time);
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const isLate = (nowMin - scheduledMin) >= 30;
      this.markTaken(medicine.id, time, Util.today(), isLate);
      Reminders.dismiss(medicine.id, time);
    };

    snoozeBtn.onclick = () => {
      closeAlarm();
      Reminders.snooze(medicine.id, time, 5);
      this.toast('⏰ Snoozed 5 minutes', 'success');
    };

    skipBtn.onclick = () => {
      closeAlarm();
      Reminders.dismiss(medicine.id, time);
      // Log as skipped
      DB.push('history', {
        id: Util.uid(),
        medicineId: medicine.id,
        medicineName: medicine.name,
        dosage: medicine.dosage,
        date: Util.today(),
        scheduledTime: time,
        actualTime: null,
        status: 'skipped',
        timestamp: Date.now()
      });
      this.toast('Dose skipped', '');
      this.refreshDashboard();
    };
  },

  // Legacy popup (kept for missed alerts)
  showReminderNotification(medicine, time) {
    this.showAlarmDialog(medicine, time);
  },

  showMissedAlert(medicine, time) {
    const popup = document.createElement('div');
    popup.className = 'notification-popup';
    popup.style.borderLeftColor = 'var(--red)';
    popup.innerHTML = `
      <div class="notif-header">
        <div class="notif-icon">⚠️</div>
        <div class="notif-title" style="color:var(--red);">Missed Medicine!</div>
      </div>
      <div class="notif-body">You missed <strong>${medicine.name} ${medicine.dosage}</strong> scheduled at ${Util.fmtTime(time)}</div>
      <div class="notif-actions">
        <button class="notif-btn notif-btn--take" onclick="App.markTaken('${medicine.id}','${time}','${Util.today()}',this);this.closest('.notification-popup').remove();">✅ Take Now</button>
        <button class="notif-btn notif-btn--snooze" onclick="this.closest('.notification-popup').remove();">Dismiss</button>
      </div>
    `;
    document.getElementById('app').appendChild(popup);
    setTimeout(() => { if (popup.parentNode) popup.remove(); }, 60000);
  },

  // ── PWA INSTALL ───────────────────────────
  showInstallBanner() {
    if (document.querySelector('.install-banner')) return;
    const banner = document.createElement('div');
    banner.className = 'install-banner';
    banner.innerHTML = `
      <span style="font-size:24px;">📱</span>
      <div class="install-banner-text">Install MedCare on your phone for easy access!</div>
      <button class="install-btn" onclick="App.installApp()">Install</button>
      <button class="install-close" onclick="this.parentElement.remove()">✕</button>
    `;
    document.getElementById('app').appendChild(banner);
  },

  installApp() {
    if (this.deferredInstallPrompt) {
      this.deferredInstallPrompt.prompt();
      this.deferredInstallPrompt.userChoice.then(choice => {
        if (choice.outcome === 'accepted') {
          this.toast('✅ MedCare installed!', 'success');
        }
        this.deferredInstallPrompt = null;
        document.querySelector('.install-banner')?.remove();
      });
    }
  },

  // ── MODAL ─────────────────────────────────
  showModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  },

  // ── TOAST ─────────────────────────────────
  toast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type ? 'toast-' + type : ''}`;
    el.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
  }
};

// ============================================
// BOOT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();

  // Back button
  document.getElementById('back-btn').addEventListener('click', () => App.goBack());

  // Settings button in header
  document.getElementById('header-settings').addEventListener('click', () => App.navigate('settings'));

  // ── SOS LONG-PRESS (both buttons) ────────────
  const setupSosLongPress = (btn, labelDefault) => {
    if (!btn) return;
    let sosTimer = null;

    const startHold = (e) => {
      e.preventDefault();
      btn.style.transition = 'transform 2s linear';
      btn.style.opacity = '0.8';
      if (btn.classList.contains('sos-btn')) btn.textContent = '🆘 Hold… activating…';

      sosTimer = setTimeout(() => {
        btn.style.transform = '';
        btn.style.opacity = '';
        btn.style.transition = '';
        if (btn.classList.contains('sos-btn')) btn.textContent = labelDefault;
        App.triggerSOS();
      }, 2000);
    };

    const cancelHold = () => {
      clearTimeout(sosTimer);
      btn.style.transform = '';
      btn.style.opacity = '';
      btn.style.transition = '';
      if (btn.classList.contains('sos-btn')) btn.textContent = labelDefault;
    };

    btn.addEventListener('touchstart', startHold, { passive: false });
    btn.addEventListener('touchend', cancelHold);
    btn.addEventListener('touchcancel', cancelHold);
    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('mouseup', cancelHold);
    btn.addEventListener('mouseleave', cancelHold);
  };

  setupSosLongPress(document.getElementById('sos-btn'), '🆘 EMERGENCY SOS');
  setupSosLongPress(document.getElementById('sos-big-btn'), null);

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW failed:', err));

    // Listen for background tick from SW — triggers poll even when tab is hidden
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'MC_BG_TICK') {
        Reminders._poll();
      }
    });

    // Keepalive ping every 25s so SW stays active
    setInterval(() => {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'MC_KEEPALIVE' });
      }
    }, 25_000);
  }
});
