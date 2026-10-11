/* LvlUp private cloud layer: Supabase sign-in gate, session handling and a save queue.
 *
 * - The page stays locked (html.lvl-locked hides everything except the sign-in gate) until
 *   Supabase confirms a valid session AND the database confirms this account is the owner.
 * - Private data is only requested after that, inside the page's onReady callback.
 * - Sessions persist in this browser (Supabase's supported localStorage session) and refresh
 *   automatically. Signing out reloads the page, which discards all private data in memory.
 * - Edits go through Cloud.outbox: one request at a time, in order, with retries. A change is
 *   shown as saved only after Supabase confirms it.
 * No secrets live here; the publishable key is in assets/config.js and RLS protects the data.
 */
(function () {
  'use strict';
  var CFG = window.LVLUP_SUPABASE || {};
  var sb = null, opts = {}, unlocked = false, readyDone = false, userSignOut = false, recoveryMode = false;
  var gate = null;

  // ---------- styles for the gate and status pill (scoped by id/class prefix) ----------
  var CSS = [
    '#lvlGate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:radial-gradient(1200px 600px at 20% -10%,#efe8fb 0%,#f7f7fb 55%) #f7f7fb;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#17182c;overflow-y:auto}',
    '#lvlGate .lg-card{width:min(400px,100%);background:#fff;border:1px solid #e7e7f0;border-radius:18px;box-shadow:0 18px 60px rgba(37,26,77,.12);padding:28px 26px}',
    '#lvlGate .lg-brand{display:flex;align-items:center;gap:11px;margin-bottom:20px}',
    '#lvlGate .lg-mark{width:38px;height:38px;border-radius:11px;background:#7141bd;color:#fff;display:grid;place-items:center;font-weight:900;font-size:18px}',
    '#lvlGate .lg-name{font-weight:900;letter-spacing:.06em;font-size:13px}#lvlGate .lg-sub{font-size:11px;color:#74778a;letter-spacing:.08em}',
    '#lvlGate h1{font-size:21px;margin:0 0 6px;letter-spacing:-.01em}#lvlGate p{margin:0 0 16px;color:#56546a;font-size:13.5px;line-height:1.5}',
    '#lvlGate label{display:block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#74778a;margin:12px 0 5px}',
    '#lvlGate input{width:100%;box-sizing:border-box;border:1px solid #dcdbe8;border-radius:10px;padding:11px 12px;font:inherit;font-size:15px;background:#fff;color:#17182c}',
    '#lvlGate input:focus{outline:2px solid #c9b5ee;border-color:#7141bd}',
    '#lvlGate .lg-btn{width:100%;margin-top:18px;border:0;border-radius:10px;padding:12px;background:#7141bd;color:#fff;font:inherit;font-weight:800;font-size:15px;cursor:pointer}',
    '#lvlGate .lg-btn[disabled]{opacity:.6;cursor:wait}',
    '#lvlGate .lg-btn.secondary{background:#fff;color:#17182c;border:1px solid #dcdbe8}',
    '#lvlGate .lg-link{background:none;border:0;padding:0;color:#7141bd;font:inherit;font-size:13px;font-weight:700;cursor:pointer;margin-top:14px}',
    '#lvlGate .lg-msg{margin-top:14px;font-size:13px;border-radius:10px;padding:10px 12px;display:none;line-height:1.45}',
    '#lvlGate .lg-msg.show{display:block}#lvlGate .lg-msg.err{background:#ffe8eb;color:#8a1c2b}#lvlGate .lg-msg.ok{background:#e0f5f1;color:#065f5b}#lvlGate .lg-msg.info{background:#f2f0f8;color:#4a4760}',
    '#lvlGate .lg-spin{width:22px;height:22px;border:3px solid #e7e0f5;border-top-color:#7141bd;border-radius:50%;animation:lgspin .8s linear infinite;margin:6px auto 14px}',
    '@keyframes lgspin{to{transform:rotate(360deg)}}',
    '#lvlGate .lg-foot{margin-top:18px;font-size:11.5px;color:#8a879e;line-height:1.5}',
    '.lvl-status{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:700;color:#74778a;white-space:nowrap}',
    '.lvl-status .dot{width:7px;height:7px;border-radius:50%;background:#b6b4c6}',
    '.lvl-status.saved{color:#087e79}.lvl-status.saved .dot{background:#087e79}',
    '.lvl-status.saving{color:#a76510}.lvl-status.saving .dot{background:#d79a2b}',
    '.lvl-status.error{color:#b23e54}.lvl-status.error .dot{background:#b23e54}',
    '.lvl-status button{border:1px solid #f0b9c0;background:#fff;color:#b23e54;border-radius:7px;padding:2px 7px;font:inherit;font-size:11px;cursor:pointer}',
    '.lvl-banner{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#eef4ff;border:1px solid #c9d8f5;color:#1f3f78;border-radius:12px;padding:11px 13px;font-size:13px;margin:0 0 14px}',
    '.lvl-banner .grow{flex:1;min-width:220px}.lvl-banner button{border:1px solid #c9d8f5;background:#fff;border-radius:8px;padding:6px 10px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;color:#1f3f78}',
    '.lvl-banner button.primary{background:#2f5fb3;border-color:#2f5fb3;color:#fff}'
  ].join('\n');

  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }

  function ensureGate() {
    if (gate) return gate;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    gate = document.createElement('div'); gate.id = 'lvlGate'; gate.setAttribute('role', 'dialog'); gate.setAttribute('aria-modal', 'true');
    document.body.appendChild(gate);
    return gate;
  }
  function brand() {
    return '<div class="lg-brand"><div class="lg-mark">L</div><div><div class="lg-name">LVLUP / SCOUT</div><div class="lg-sub">PRIVATE WORKSPACE</div></div></div>';
  }
  function lock() { document.documentElement.classList.add('lvl-locked'); ensureGate().style.display = 'flex'; unlocked = false; }
  function unlock() { document.documentElement.classList.remove('lvl-locked'); if (gate) gate.style.display = 'none'; unlocked = true; }
  function msg(text, kind) { var m = gate && gate.querySelector('.lg-msg'); if (!m) return; m.className = 'lg-msg show ' + (kind || 'info'); m.textContent = text; }

  function showChecking(text) {
    lock();
    gate.innerHTML = '<div class="lg-card">' + brand() + '<div class="lg-spin" aria-hidden="true"></div><p style="text-align:center;margin:0">' + h(text || 'Checking your sign-in…') + '</p></div>';
  }
  function showFatal(text, retry) {
    lock();
    gate.innerHTML = '<div class="lg-card">' + brand() + '<h1>Something went wrong</h1><p>' + h(text) + '</p>' +
      '<button class="lg-btn" id="lgRetry">' + (retry ? 'Try again' : 'Reload') + '</button></div>';
    gate.querySelector('#lgRetry').onclick = function () { if (retry) retry(); else location.reload(); };
  }
  function showLogin(note, kind) {
    lock();
    gate.innerHTML = '<div class="lg-card">' + brand() +
      '<h1>Sign in</h1><p>' + h(opts.appName ? 'Sign in to open ' + opts.appName + '.' : 'Sign in to continue.') + '</p>' +
      '<form id="lgForm" novalidate><label for="lgEmail">Email</label><input id="lgEmail" type="email" autocomplete="username" required>' +
      '<label for="lgPass">Password</label><input id="lgPass" type="password" autocomplete="current-password" required>' +
      '<button class="lg-btn" id="lgSubmit" type="submit">Sign in</button></form>' +
      '<button class="lg-link" id="lgForgot" type="button">Forgot password?</button>' +
      '<div class="lg-msg" role="status" aria-live="polite"></div>' +
      '<div class="lg-foot">You stay signed in on this device until you sign out. Private browsing, clearing site data or a security event will ask you to sign in again.</div></div>';
    if (note) msg(note, kind || 'info');
    var form = gate.querySelector('#lgForm'), btn = gate.querySelector('#lgSubmit');
    gate.querySelector('#lgEmail').focus();
    form.onsubmit = async function (e) {
      e.preventDefault();
      var email = gate.querySelector('#lgEmail').value.trim(), pass = gate.querySelector('#lgPass').value;
      if (!email || !pass) { msg('Enter your email and password.', 'err'); return; }
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        var res = await sb.auth.signInWithPassword({ email: email, password: pass });
        if (res.error) throw res.error;
        await enter(res.data.session);
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Sign in';
        msg(friendlyAuthError(err), 'err');
      }
    };
    gate.querySelector('#lgForgot').onclick = function () { showForgot(gate.querySelector('#lgEmail').value.trim()); };
  }
  function showForgot(prefill) {
    lock();
    gate.innerHTML = '<div class="lg-card">' + brand() + '<h1>Reset password</h1><p>Enter your email. If it belongs to the account, Supabase will email you a reset link.</p>' +
      '<form id="lgForm" novalidate><label for="lgEmail">Email</label><input id="lgEmail" type="email" autocomplete="username" value="' + h(prefill || '') + '">' +
      '<button class="lg-btn" id="lgSubmit" type="submit">Send reset link</button></form>' +
      '<button class="lg-link" id="lgBack" type="button">← Back to sign in</button><div class="lg-msg" role="status" aria-live="polite"></div></div>';
    var btn = gate.querySelector('#lgSubmit');
    gate.querySelector('#lgBack').onclick = function () { showLogin(); };
    gate.querySelector('#lgForm').onsubmit = async function (e) {
      e.preventDefault();
      var email = gate.querySelector('#lgEmail').value.trim();
      if (!email) { msg('Enter your email.', 'err'); return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        var res = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        if (res.error) throw res.error;
        msg('If that email has an account, a reset link is on its way. Open it on this device.', 'ok');
      } catch (err) { msg(friendlyAuthError(err), 'err'); }
      btn.disabled = false; btn.textContent = 'Send reset link';
    };
  }
  function showRecovery() {
    lock();
    gate.innerHTML = '<div class="lg-card">' + brand() + '<h1>Choose a new password</h1><p>Use at least 8 characters.</p>' +
      '<form id="lgForm" novalidate><label for="lgPass">New password</label><input id="lgPass" type="password" autocomplete="new-password">' +
      '<label for="lgPass2">Repeat new password</label><input id="lgPass2" type="password" autocomplete="new-password">' +
      '<button class="lg-btn" id="lgSubmit" type="submit">Save new password</button></form><div class="lg-msg" role="status" aria-live="polite"></div></div>';
    var btn = gate.querySelector('#lgSubmit');
    gate.querySelector('#lgForm').onsubmit = async function (e) {
      e.preventDefault();
      var p1 = gate.querySelector('#lgPass').value, p2 = gate.querySelector('#lgPass2').value;
      if (p1.length < 8) { msg('Use at least 8 characters.', 'err'); return; }
      if (p1 !== p2) { msg('The two passwords do not match.', 'err'); return; }
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        var res = await sb.auth.updateUser({ password: p1 });
        if (res.error) throw res.error;
        recoveryMode = false;
        var s = (await sb.auth.getSession()).data.session;
        if (s) await enter(s); else showLogin('Password updated. Please sign in.', 'ok');
      } catch (err) { btn.disabled = false; btn.textContent = 'Save new password'; msg(friendlyAuthError(err), 'err'); }
    };
  }
  function showDenied(email) {
    lock();
    gate.innerHTML = '<div class="lg-card">' + brand() + '<h1>No access</h1><p>You are signed in as <b>' + h(email || 'this account') +
      '</b>, but this account is not authorised for this workspace.</p><button class="lg-btn secondary" id="lgOut">Sign out</button></div>';
    gate.querySelector('#lgOut').onclick = function () { Cloud.signOut(true); };
  }

  function friendlyAuthError(err) {
    var m = String((err && (err.message || err.error_description)) || err || '');
    if (/invalid login credentials/i.test(m)) return 'That email and password do not match. Check them and try again.';
    if (/email not confirmed/i.test(m)) return 'This email address has not been confirmed yet.';
    if (/rate limit|too many/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
    if (/failed to fetch|network/i.test(m)) return 'Could not reach the sign-in service. Check your internet connection and try again.';
    if (/same.*password|different from the old/i.test(m)) return 'Choose a password that is different from your old one.';
    if (/weak|short|at least/i.test(m)) return 'That password is too weak. Use a longer one.';
    return 'Sign-in failed: ' + m;
  }
  function isAuthError(e) {
    var m = String((e && e.message) || '');
    return !!e && (e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt (expired|invalid)|invalid jwt|not authenticated/i.test(m));
  }

  // ---------- sign-in -> owner check -> page ----------
  async function enter(session) {
    if (!session) { showLogin(); return; }
    showChecking('Opening your workspace…');
    var res = await sb.rpc('claim_owner');
    if (res.error) {
      if (isAuthError(res.error)) { await sb.auth.signOut({ scope: 'local' }).catch(function () {}); showLogin('Your session has expired. Please sign in again.'); return; }
      showFatal('Could not confirm access: ' + (res.error.message || res.error) + '. Check your connection and try again.', function () { enter(session); });
      return;
    }
    if (res.data !== true) { showDenied(session.user && session.user.email); return; }
    Cloud.user = session.user;
    if (readyDone) { unlock(); outbox.flush(); if (opts.onResume) opts.onResume(); return; }
    try {
      await opts.onReady({ sb: sb, user: session.user });
      readyDone = true;
      unlock();
      renderAccount();
    } catch (err) {
      console.error('Workspace load failed', err);
      if (isAuthError(err)) { showLogin('Your session has expired. Please sign in again.'); return; }
      showFatal('Your private data could not be loaded (' + (err.message || err) + '). Nothing has been changed. Check your connection and try again.', function () { location.reload(); });
    }
  }

  function onAuthEvent(event) {
    if (event === 'PASSWORD_RECOVERY') { recoveryMode = true; showRecovery(); return; }
    if (event === 'SIGNED_OUT') {
      if (userSignOut) { wipeAndReload('signed-out'); return; }
      if (!readyDone) return; // still on the sign-in screen; nothing private is loaded
      // Session ended (expired, revoked, or signed out in another tab).
      if (outbox.pending()) { showLogin('Your session ended. Sign in again to save your unsaved changes.', 'err'); return; }
      wipeAndReload('expired');
    }
  }
  function wipeAndReload(reason) {
    try { if (opts.onSignOut) opts.onSignOut(); } catch (e) {}
    var url = location.pathname + (reason ? '?' + reason + '=1' : '');
    location.replace(url);
  }

  async function boot() {
    ensureGate();
    showChecking();
    if (!window.supabase || !window.supabase.createClient || !CFG.url || !CFG.publishableKey) {
      showFatal('The sign-in service could not be loaded. Check your internet connection (or any content blocker) and reload.');
      return;
    }
    var hash = location.hash || '';
    var hp = new URLSearchParams(hash.replace(/^#/, ''));
    recoveryMode = hp.get('type') === 'recovery';
    var linkError = hp.get('error_description');
    var qp = new URLSearchParams(location.search);
    var note = qp.get('signed-out') ? ['You have signed out.', 'ok'] : qp.get('expired') ? ['Your session ended. Please sign in again.', 'info'] : null;
    if (qp.get('signed-out') || qp.get('expired')) history.replaceState(null, '', location.pathname + location.hash);
    sb = window.supabase.createClient(CFG.url, CFG.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'lvlup-scout-auth' }
    });
    Cloud.sb = sb;
    sb.auth.onAuthStateChange(function (event) { setTimeout(function () { onAuthEvent(event); }, 0); });
    var got = await sb.auth.getSession();
    if (linkError) { history.replaceState(null, '', location.pathname); showLogin('That link is invalid or has expired. Request a new reset link.', 'err'); return; }
    if (recoveryMode) { showRecovery(); return; }
    if (got.error || !got.data.session) { showLogin(note && note[0], note && note[1]); return; }
    await enter(got.data.session);
  }

  // ---------- save queue ----------
  var outbox = {
    queue: [], running: false, failed: null, timer: null, retryTimer: null, retryDelay: 2000, listeners: [],
    pending: function () { return this.queue.length > 0 || this.running; },
    add: function (op) {
      if (op.key) {
        for (var i = this.queue.length - 1; i >= 0; i--) {
          var q = this.queue[i];
          if (q.key === op.key && !q.started && q.merge) { q.merge(op); this.kick(); return; }
        }
      }
      this.queue.push(op); this.kick();
    },
    kick: function (delay) {
      var self = this; clearTimeout(this.timer); this.emit();
      if (this.failed) return; // wait for retry timer / manual retry
      this.timer = setTimeout(function () { self.flush(); }, delay == null ? 700 : delay);
    },
    flush: async function () {
      if (this.running || !unlocked) return;
      clearTimeout(this.timer); clearTimeout(this.retryTimer);
      this.running = true; this.emit();
      try {
        while (this.queue.length) {
          var op = this.queue[0]; op.started = true;
          try { await op.run(); this.queue.shift(); this.failed = null; this.retryDelay = 2000; }
          catch (e) {
            op.started = false; this.failed = e; console.warn('Save failed; will retry', e);
            if (isAuthError(e)) {
              var r = await sb.auth.refreshSession().catch(function (x) { return { error: x }; });
              if (r && r.error) { showLogin('Your session ended. Sign in again to save your unsaved changes.', 'err'); break; }
            }
            this.scheduleRetry(); break;
          }
        }
      } finally { this.running = false; this.emit(); }
    },
    scheduleRetry: function () {
      var self = this; clearTimeout(this.retryTimer);
      this.retryAt = Date.now() + this.retryDelay;
      this.retryTimer = setTimeout(function () { self.failed = null; self.flush(); }, this.retryDelay);
      this.retryDelay = Math.min(this.retryDelay * 2, 30000);
    },
    retryNow: function () { this.failed = null; this.retryDelay = 2000; this.flush(); },
    emit: function () { var s = this.state(); this.listeners.forEach(function (f) { try { f(s); } catch (e) {} }); },
    state: function () {
      if (this.failed) return { kind: 'error', text: navigator.onLine === false ? 'Offline · changes will save when you reconnect' : 'Not saved yet · retrying', error: this.failed };
      if (this.queue.length || this.running) return { kind: 'saving', text: 'Saving…' };
      return { kind: 'saved', text: 'All changes saved' };
    }
  };
  window.addEventListener('online', function () { if (outbox.queue.length) outbox.retryNow(); });
  window.addEventListener('beforeunload', function (e) { if (outbox.queue.length || outbox.running) { e.preventDefault(); e.returnValue = ''; } });

  // A versioned row (has `version` bumped by a database trigger). Sends only changed fields and
  // only applies them if nobody else changed the row since we last saw it; otherwise it reloads
  // the latest row, lets the page merge it, and retries with the same changed fields.
  function versionedOp(cfg, key, patch) {
    return {
      key: cfg.table + ':' + key, patch: Object.assign({}, patch),
      merge: function (o) { Object.assign(this.patch, o.patch); },
      run: async function () {
        for (var attempt = 0; attempt < 5; attempt++) {
          var m = cfg.meta.get(key), res;
          if (!m) {
            var row = Object.assign({}, cfg.fullRow ? cfg.fullRow(key) : {}, this.patch); row[cfg.keyCol] = key;
            delete row.version;
            res = await sb.from(cfg.table).insert(row).select();
            if (!res.error) { cfg.meta.set(key, { version: res.data[0].version, deleted: !!res.data[0].deleted_at }); return; }
            if (res.error.code !== '23505') throw res.error;
          } else {
            res = await sb.from(cfg.table).update(this.patch).eq(cfg.keyCol, key).eq('version', m.version).select();
            if (res.error) throw res.error;
            if (res.data && res.data.length) { m.version = res.data[0].version; m.deleted = !!res.data[0].deleted_at; if (cfg.onSaved) cfg.onSaved(res.data[0]); return; }
          }
          // Row exists with a different version (edited on another device) or appeared meanwhile.
          var latest = await sb.from(cfg.table).select('*').eq(cfg.keyCol, key).maybeSingle();
          if (latest.error) throw latest.error;
          if (!latest.data) { cfg.meta.delete(key); continue; }
          var wasDeleted = m && m.deleted;
          cfg.meta.set(key, { version: latest.data.version, deleted: !!latest.data.deleted_at });
          if (latest.data.deleted_at && !wasDeleted && !('deleted_at' in this.patch)) {
            if (cfg.onRemoteDeleted) cfg.onRemoteDeleted(key, latest.data);
            return; // never resurrect a record deleted on another device
          }
          if (cfg.onRemote) cfg.onRemote(latest.data, Object.keys(this.patch));
        }
        throw new Error('This record kept changing on another device; please retry.');
      }
    };
  }

  async function fetchAll(table, build) {
    var out = [], from = 0, size = 1000;
    for (;;) {
      var q = sb.from(table).select('*');
      if (build) q = build(q);
      var res = await q.range(from, from + size - 1);
      if (res.error) throw res.error;
      out = out.concat(res.data || []);
      if (!res.data || res.data.length < size) return out;
      from += size;
    }
  }

  // ---------- account controls ----------
  var statusEls = [];
  function renderAccount() {
    if (opts.signOutButton) {
      var b = document.getElementById(opts.signOutButton);
      if (b) {
        b.hidden = false; b.title = Cloud.user && Cloud.user.email ? 'Signed in as ' + Cloud.user.email : '';
        b.onclick = function () { Cloud.signOut(false, b); };
      }
    }
  }
  function mountStatus(id) {
    var el = document.getElementById(id); if (!el) return;
    statusEls.push(el);
    var paint = function (s) {
      el.className = 'lvl-status ' + s.kind;
      el.innerHTML = '<span class="dot"></span><span>' + h(s.text) + '</span>' + (s.kind === 'error' ? '<button type="button">Retry now</button>' : '');
      el.title = s.error ? String(s.error.message || s.error) : '';
      var r = el.querySelector('button'); if (r) r.onclick = function () { outbox.retryNow(); };
    };
    outbox.listeners.push(paint); paint(outbox.state());
  }

  var Cloud = {
    sb: null, user: null, outbox: outbox, versionedOp: versionedOp, fetchAll: fetchAll, isAuthError: isAuthError, mountStatus: mountStatus,
    start: function (o) {
      opts = o || {};
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    },
    signOut: async function (force, btn) {
      if (!force && outbox.pending()) {
        if (!btn || btn.dataset.armed !== '1') {
          if (btn) { btn.dataset.armed = '1'; btn.textContent = 'Unsaved changes · click again to sign out'; setTimeout(function () { btn.dataset.armed = ''; btn.textContent = 'Sign out'; }, 4000); }
          return;
        }
      }
      userSignOut = true;
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
      wipeAndReload('signed-out');
    }
  };
  window.LvlupCloud = Cloud;
})();
