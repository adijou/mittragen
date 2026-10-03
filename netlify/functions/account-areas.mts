import type { Config, Context } from "@netlify/functions";
import { getIdentityConfig } from "@netlify/identity";
import { isResponse, json, requireUser } from "./_shared/auth.ts";
import { withSession } from "./_shared/database.ts";
import { verifySponsorIdentity } from "./_shared/sponsor-identity.ts";
import { loadAccountAreas } from "./_shared/account-areas.ts";

export default async (request: Request, context: Context) => {
  const sessionUser = await requireUser(request);
  if (isResponse(sessionUser)) return sessionUser;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const accessToken = context.cookies.get("nf_jwt") ?? request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const verified = await verifySponsorIdentity(sessionUser, accessToken, getIdentityConfig()?.url);
  if (verified.error) return json({ error: verified.error }, verified.status);
  try {
    const areas = await withSession(verified.user.id, null,
      (client) => loadAccountAreas(client, verified.user.id), verified.user.email ?? undefined);
    return json({ accountId: verified.user.id, areas });
  } catch (error) {
    console.error("account_areas_failed", { requestId: context.requestId, error });
    return json({ error: "account_areas_failed", requestId: context.requestId }, 500);
  }
};

export const config: Config = { path: "/api/account/areas" };
