/**
 * TastyTrade OAuth2 authentication module.
 *
 * Uses the refresh_token grant to obtain a short-lived access_token.
 * Token is cached in-memory for the run. On any 401 from the API,
 * the cache is invalidated and one automatic re-auth retry is performed.
 *
 * Required env vars:
 *   TASTYTRADE_CLIENT_SECRET — OAuth client secret
 *   TASTYTRADE_REFRESH_TOKEN — long-lived refresh token
 */

const BASE_URL = "https://api.tastytrade.com";

/** In-memory token cache (lives for the process lifetime) */
let tokenCache = { token: null, expiresAt: 0 };

/** Pending refresh promise — prevents duplicate concurrent refresh calls */
let refreshPromise = null;


/**
 * Returns a valid access token, refreshing if needed.
 * Proactively refreshes 60 seconds before expiry.
 */
export async function getTastyToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  // If a refresh is already in-flight (from a concurrent call), wait for it
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const clientSecret = process.env.TASTYTRADE_CLIENT_SECRET;
    const refreshToken = process.env.TASTYTRADE_REFRESH_TOKEN;

    if (!clientSecret || !refreshToken) {
      throw new Error(
        "Missing TASTYTRADE_CLIENT_SECRET or TASTYTRADE_REFRESH_TOKEN env vars. " +
        "Add them as GitHub Actions Secrets."
      );
    }

    console.log("  🔑  Refreshing TastyTrade access token...");

    const body = new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: refreshToken.trim(),
      client_secret: clientSecret.trim(),
    });

    const res = await fetch(`${BASE_URL}/oauth/token`, {
      method:  "POST",
      headers: { "User-Agent": "stock-scanner/2.0 (+https://github.com)" },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 401 && text.includes("nginx")) {
        throw new Error(
          "TastyTrade auth failed (401): Invalid Client Secret or Refresh Token. " +
          "Check your GitHub Actions Secrets."
        );
      }
      throw new Error(`TastyTrade auth failed (${res.status}): ${text}`);
    }

    const data        = await res.json();
    const accessToken = data.access_token ?? data["session-token"];

    if (!accessToken) throw new Error("TastyTrade auth: No access_token in response.");

    const expiresIn = data.expires_in ?? 1800;
    tokenCache = { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 };

    console.log(`  ✅  Token obtained (expires in ${Math.round(expiresIn / 60)} min)`);
    return tokenCache.token;
  })().finally(() => { refreshPromise = null; });

  return refreshPromise;
}

/** Invalidate the cached token (forces re-auth on next call) */
function invalidateToken() {
  tokenCache = { token: null, expiresAt: 0 };
}

/**
 * Fetch a TastyTrade production API endpoint.
 * Automatically retries once with a fresh token on 401.
 *
 * @param {string} endpoint  — e.g. "/public-watchlists"
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
export async function tastyFetch(endpoint, options = {}) {
  const doRequest = async (token) => {
    return fetch(`${BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept":        "application/json",
        "User-Agent":    "stock-scanner/2.0 (+https://github.com)",
        ...options.headers,
      },
    });
  };

  const token = await getTastyToken();
  const res   = await doRequest(token);

  if (res.status === 401) {
    console.warn("  ⚠️  Received 401 — refreshing token and retrying...");
    invalidateToken();
    const freshToken = await getTastyToken();
    return doRequest(freshToken);
  }

  return res;
}
