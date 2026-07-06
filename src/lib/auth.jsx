import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";

// Holds the Supabase auth session and exposes it app-wide. `loading` is true only
// during the initial session check on mount, so the gate can avoid flashing the
// sign-in screen for an already-logged-in user.
const AuthContext = createContext({ session: null, user: null, loading: true, signOut: () => {} });

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    // Fires on sign-in, sign-out, and token refresh — keeps the gate in sync.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = () => supabase?.auth.signOut();

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
