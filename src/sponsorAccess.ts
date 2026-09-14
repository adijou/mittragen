type SponsorEntry = { email?: string; name?: string; mode: "login" | "signup" };
const entryKey = "mittragen-sponsor-entry";
const targetKey = "mittragen-login-target";

export function shouldOpenSponsorSpace(access: { claimed?: number; hasAccess?: boolean; hasWorkspace?: boolean }) {
  return Number(access.claimed) > 0 || Boolean(access.hasAccess && !access.hasWorkspace);
}

// UI hints only. Authorization always comes from the verified Identity account.
export function prepareSponsorAccess(entry: SponsorEntry, storage: Storage = sessionStorage) {
  storage.setItem(targetKey, "sponsor");
  storage.setItem(entryKey, JSON.stringify(entry));
}

export function readSponsorEntry(storage: Storage = sessionStorage): SponsorEntry | null {
  if (storage.getItem(targetKey) !== "sponsor") return null;
  try {
    const entry = JSON.parse(storage.getItem(entryKey) ?? "null") as SponsorEntry | null;
    return {
      mode: entry?.mode === "signup" ? "signup" : "login",
      email: typeof entry?.email === "string" ? entry.email.slice(0, 320) : undefined,
      name: typeof entry?.name === "string" ? entry.name.slice(0, 160) : undefined,
    };
  } catch { return { mode: "login" }; }
}

export function clearSponsorEntry(storage: Storage = sessionStorage) {
  storage.removeItem(entryKey);
  storage.removeItem(targetKey);
}
