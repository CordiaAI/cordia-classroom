// Tool results: structured content plus the same data as compact JSON text, capped at about
// 20,000 characters; errors as tool results with isError.
export const MAX_CHARS = 20000;

export function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

// code: a short reason for the audit log (never the message itself): not_found, invalid_input,
// limit_reached, rate_limited, unavailable, tool_error.
const codes = new WeakMap();

export function failure(message, code = 'tool_error') {
  const result = { content: [{ type: 'text', text: message }], isError: true };
  codes.set(result, code);
  return result;
}

export function errorCode(result) {
  return codes.get(result) || 'tool_error';
}

// The same answer whether the item doesn't exist or belongs to someone else (RLS hides both).
export const notFound = what => failure(`No ${what} with that id in your Cordia account. Use the list or search tools to find the right id.`, 'not_found');
export const unavailable = what => failure(`Cordia couldn't read your ${what} right now. Try again in a moment.`, 'unavailable');

// Keeps as many items as fit: build(items) makes the result; items are dropped from the end until
// its JSON is within MAX_CHARS. Returns { data, kept }.
export function fitItems(items, build) {
  let low = 0;
  let high = items.length;
  if (JSON.stringify(build(items)).length <= MAX_CHARS) return { data: build(items), kept: items.length };
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(build(items.slice(0, middle))).length <= MAX_CHARS) low = middle;
    else high = middle - 1;
  }
  return { data: build(items.slice(0, low)), kept: low };
}

export function clip(text, max) {
  const value = String(text ?? '').replace(/\[IMG:[^\]]*\]/g, '').trim();
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
}

// Opaque paging cursors: { o: offset, ...state } as base64url JSON.
export function encodeCursor(state) {
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

export function decodeCursor(cursor) {
  if (!cursor) return { o: 0 };
  try {
    const state = JSON.parse(Buffer.from(String(cursor), 'base64url').toString());
    return state && Number.isInteger(state.o) && state.o >= 0 && state.o < 100000 ? state : null;
  } catch {
    return null;
  }
}
