import { admin, type User } from "@netlify/identity";

export type IdentityAdmin = Pick<typeof admin, "listUsers">;

export async function findIdentityUserByEmail(email: string, identityAdmin: IdentityAdmin = admin): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  const perPage = 100;
  for (let page = 1; page <= 200; page += 1) {
    const users = await identityAdmin.listUsers({ page, perPage });
    const match = users.find((user) => user.email?.trim().toLowerCase() === normalized);
    if (match) return match;
    if (users.length < perPage) return null;
  }
  return null;
}
