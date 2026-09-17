const BASE_URL = process.env.JIMINNY_BASE_URL || "https://app.jiminny.com/customer/api/v1";
const API_TOKEN = process.env.JIMINNY_API_TOKEN;

if (!API_TOKEN) {
  throw new Error("JIMINNY_API_TOKEN environment variable is required");
}

function buildQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

export async function jiminnyGet(path, params) {
  const url = `${BASE_URL}${path}${buildQuery(params)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      Accept: "application/json",
    },
  });

  if (res.status === 204) return { data: null, note: "No content available." };
  if (res.status === 404) {
    const body = await res.text();
    return { error: true, status: 404, body };
  }

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    return { error: true, status: res.status, body };
  }

  return { data: body };
}
