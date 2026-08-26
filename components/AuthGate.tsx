"use client";

import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

/**
 * Gate that only renders `children` once a Firebase Auth user is signed
 * in. Real access control lives in firestore.rules / storage.rules (the
 * two allowed emails) — this component only handles the sign-in UI and
 * lets Firebase itself reject reads/writes from anyone else.
 *
 * Accounts must be created ahead of time in the Firebase console
 * (Authentication > Users > Add user) — there is no public sign-up here
 * on purpose, since this tool is meant for exactly two people.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = loading
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const code = (err as { code?: string })?.code || "";
      if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
        setError("Email ou mot de passe incorrect.");
      } else if (code.includes("too-many-requests")) {
        setError("Trop de tentatives — réessaie dans quelques minutes.");
      } else {
        setError("Connexion impossible. Vérifie ta connexion internet.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (user === undefined) return null; // brief auth-state check, avoid a flash of the login form
  if (user === null) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={handleSubmit}>
          <h1>🧾 Classeur Amex</h1>
          <p className="sub">Connecte-toi pour accéder au relevé et aux justificatifs.</p>
          {error && <div className="auth-error">{error}</div>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
}

export function useSignOut() {
  return () => signOut(auth);
}
