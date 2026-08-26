import { createClient } from "@supabase/supabase-js";

// Only used for Storage (the justificatif files). Auth and the line/statement
// data stay on Firebase (Auth + Firestore) — Supabase's free tier doesn't
// require a payment card, unlike Firebase Storage since late 2024.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const JUSTIFICATIFS_BUCKET = "justificatifs";
