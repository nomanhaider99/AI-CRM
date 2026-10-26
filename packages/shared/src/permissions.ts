import type { Role } from "./enums";

// Role permission matrix from docs/SPEC.md section 3. Route middleware checks these; "own" scopes
// (a seller's own deals and invoices) are enforced in the services, gated by the *_any permissions.
const ALL: readonly Role[] = ["admin", "pm", "seller"];
const MANAGERS: readonly Role[] = ["admin", "pm"];
const ADMIN: readonly Role[] = ["admin"];

export const PERMISSIONS = {
  "workspace:manage": ADMIN, // workspace settings, members, roles, plan, invitations
  "members:read": ALL,
  "clients:read": ALL,
  "clients:write": ALL,
  "clients:delete": ADMIN,
  "deals:read": ALL, // sellers: own + unassigned
  "deals:read_any": MANAGERS,
  "deals:write": ALL, // sellers: own
  "deals:write_any": MANAGERS,
  "deals:reassign": MANAGERS,
  "invoices:read": ALL,
  "invoices:write": ALL, // sellers: invoices on their own deals
  "invoices:write_any": MANAGERS,
  "invoices:delete": ADMIN,
  "ai:use": ALL, // tools still run with the user's own permissions
  "audit:read": MANAGERS,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
