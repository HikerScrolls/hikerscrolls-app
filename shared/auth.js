// HikerScrolls — Shared Auth Module
// Loaded by all 3 entry points. Exposes global `HikerAuth`.
// Requires Supabase JS v2 CDN script loaded before this file.

(function () {
  "use strict";

  let _supabase = null;
  let _user = null;
  let _session = null;
  let _listeners = [];

  // ── SVG Icons ──

  const ICON_GOOGLE = '<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.09 24.09 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  const ICON_APPLE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.32 2.32-1.55 4.41-3.74 4.25z"/></svg>';

  const ICON_CLOSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  const ICON_BACK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>';

  const ICON_USER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

  // ── Helpers ──

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "className") e.className = v;
        else if (k === "innerHTML") e.innerHTML = v;
        else if (k === "textContent") e.textContent = v;
        else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
        else e.setAttribute(k, v);
      }
    }
    if (children) {
      for (const c of (Array.isArray(children) ? children : [children])) {
        if (typeof c === "string") e.appendChild(document.createTextNode(c));
        else if (c) e.appendChild(c);
      }
    }
    return e;
  }

  function showToast(msg, type) {
    const toast = el("div", { className: "hk-auth-toast" + (type === "success" ? " success" : "") , textContent: msg });
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity 0.3s"; }, 2500);
    setTimeout(() => toast.remove(), 2900);
  }

  // ── Init ──

  async function init() {
    if (typeof window.supabase === "undefined") {
      // Supabase CDN not loaded — hide auth button, degrade gracefully
      const btn = document.getElementById("auth-btn");
      if (btn) btn.style.display = "none";
      return;
    }

    // Fetch config to get Supabase URL + anon key
    let config;
    try {
      const r = await fetch("/api/config");
      config = await r.json();
    } catch {
      return;
    }

    if (!config.supabaseUrl || !config.supabasePublishableKey) return;

    _supabase = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);

    // Restore session
    const { data } = await _supabase.auth.getSession();
    _session = data.session;
    _user = data.session?.user || null;
    _renderAuthButton();

    // Listen for auth changes
    _supabase.auth.onAuthStateChange((_event, session) => {
      _session = session;
      _user = session?.user || null;
      _renderAuthButton();
      for (const fn of _listeners) {
        try { fn(_user, session); } catch {}
      }
    });

    // Handle callback params (email confirmation / OAuth redirect)
    _handleCallbackParams();
  }

  function _handleCallbackParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_confirmed") === "true") {
      showToast("Email verified! You are now signed in.", "success");
      const url = new URL(window.location);
      url.searchParams.delete("auth_confirmed");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
    if (params.get("auth_reset") === "true") {
      showToast("Password updated successfully.", "success");
      const url = new URL(window.location);
      url.searchParams.delete("auth_reset");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
    if (params.get("auth_error")) {
      showToast("Authentication error: " + params.get("auth_error"));
      const url = new URL(window.location);
      url.searchParams.delete("auth_error");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }

  // ── Auth Button Rendering ──

  function _renderAuthButton() {
    const container = document.getElementById("auth-btn");
    if (!container) return;

    container.innerHTML = "";
    container.className = "";

    if (_user) {
      // Logged in — show avatar with dropdown
      container.className = "hk-auth-user-menu";
      const initial = (_user.email || "U")[0].toUpperCase();
      const avatar = el("button", { className: "hk-auth-avatar", textContent: initial, title: _user.email || "Account" });
      const dropdown = el("div", { className: "hk-auth-dropdown" });
      dropdown.appendChild(el("div", { className: "hk-auth-dropdown-email", textContent: _user.email || "User" }));
      dropdown.appendChild(el("button", {
        className: "hk-auth-dropdown-item danger",
        textContent: "Sign Out",
        onClick: async () => {
          await _supabase.auth.signOut();
          dropdown.classList.remove("open");
        }
      }));

      avatar.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown.classList.toggle("open");
      });

      // Close dropdown on outside click
      document.addEventListener("click", () => dropdown.classList.remove("open"), { capture: false });

      container.appendChild(avatar);
      container.appendChild(dropdown);
    } else {
      // Logged out — show sign in button
      container.className = "hk-auth-btn";
      container.innerHTML = ICON_USER + " Sign In";
      container.addEventListener("click", showAuthModal);
    }
  }

  // ── Auth Modal ──

  function showAuthModal(initialView) {
    const existing = document.querySelector(".hk-auth-overlay");
    if (existing) existing.remove();

    let currentView = initialView || "login"; // "login" | "register" | "forgot"

    const overlay = el("div", { className: "hk-auth-overlay" });
    const modal = el("div", { className: "hk-auth-modal" });
    overlay.appendChild(modal);

    // Close on overlay click
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    // Close on Escape
    function onKey(e) {
      if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); }
    }
    document.addEventListener("keydown", onKey);

    function render() {
      modal.innerHTML = "";

      // Header
      const header = el("div", { className: "hk-auth-modal-header" });
      const titleText = currentView === "forgot" ? "Reset Password" : "Welcome";
      header.appendChild(el("h2", { className: "hk-auth-modal-title", textContent: titleText }));
      header.appendChild(el("button", { className: "hk-auth-close", innerHTML: ICON_CLOSE, onClick: () => overlay.remove() }));
      modal.appendChild(header);

      if (currentView === "forgot") {
        _renderForgotView(modal, overlay, () => { currentView = "login"; render(); });
        return;
      }

      // Tabs
      const tabs = el("div", { className: "hk-auth-tabs" });
      const loginTab = el("button", {
        className: "hk-auth-tab" + (currentView === "login" ? " active" : ""),
        textContent: "Sign In",
        onClick: () => { currentView = "login"; render(); }
      });
      const registerTab = el("button", {
        className: "hk-auth-tab" + (currentView === "register" ? " active" : ""),
        textContent: "Create Account",
        onClick: () => { currentView = "register"; render(); }
      });
      tabs.appendChild(loginTab);
      tabs.appendChild(registerTab);
      modal.appendChild(tabs);

      const body = el("div", { className: "hk-auth-body" });
      modal.appendChild(body);

      // SSO Buttons
      const sso = el("div", { className: "hk-auth-sso" });
      sso.appendChild(_makeSSOButton("google", "Continue with Google", ICON_GOOGLE));
      sso.appendChild(_makeSSOButton("apple", "Continue with Apple", ICON_APPLE));
      body.appendChild(sso);

      // Divider
      body.appendChild(el("div", { className: "hk-auth-divider", textContent: "or" }));

      // Error / Success
      const errorEl = el("div", { className: "hk-auth-error" });
      const successEl = el("div", { className: "hk-auth-success" });
      body.appendChild(errorEl);
      body.appendChild(successEl);

      if (currentView === "login") {
        _renderLoginForm(body, overlay, errorEl, successEl);
      } else {
        _renderRegisterForm(body, overlay, errorEl, successEl);
      }
    }

    render();
    document.body.appendChild(overlay);

    // Focus first input
    setTimeout(() => {
      const firstInput = modal.querySelector("input");
      if (firstInput) firstInput.focus();
    }, 100);
  }

  function _makeSSOButton(provider, text, iconHtml) {
    return el("button", {
      className: "hk-auth-sso-btn",
      innerHTML: iconHtml + "<span>" + text + "</span>",
      onClick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const redirectTo = window.location.origin + "/api/auth/callback";
          const { error } = await _supabase.auth.signInWithOAuth({
            provider,
            options: { redirectTo }
          });
          if (error) throw error;
          // Browser will redirect to OAuth provider
        } catch (err) {
          btn.disabled = false;
          showToast("SSO error: " + (err.message || err));
        }
      }
    });
  }

  function _renderLoginForm(body, overlay, errorEl, successEl) {
    const form = el("div", { className: "hk-auth-form" });

    const emailField = el("div", { className: "hk-auth-field" });
    emailField.appendChild(el("label", { textContent: "Email" }));
    const emailInput = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email" });
    emailField.appendChild(emailInput);
    form.appendChild(emailField);

    const passField = el("div", { className: "hk-auth-field" });
    passField.appendChild(el("label", { textContent: "Password" }));
    const passInput = el("input", { type: "password", placeholder: "Your password", autocomplete: "current-password" });
    passField.appendChild(passInput);
    form.appendChild(passField);

    form.appendChild(el("button", {
      className: "hk-auth-forgot",
      textContent: "Forgot password?",
      onClick: () => showAuthModal("forgot")
    }));

    const submitBtn = el("button", { className: "hk-auth-submit", textContent: "Sign In" });
    form.appendChild(submitBtn);

    async function doLogin() {
      const email = emailInput.value.trim();
      const password = passInput.value;
      if (!email || !password) {
        _showMsg(errorEl, "Please enter your email and password.");
        return;
      }
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="hk-auth-spinner"></span> Signing in...';
      _hideMsg(errorEl);
      _hideMsg(successEl);
      try {
        const { error } = await _supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        overlay.remove();
        showToast("Signed in successfully!", "success");
      } catch (err) {
        _showMsg(errorEl, err.message || "Sign in failed.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In";
      }
    }

    submitBtn.addEventListener("click", doLogin);
    passInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

    body.appendChild(form);
  }

  function _renderRegisterForm(body, overlay, errorEl, successEl) {
    const form = el("div", { className: "hk-auth-form" });

    const emailField = el("div", { className: "hk-auth-field" });
    emailField.appendChild(el("label", { textContent: "Email" }));
    const emailInput = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email" });
    emailField.appendChild(emailInput);
    form.appendChild(emailField);

    const passField = el("div", { className: "hk-auth-field" });
    passField.appendChild(el("label", { textContent: "Password" }));
    const passInput = el("input", { type: "password", placeholder: "At least 8 characters", autocomplete: "new-password" });
    passField.appendChild(passInput);
    form.appendChild(passField);

    const confirmField = el("div", { className: "hk-auth-field" });
    confirmField.appendChild(el("label", { textContent: "Confirm Password" }));
    const confirmInput = el("input", { type: "password", placeholder: "Repeat your password", autocomplete: "new-password" });
    confirmField.appendChild(confirmInput);
    form.appendChild(confirmField);

    const submitBtn = el("button", { className: "hk-auth-submit", textContent: "Create Account" });
    form.appendChild(submitBtn);

    async function doRegister() {
      const email = emailInput.value.trim();
      const password = passInput.value;
      const confirm = confirmInput.value;
      if (!email || !password) {
        _showMsg(errorEl, "Please fill in all fields.");
        return;
      }
      if (password.length < 8) {
        _showMsg(errorEl, "Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        _showMsg(errorEl, "Passwords do not match.");
        return;
      }
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="hk-auth-spinner"></span> Creating account...';
      _hideMsg(errorEl);
      _hideMsg(successEl);
      try {
        const { error } = await _supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/api/auth/callback" }
        });
        if (error) throw error;
        _showMsg(successEl, "Check your email for a verification link!");
      } catch (err) {
        _showMsg(errorEl, err.message || "Registration failed.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Account";
      }
    }

    submitBtn.addEventListener("click", doRegister);
    confirmInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doRegister(); });

    body.appendChild(form);
  }

  function _renderForgotView(modal, overlay, goBack) {
    const body = el("div", { className: "hk-auth-body" });
    modal.appendChild(body);

    body.appendChild(el("button", {
      className: "hk-auth-back",
      innerHTML: ICON_BACK + " Back to Sign In",
      onClick: goBack
    }));

    const errorEl = el("div", { className: "hk-auth-error" });
    const successEl = el("div", { className: "hk-auth-success" });
    body.appendChild(errorEl);
    body.appendChild(successEl);

    const form = el("div", { className: "hk-auth-form" });

    form.appendChild(el("p", {
      textContent: "Enter your email and we'll send you a link to reset your password.",
      style: "color:#64748b;font-size:14px;margin:0 0 8px;"
    }));

    const emailField = el("div", { className: "hk-auth-field" });
    emailField.appendChild(el("label", { textContent: "Email" }));
    const emailInput = el("input", { type: "email", placeholder: "you@example.com", autocomplete: "email" });
    emailField.appendChild(emailInput);
    form.appendChild(emailField);

    const submitBtn = el("button", { className: "hk-auth-submit", textContent: "Send Reset Link" });
    form.appendChild(submitBtn);

    async function doReset() {
      const email = emailInput.value.trim();
      if (!email) {
        _showMsg(errorEl, "Please enter your email.");
        return;
      }
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="hk-auth-spinner"></span> Sending...';
      _hideMsg(errorEl);
      _hideMsg(successEl);
      try {
        const { error } = await _supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/api/auth/callback"
        });
        if (error) throw error;
        _showMsg(successEl, "Password reset link sent! Check your email.");
      } catch (err) {
        _showMsg(errorEl, err.message || "Could not send reset email.");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Reset Link";
      }
    }

    submitBtn.addEventListener("click", doReset);
    emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") doReset(); });

    body.appendChild(form);

    setTimeout(() => emailInput.focus(), 100);
  }

  // ── Message helpers ──

  function _showMsg(el, msg) {
    el.textContent = msg;
    el.classList.add("visible");
  }

  function _hideMsg(el) {
    el.textContent = "";
    el.classList.remove("visible");
  }

  // ── Public API ──

  window.HikerAuth = {
    init,
    showAuthModal,

    getUser() { return _user; },

    getSession() { return _session; },

    getAccessToken() { return _session?.access_token || null; },

    onAuthStateChange(fn) {
      _listeners.push(fn);
      return () => { _listeners = _listeners.filter(f => f !== fn); };
    },

    async signOut() {
      if (_supabase) await _supabase.auth.signOut();
    }
  };
})();
