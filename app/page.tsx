"use client";

import AuthGate from "@/components/AuthGate";
import App from "@/components/App";

export default function Page() {
  return (
    <AuthGate>
      <App />
    </AuthGate>
  );
}
