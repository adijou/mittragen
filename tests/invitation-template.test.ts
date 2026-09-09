import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templatePath = new URL("../public/emails/invitation.html", import.meta.url);

test("the branded invitation keeps Netlify Identity variables and directs invitees to login", async () => {
  const template = await readFile(templatePath, "utf8");

  assert.match(template, /mittragen/i);
  assert.match(template, /\{\{ \.SiteURL \}\}\/login\/#invite_token=\{\{ \.Token \}\}/);
  assert.doesNotMatch(template, /<(?:html|head|body)\b/i);
  assert.doesNotMatch(template, /<(?:img|script)\b/i);
});
