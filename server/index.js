import express from 'express';
import axios from 'axios';
import path from 'node:path';
import { existsSync, promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  evaluatePlugin,
  loadPluginFile,
  persistPlugin,
  pluginDir,
  summarizePlugin,
  makeStreamToken,
} from './plugin-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PLUGIN_DIR = pluginDir();
const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const plugins = new Map();
const streamCache = new Map();

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(PLUGIN_DIR, { recursive: true });

let userVariables = {};
let subscriptions = [];

try {
  userVariables = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'user-variables.json'), 'utf8'));
} catch {
  userVariables = {};
}

try {
  subscriptions = JSON.parse(await fs.readFile(path.join(DATA_DIR, 'subscriptions.json'), 'utf8'));
} catch {
  subscriptions = [];
}

async function saveUserVariables() {
  await fs.writeFile(path.join(DATA_DIR, 'user-variables.json'), JSON.stringify(userVariables, null, 2));
}

async function saveSubscriptions() {
  await fs.writeFile(path.join(DATA_DIR, 'subscriptions.json'), JSON.stringify(subscriptions, null, 2));
}

async function loadDiskPlugins() {
  const files = await fs.readdir(PLUGIN_DIR);
  for (const file of files) {
    if (!file.endsWith('.js')) continue;
    const id = file.slice(0, -3);
    try {
      const entry = await loadPluginFile(
        path.join(PLUGIN_DIR, file),
        id,
        userVariables[id] || {},
      );
      plugins.set(id, { ...entry, filePath: path.join(PLUGIN_DIR, file) });
    } catch (error) {
      console.error(`[plugin] 加载 ${id} 失败:`, error.message);
    }
  }
}

await loadDiskPlugins();

function sendError(res, error, status = 500) {
  console.error('[api]', error?.message || error);
  res.status(status).json({
    ok: false,
    message: error?.message || '服务端处理失败',
  });
}

function findPlugin(id) {
  const entry = plugins.get(id);
  if (!entry) {
    const error = new Error(`未安装插件: ${id}`);
    error.status = 404;
    throw error;
  }
  return entry;
}

function normalizeMediaResult(result) {
  if (typeof result === 'string') return { url: result, headers: {} };
  if (result && result.url) {
    return { url: result.url, headers: result.headers || {} };
  }
  throw new Error('插件没有返回可播放的地址');
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: Date.now(), plugins: plugins.size });
});

app.get('/api/plugins', (_req, res) => {
  const list = [...plugins.entries()].map(([id, entry]) =>
    summarizePlugin(id, entry.plugin),
  );
  res.json({ ok: true, plugins: list, subscriptions });
});

app.post('/api/plugins/install', async (req, res) => {
  const { url, name } = req.body || {};
  if (!/^https?:\/\//i.test(url || '')) return sendError(res, new Error('请输入 http(s) 插件地址'), 400);

  try {
    const parsed = new URL(url);
    const isSubscription = parsed.pathname.endsWith('.json');
    const response = await axios.get(url, {
      responseType: isSubscription ? 'json' : 'text',
      timeout: 30000,
      headers: { 'User-Agent': 'OpenMusicPlayer/0.1' },
    });

    if (isSubscription) {
      const items = Array.isArray(response.data) ? response.data : response.data?.plugins || [];
      subscriptions = [...subscriptions.filter((item) => item.url !== url), { url, name: name || parsed.host, createdAt: Date.now() }];
      await saveSubscriptions();
      return res.json({ ok: true, type: 'subscription', plugins: items, subscriptions });
    }

    const code = response.data;
    const requestedId = name || parsed.pathname.split('/').pop() || `plugin_${Date.now()}`;
    const { id, filePath } = await persistPlugin(code, requestedId);
    const entry = await loadPluginFile(filePath, id, userVariables[id] || {});
    plugins.set(id, { ...entry, filePath });
    res.json({ ok: true, plugin: summarizePlugin(id, entry.plugin) });
  } catch (error) {
    sendError(res, error, 400);
  }
});

app.post('/api/plugins/local', async (req, res) => {
  const { name, code } = req.body || {};
  if (!code) return sendError(res, new Error('请粘贴插件代码'), 400);
  try {
    const { id, filePath } = await persistPlugin(code, name);
    const entry = await loadPluginFile(filePath, id, userVariables[id] || {});
    plugins.set(id, { ...entry, filePath });
    res.json({ ok: true, plugin: summarizePlugin(id, entry.plugin) });
  } catch (error) {
    sendError(res, error, 400);
  }
});

app.delete('/api/plugins/:id', async (req, res) => {
  const { id } = req.params;
  const entry = plugins.get(id);
  if (!entry) return res.status(404).json({ ok: false, message: '插件不存在' });
  try {
    await fs.unlink(entry.filePath);
  } catch {
    // 文件可能已经不存在，继续清理内存。
  }
  plugins.delete(id);
  res.json({ ok: true });
});

app.post('/api/plugins/:id/variables', async (req, res) => {
  const { id } = req.params;
  const entry = plugins.get(id);
  if (!entry) return res.status(404).json({ ok: false, message: '插件不存在' });
  const variables = req.body?.variables || {};
  userVariables[id] = variables;
  Object.assign(entry.env.userVariables, variables);
  entry.env.setUserVariables?.(variables);
  await saveUserVariables();
  res.json({ ok: true });
});

app.post('/api/plugins/:id/run', async (req, res) => {
  const { id } = req.params;
  const { method, args } = req.body || {};
  try {
    const entry = findPlugin(id);
    const fn = entry.plugin?.[method];
    if (typeof fn !== 'function') {
      return res.status(422).json({ ok: false, message: `插件不支持 ${method}` });
    }
    const result = await fn(...(Array.isArray(args) ? args : []));
    res.json({ ok: true, result });
  } catch (error) {
    sendError(res, error, error.status || 500);
  }
});

app.post('/api/resolve', async (req, res) => {
  const { plugin: pluginId, item, quality } = req.body || {};
  try {
    const entry = findPlugin(pluginId);
    const fn = entry.plugin?.getMediaSource;
    if (typeof fn !== 'function') {
      return res.status(422).json({ ok: false, message: '该插件不支持播放' });
    }
    const result = await fn(item, quality || 'standard');
    const { url, headers } = normalizeMediaResult(result);
    const token = makeStreamToken();
    streamCache.set(token, {
      url,
      headers,
      pluginId,
      item,
      expires: Date.now() + 1000 * 60 * 60 * 6,
    });
    res.json({ ok: true, streamUrl: `/api/stream/${token}`, headers });
  } catch (error) {
    sendError(res, error, error.status || 502);
  }
});

app.get('/api/stream/:token', async (req, res) => {
  const entry = streamCache.get(req.params.token);
  if (!entry || entry.expires < Date.now()) {
    streamCache.delete(req.params.token);
    return res.status(404).json({ ok: false, message: '播放地址已失效' });
  }

  const range = req.headers.range;
  try {
    const upstream = await axios({
      method: 'get',
      url: entry.url,
      headers: {
        ...entry.headers,
        Range: range || undefined,
        Referer: entry.headers.Referer || entry.headers.referer || undefined,
      },
      responseType: 'stream',
      timeout: 0,
      maxRedirects: 6,
      validateStatus: () => true,
    });

    const status = upstream.status;
    if (status >= 400) {
      return res.status(status).json({ ok: false, message: '上游播放失败' });
    }

    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': upstream.headers['content-type'] || 'audio/mpeg',
    };
    if (status === 206) {
      if (upstream.headers['content-range']) headers['Content-Range'] = upstream.headers['content-range'];
      if (upstream.headers['content-length']) headers['Content-Length'] = upstream.headers['content-length'];
      res.status(206);
    } else {
      if (upstream.headers['content-length']) headers['Content-Length'] = upstream.headers['content-length'];
      res.status(200);
    }
    res.set(headers);
    upstream.data.pipe(res);
    req.on('close', () => upstream.data.destroy?.());
  } catch (error) {
    sendError(res, error, 502);
  }
});

const distPath = path.join(ROOT, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenMusic API 已启动: http://0.0.0.0:${PORT}`);
  console.log(`已加载 ${plugins.size} 个插件`);
});
