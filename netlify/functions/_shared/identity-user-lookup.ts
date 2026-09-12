import { admin, type User } from "@netlify/identity";

export type IdentityAdmin = Pick<typeof admin, "listUsers">;

export async function findIdentityUserByEmail(email: string, identityAdmin: IdentityAdmin = admin): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const users = await identityAdmin.listUsers({ page, perPage: 1000 });
    const match = users.find((user) => user.email?.trim().toLowerCase() === normalized);
    if (match) return match;
    if (users.length < 1000) return null;
  }
  return null;
}
