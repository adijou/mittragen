import { sponsorSpacePath } from "./sponsor-space-link.ts";

export type WorkspaceArea = { kind: "workspace"; tenantId: string; tenantName: string; role: string };
export type SponsorArea = { kind: "sponsor"; tenantId: string; tenantName: string; sponsorId: string; sponsorName: string };
export type AccountArea = WorkspaceArea | SponsorArea;

export const workspaceRoleLabels: Record<string, string> = {
  owner: "Owner", sponsoring_admin: "Sponsoring-Admin", finance: "Finanzen",
  fulfillment: "Sponsoringleistungen", viewer: "Lesen",
};

export function accountAreaPath(area: AccountArea) {
  return area.kind === "sponsor" ? sponsorSpacePath(area)
    : `/workspace?${new URLSearchParams({ tenant: area.tenantId })}`;
}

// A URL is only a navigation hint. Never fall back to another organization
// when an explicit target is unavailable for the current account.
export function selectWorkspaceTenant(tenants: Array<{ id: string }>, target: string | null, previous?: string | null) {
  if (target !== null) {
    if (!tenants.some((tenant) => tenant.id === target)) throw new Error("workspace_link_access_denied");
    return target;
  }
  return tenants.some((tenant) => tenant.id === previous) ? previous! : tenants[0]?.id ?? "";
}
