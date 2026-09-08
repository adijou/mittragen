export type MembershipRole = "owner" | "sponsoring_admin" | "finance" | "fulfillment" | "viewer";
export type Permission =
  | "tenant:manage"
  | "members:manage"
  | "sponsors:read"
  | "sponsors:write"
  | "finance:read"
  | "finance:write"
  | "fulfillment:write";

const permissions: Record<MembershipRole, Permission[]> = {
  owner: ["tenant:manage", "members:manage", "sponsors:read", "sponsors:write", "finance:read", "finance:write", "fulfillment:write"],
  sponsoring_admin: ["sponsors:read", "sponsors:write", "finance:read", "fulfillment:write"],
  finance: ["sponsors:read", "finance:read", "finance:write"],
  fulfillment: ["sponsors:read", "fulfillment:write"],
  viewer: ["sponsors:read", "finance:read"],
};

export const permissionsFor = (role: MembershipRole) => [...permissions[role]];

export const hasPermission = (role: MembershipRole, permission: Permission) => permissions[role].includes(permission);

