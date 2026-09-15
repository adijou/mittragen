import { getStore } from "@netlify/blobs";
import { getContext, type Config, type UserSignupEvent } from "@netlify/functions";
import { createRegistrationNotificationHandler } from "./_shared/registration-notification.ts";
import { contractEmailConfig } from "./_shared/contract-delivery.ts";

// Netlify verifies the signed Identity event before invoking userSignup.
// No fetch handler/public mail endpoint, login hook, or user mutation.
const notification = createRegistrationNotificationHandler({
  settings: () => {
    const context = getContext();
    const recipient = Netlify.env.get("REGISTRATION_NOTIFICATION_TO")?.trim();
    const scope = { context: context.deploy.context, siteId: context.site.id ?? "", recipient };
    if (scope.context !== "production" || !recipient) return scope;
    return { ...scope, ...contractEmailConfig() };
  },
  store: () => getStore({ name: "registration-notifications", consistency: "strong" }),
});

export default {
  async userSignup(event: UserSignupEvent) {
    await notification.userSignup(event);
  },
};

// Mail failures are retried by Netlify without blocking account activation.
export const config: Config = { background: true };
