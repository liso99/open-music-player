import { absoluteApiUrl, getApiBase } from './config.js';

async function request(url, options = {}) {
  const response = await fetch(`${getApiBase()}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `请求失败 (${response.status})`);
  }
  return data;
}

export function listPlugins() {
  return request('/api/plugins');
}

export function installPlugin(url, name) {
  return request('/api/plugins/install', {
    method: 'POST',
    body: JSON.stringify({ url, name }),
  });
}

export function importLocalPlugin(name, code) {
  return request('/api/plugins/local', {
    method: 'POST',
    body: JSON.stringify({ name, code }),
  });
}

export function deletePlugin(id) {
  return request(`/api/plugins/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function savePluginVariables(id, variables) {
  return request(`/api/plugins/${encodeURIComponent(id)}/variables`, {
    method: 'POST',
    body: JSON.stringify({ variables }),
  });
}

export function runPlugin(id, method, args = []) {
  return request(`/api/plugins/${encodeURIComponent(id)}/run`, {
    method: 'POST',
    body: JSON.stringify({ method, args }),
  }).then((data) => data.result);
}

export function resolveMedia(plugin, item, quality = 'standard') {
  return request('/api/resolve', {
    method: 'POST',
    body: JSON.stringify({ plugin, item, quality }),
  }).then((data) => ({ ...data, streamUrl: absoluteApiUrl(data.streamUrl) }));
}

export async function searchItunes(term, limit = 30) {
  const params = new URLSearchParams({
    term,
    media: 'music',
    entity: 'song',
    country: 'CN',
    limit: String(limit),
  });
  const response = await fetch(`https://itunes.apple.com/search?${params}`);
  if (!response.ok) throw new Error('Apple Music 试听源请求失败');
  const data = await response.json();
  return data.results || [];
}
