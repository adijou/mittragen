import type { AccountArea } from "../shared/account-areas.ts";
import type { SponsorTarget } from "../shared/sponsor-space-link.ts";
import { clearSponsorEntry } from "./sponsorAccess.ts";

export type AccessDestination = "workspace" | "sponsor" | "areas";

async function accessRequest(path: string, accountId: string | undefined, fetcher: typeof fetch, init?: RequestInit) {
  const response = await fetcher(path, { ...init, headers: {
    "Content-Type": "application/json", ...(accountId ? { "X-Sponsor-Account": accountId } : {}),
  }, signal: AbortSignal.timeout(12000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "access_check_failed");
  return body;
}

export async function readAccountAreas(accountId: string | undefined, fetcher: typeof fetch = fetch): Promise<AccountArea[]> {
  const body = await accessRequest("/api/account/areas", accountId, fetcher);
  if (accountId && body.accountId !== accountId) throw new Error("sponsor_account_changed");
  if (!Array.isArray(body.areas)) throw new Error("access_check_failed");
  return body.areas;
}

export async function claimAccountAreas(accountId: string | undefined, fetcher: typeof fetch = fetch,
  context: { email?: string; target?: SponsorTarget } = {}, sponsorOnly = false): Promise<AccountArea[]> {
  await accessRequest("/api/sponsor-portal/claim", accountId, fetcher, {
    method: "POST", body: JSON.stringify({ target: context.target, expectedEmail: context.email }),
  });
  if (sponsorOnly) return [];
  await accessRequest("/api/team/claim", accountId, fetcher, { method: "POST" });
  return readAccountAreas(accountId, fetcher);
}

export function accountDestination(areas: AccountArea[]): AccessDestination {
  if (areas.length > 1) return "areas";
  return areas[0]?.kind === "sponsor" ? "sponsor" : "workspace";
}

export function openAreaPicker() {
  clearSponsorEntry();
  window.location.assign("/areas");
}
