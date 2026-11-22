async function request(method, url, body) {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.codigo === 'SIN_SESION') window.dispatchEvent(new Event('cp:sin-sesion'));
  if (!res.ok) throw Object.assign(new Error(data.error || `Error ${res.status}`), { status: res.status, codigo: data.codigo });
  return data;
}
export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
};

export const fileToDataUrl = (file) =>
  new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = ko;
    r.readAsDataURL(file);
  });
