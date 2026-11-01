// Calls Supabase (Auth or the REST API) as the signed-in student, with the app's own session.
// `refresh` renews the session once on a 401. Never throws for an HTTP error: returns
// { ok, status, data } (data is parsed JSON, or null).
export function restClient({ supabaseUrl, publishableKey, getToken, refresh }) {
  return async function call(path, { method = 'GET', body, headers = {} } = {}) {
    const send = () => fetch(`${supabaseUrl}${path}`, {
      method,
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
        ...(path.startsWith('/auth/') ? { 'X-Supabase-Api-Version': '2024-01-01' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let response = await send();
    if (response.status === 401 && refresh && await refresh()) response = await send();
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { ok: response.ok, status: response.status, data };
  };
}
