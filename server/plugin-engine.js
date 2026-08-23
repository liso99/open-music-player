import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);

const CORE_MODULES = new Set([
  'axios',
  'cheerio',
  'crypto-js',
  'he',
  'dayjs',
  'qs',
  'webdav',
]);

function safeId(value) {
  const base = String(value || 'plugin')
    .split(/[\\/]/)
    .pop()
    .replace(/\.js$/i, '')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return base || `plugin_${Date.now()}`;
}

function normalizeExports(raw) {
  if (!raw) return null;
  if (raw.default) {
    const def = raw.default;
    const looksLikePlugin =
      def &&
      typeof def === 'object' &&
      (def.platform || def.search || def.getMediaSource || def.supportedSearchType);
    if (looksLikePlugin) return def;
    if (typeof def === 'function') return def;
  }
  if (raw.platform || raw.search || raw.getMediaSource || raw.supportedSearchType) {
    return raw;
  }
  return raw;
}

export function evaluatePlugin(code, id, userVariables = {}) {
  const filename = `${id}.js`;
  const dirname = '.';
  const module = { exports: {} };

  const env = {
    platform: 'web',
    version: '0.1.0',
    userVariables,
    getUserVariables: () => userVariables,
    setUserVariables: (next) => {
      Object.assign(userVariables, next || {});
      return userVariables;
    },
  };

  const pluginRequire = (name) => {
    if (!CORE_MODULES.has(name)) {
      throw new Error(`插件尝试加载未授权的模块: ${name}`);
    }
    return require(name);
  };

  const runner = new Function(
    'module',
    'exports',
    'require',
    'env',
    '__filename',
    '__dirname',
    code,
  );

  runner(module, module.exports, pluginRequire, env, filename, dirname);
  return { plugin: normalizeExports(module.exports), env };
}

export async function loadPluginFile(filePath, id, userVariables = {}) {
  const code = await readFile(filePath, 'utf8');
  const { plugin, env } = evaluatePlugin(code, id, userVariables);
  if (!plugin || typeof plugin !== 'object') {
    throw new Error('插件没有导出有效对象');
  }
  return { plugin, env, code };
}

export async function persistPlugin(pluginCode, requestedId) {
  await mkdir(pluginDir(), { recursive: true });
  const id = safeId(requestedId);
  const filePath = path.join(pluginDir(), `${id}.js`);
  await writeFile(filePath, pluginCode, 'utf8');
  return { id, filePath };
}

export function pluginDir() {
  return path.resolve(process.cwd(), 'plugins');
}

export function makeStreamToken() {
  return crypto.randomBytes(16).toString('hex');
}

export function summarizePlugin(id, plugin) {
  return {
    id,
    platform: plugin.platform || id,
    version: plugin.version || '未知',
    author: plugin.author || '',
    description: plugin.description || '',
    srcUrl: plugin.srcUrl || '',
    supportedSearchType: plugin.supportedSearchType || ['music'],
    capabilities: {
      search: typeof plugin.search === 'function',
      media: typeof plugin.getMediaSource === 'function',
      lyric: typeof plugin.getLyric === 'function',
      topList: typeof plugin.getTopLists === 'function',
      topListDetail: typeof plugin.getTopListDetail === 'function',
      album: typeof plugin.getAlbumInfo === 'function' || typeof plugin.getAlbumDetail === 'function',
      playlist:
        typeof plugin.getPlaylistDetail === 'function' ||
        typeof plugin.getMusicSheetInfo === 'function',
    },
  };
}
