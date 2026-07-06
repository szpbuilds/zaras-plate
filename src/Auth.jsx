import React, { useState } from "react";
import { FONT_IMPORT } from "./App.jsx";
import { supabase, isSupabaseConfigured } from "./lib/supabase";
import { useAuth } from "./lib/auth";

/* Shared shell so the auth/config/loading screens all match the app's dark brand. */
function AuthShell({ children }) {
  return (
    <div className="az-root">
      <style>{`
        ${FONT_IMPORT}
        .az-root {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: #20242B; padding: 24px; box-sizing: border-box;
        }
        .az-card {
          width: 100%; max-width: 380px; background: #2A2F38; border: 1px solid #3A3F4A;
          border-radius: 18px; padding: 32px 28px; box-sizing: border-box;
        }
        .az-eyebrow {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
          letter-spacing: 0.18em; text-transform: uppercase; color: #C99A3E; margin-bottom: 8px;
        }
        .az-title { font-family: 'Libre Caslon Display', serif; font-size: 30px; color: #F4EFE4; margin: 0 0 6px; }
        .az-sub { font-family: 'Work Sans', sans-serif; font-size: 13px; color: #A9A48F; line-height: 1.5; margin-bottom: 22px; }
        .az-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
        .az-label {
          font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600;
          letter-spacing: 0.06em; text-transform: uppercase; color: #A9A48F;
        }
        .az-input {
          background: #20242B; border: 1px solid #3A3F4A; border-radius: 10px; padding: 11px 13px;
          color: #F4EFE4; font-family: 'Work Sans', sans-serif; font-size: 14px; outline: none;
          transition: border-color 0.15s;
        }
        .az-input:focus { border-color: #C99A3E; }
        .az-input::placeholder { color: #6E6B60; }
        .az-btn {
          width: 100%; margin-top: 6px; background: #C99A3E; border: none; border-radius: 999px;
          padding: 12px; cursor: pointer; color: #20242B;
          font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; letter-spacing: 0.03em;
        }
        .az-btn:hover:not(:disabled) { background: #DCAE55; }
        .az-btn:disabled { opacity: 0.5; cursor: default; }
        .az-error {
          background: rgba(192,69,58,0.14); border: 1px solid rgba(192,69,58,0.4); border-radius: 10px;
          padding: 10px 12px; margin-bottom: 14px;
          font-family: 'Work Sans', sans-serif; font-size: 13px; color: #E8938C; line-height: 1.45;
        }
        .az-note {
          font-family: 'Work Sans', sans-serif; font-size: 13px; color: #A9A48F; line-height: 1.55;
        }
        .az-switch {
          margin-top: 18px; text-align: center;
          font-family: 'Work Sans', sans-serif; font-size: 13px; color: #A9A48F;
        }
        .az-switch button {
          background: none; border: none; padding: 0; cursor: pointer; color: #C99A3E;
          font-family: inherit; font-size: inherit; font-weight: 600; text-decoration: underline;
        }
        .az-code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #F4EFE4; }
      `}</style>
      <div className="az-card">{children}</div>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState("signin"); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState({ type: "idle" }); // idle | loading | error | check-email

  const submit = async (e) => {
    e.preventDefault();
    setStatus({ type: "loading" });
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // If email confirmation is on, there's no session yet — prompt to confirm.
        if (!data.session) {
          setStatus({ type: "check-email" });
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      // On success, onAuthStateChange flips the gate — nothing else to do here.
    } catch (err) {
      setStatus({ type: "error", message: err?.message || "Something went wrong. Try again." });
    }
  };

  if (status.type === "check-email") {
    return (
      <AuthShell>
        <div className="az-eyebrow">Almost there</div>
        <h1 className="az-title">Check your email</h1>
        <p className="az-note">
          We sent a confirmation link to <span className="az-code">{email}</span>. Click it, then come
          back and sign in.
        </p>
        <div className="az-switch">
          <button type="button" onClick={() => { setMode("signin"); setStatus({ type: "idle" }); }}>
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  const loading = status.type === "loading";
  return (
    <AuthShell>
      <div className="az-eyebrow">The Recipe Box</div>
      <h1 className="az-title">Zara's Plate</h1>
      <p className="az-sub">
        {mode === "signin" ? "Sign in to your cookbook and weekly plan." : "Create an account to start your cookbook."}
      </p>
      {status.type === "error" ? <div className="az-error">{status.message}</div> : null}
      <form onSubmit={submit}>
        <div className="az-field">
          <label className="az-label" htmlFor="az-email">Email</label>
          <input
            id="az-email" className="az-input" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
          />
        </div>
        <div className="az-field">
          <label className="az-label" htmlFor="az-password">Password</label>
          <input
            id="az-password" className="az-input" type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            required minLength={6}
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
          />
        </div>
        <button className="az-btn" type="submit" disabled={loading}>
          {loading ? "One sec…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>
      </form>
      <div className="az-switch">
        {mode === "signin" ? "New here? " : "Already have an account? "}
        <button
          type="button"
          onClick={() => { setStatus({ type: "idle" }); setMode(mode === "signin" ? "signup" : "signin"); }}
        >
          {mode === "signin" ? "Create an account" : "Sign in"}
        </button>
      </div>
    </AuthShell>
  );
}

function ConfigNotice() {
  return (
    <AuthShell>
      <div className="az-eyebrow">Setup needed</div>
      <h1 className="az-title">Connect Supabase</h1>
      <p className="az-note">
        Create a <span className="az-code">.env</span> file (copy <span className="az-code">.env.example</span>)
        and set <span className="az-code">VITE_SUPABASE_URL</span> and{" "}
        <span className="az-code">VITE_SUPABASE_ANON_KEY</span>, then restart the dev server.
      </p>
    </AuthShell>
  );
}

function Splash() {
  return (
    <AuthShell>
      <p className="az-note" style={{ textAlign: "center" }}>Loading…</p>
    </AuthShell>
  );
}

/* Gates the app: shows a setup notice / loading / sign-in as needed, else the app. */
export function AuthGate({ children }) {
  const { session, loading } = useAuth();
  if (!isSupabaseConfigured) return <ConfigNotice />;
  if (loading) return <Splash />;
  if (!session) return <AuthScreen />;
  return children;
}
