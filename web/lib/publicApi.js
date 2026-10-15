const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// For signed-out pages (instructor opt-out, copyright): no session, optional bearer token.
export async function publicFetch(path, { token, ...options } = {}) {
  try {
    const response = await fetch(API + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers },
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { detail: 'Cordia could not be reached.' } };
  }
}
