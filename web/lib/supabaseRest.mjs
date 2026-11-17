// Calls Supabase (Auth or the REST API) as the signed-in student, with the app's own session.
// `refresh` renews the session once when it has expired: a 401, or the 403 "bad_jwt" Supabase
// Auth answers with for an expired access token. Never throws for an HTTP error: returns
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
    const read = async response => {
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      return { ok: response.ok, status: response.status, data };
    };
    let result = await read(await send());
    if (sessionExpired(result) && refresh && await refresh()) result = await read(await send());
    return result;
  };
}

// The app's session has run out: Supabase Auth says 401, or 403 with error_code "bad_jwt".
export function sessionExpired({ status, data } = {}) {
  return status === 401 || (status === 403 && data?.error_code === 'bad_jwt');
}
