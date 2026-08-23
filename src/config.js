const STORAGE_KEY = 'open-music-api-base';

export function getApiBase() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return saved.replace(/\/+$/, '');
  const env = import.meta.env.VITE_API_BASE_URL;
  if (env) return env.replace(/\/+$/, '');
  return '';
}

export function setApiBase(value) {
  const clean = String(value || '').trim().replace(/\/+$/, '');
  if (clean) {
    localStorage.setItem(STORAGE_KEY, clean);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  return getApiBase();
}

export function absoluteApiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getApiBase();
  if (base) return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  return path;
}
