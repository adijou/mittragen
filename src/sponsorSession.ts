export function accountScopedFetch(accountId: string, onChanged: () => void, fetcher: typeof fetch = fetch, isCurrent: () => boolean = () => true): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-Sponsor-Account", accountId);
    if (!isCurrent()) throw new Error("sponsor_account_changed");
    const response = await fetcher(input, { ...init, headers });
    if (!isCurrent()) throw new Error("sponsor_account_changed");
    if (response.status === 401 || response.status === 409) {
      const body = await response.clone().json().catch(() => ({}));
      if (body.error === "sponsor_account_changed" || body.error === "authentication_required") onChanged();
    }
    return response;
  };
}

// Late responses must not restore the previous account's documents after a
// logout, account change or unmount.
export function createSponsorLoadGuard() {
  let generation = 0;
  return {
    begin: () => { const current = ++generation; return () => current === generation; },
    invalidate: () => { generation++; },
  };
}
