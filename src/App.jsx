import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Album,
  Check,
  ChevronDown,
  Compass,
  Copy,
  Download,
  Heart,
  Link2,
  ListMusic,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Save,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  deletePlugin,
  importLocalPlugin,
  installPlugin,
  listPlugins,
  resolveMedia,
  runPlugin,
  savePluginVariables,
  searchItunes,
} from './api.js';
import { getApiBase, setApiBase } from './config.js';
import { deleteDownload, listDownloads, saveDownload } from './downloadStore.js';
import './styles.css';

const ITUNES_ID = 'itunes';
const SEARCH_TYPES = [
  { value: 'music', label: '单曲' },
  { value: 'sheet', label: '歌单' },
  { value: 'album', label: '专辑' },
  { value: 'artist', label: '歌手' },
];

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function makeTrack(item, sourceId, sourceType = 'plugin') {
  const artwork =
    item.artwork || item.art || item.cover || item.album?.artwork || '';
  return {
    id: item.id ?? item.songmid ?? item.trackId ?? `${item.title}-${item.artist}`,
    title: item.title || item.name || '未知歌曲',
    artist: item.artist || item.singer || item.artistsName || '未知歌手',
    album: item.album || item.albumName || '',
    artwork,
    duration: item.duration || item.interval || 0,
    previewUrl: item.previewUrl || item.url || '',
    sourceType,
    plugin: sourceId,
    item,
  };
}

function makeItunesTrack(item) {
  return makeTrack(
    {
      id: item.trackId,
      title: item.trackName,
      artist: item.artistName,
      album: item.collectionName,
      artwork: item.artworkUrl100?.replace('100x100bb', '300x300bb') || item.artworkUrl100,
      duration: Math.round((item.trackTimeMillis || 0) / 1000),
      previewUrl: item.previewUrl,
    },
    ITUNES_ID,
    'itunes',
  );
}

function trackKey(track) {
  return `${track.plugin || 'itunes'}:${track.id}`;
}

function readFavorites() {
  try {
    return JSON.parse(localStorage.getItem('open-music-favorites') || '[]');
  } catch {
    return [];
  }
}

export default function App() {
  const [plugins, setPlugins] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [sourceId, setSourceId] = useState(ITUNES_ID);
  const [tab, setTab] = useState('search');

  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState('music');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchPage, setSearchPage] = useState(1);
  const [searchEnd, setSearchEnd] = useState(false);
  const [searchError, setSearchError] = useState('');

  const [topLists, setTopLists] = useState([]);
  const [topListTitle, setTopListTitle] = useState('');
  const [topListTracks, setTopListTracks] = useState(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState('');

  const [favorites, setFavorites] = useState(readFavorites);
  const [downloads, setDownloads] = useState([]);
  const [downloading, setDownloading] = useState({});

  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [current, setCurrent] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off');
  const [playerOpen, setPlayerOpen] = useState(false);
  const [playError, setPlayError] = useState('');

  const audioRef = useRef(null);

  const selectedSource = useMemo(() => {
    return plugins.find((plugin) => plugin.id === sourceId) || null;
  }, [plugins, sourceId]);

  const typeOptions = useMemo(() => {
    if (sourceId === ITUNES_ID) return SEARCH_TYPES.filter((type) => type.value === 'music');
    if (!selectedSource) return SEARCH_TYPES;
    const supported = selectedSource.supportedSearchType || ['music'];
    return SEARCH_TYPES.filter((type) => supported.includes(type.value));
  }, [sourceId, selectedSource]);

  async function refreshPlugins() {
    const data = await listPlugins().catch(() => ({ plugins: [], subscriptions: [] }));
    setPlugins(data.plugins || []);
    setSubscriptions(data.subscriptions || []);
  }

  useEffect(() => {
    refreshPlugins();
  }, []);

  useEffect(() => {
    localStorage.setItem('open-music-favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    listDownloads().then((items) => {
      setDownloads(items.map((item) => ({
        ...item.track,
        url: URL.createObjectURL(item.blob),
        sourceType: 'downloaded',
      })));
    }).catch(() => setDownloads([]));
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
  }, [volume, muted, audioRef.current]);

  useEffect(() => {
    if (tab === 'discover') loadTopLists();
    if (tab === 'search' && sourceId !== ITUNES_ID) setSearchType((current) =>
      typeOptions.some((item) => item.value === current) ? current : typeOptions[0]?.value || 'music',
    );
  }, [tab, sourceId]);

  function isFavorite(track) {
    return favorites.some((item) => trackKey(item) === trackKey(track));
  }

  function toggleFavorite(track) {
    setFavorites((prev) => {
      const exists = prev.some((item) => trackKey(item) === trackKey(track));
      if (exists) return prev.filter((item) => trackKey(item) !== trackKey(track));
      return [...prev, { ...track, favorite: true }];
    });
  }

  function isDownloaded(track) {
    return downloads.some((item) => trackKey(item) === trackKey(track));
  }

  async function downloadTrack(track) {
    const key = trackKey(track);
    if (downloading[key] || isDownloaded(track)) return;
    setDownloading((prev) => ({ ...prev, [key]: true }));
    try {
      let src = '';
      if (track.sourceType === 'itunes') {
        src = track.previewUrl;
      } else {
        const resolved = await resolveMedia(track.plugin, track.item, 'standard');
        src = resolved.streamUrl;
      }
      if (!src) throw new Error('没有可下载的地址');
      const response = await fetch(src);
      if (!response.ok) throw new Error('下载请求失败');
      const blob = await response.blob();
      const storedTrack = { ...track, sourceType: 'downloaded' };
      await saveDownload(key, storedTrack, blob);
      setDownloads((prev) => [
        { ...storedTrack, url: URL.createObjectURL(blob) },
        ...prev.filter((item) => trackKey(item) !== key),
      ]);
    } catch (error) {
      setPlayError(error.message);
    } finally {
      setDownloading((prev) => ({ ...prev, [key]: false }));
    }
  }

  async function removeDownload(track) {
    const key = trackKey(track);
    await deleteDownload(key);
    setDownloads((prev) => prev.filter((item) => trackKey(item) !== key));
  }

  function extensionFor(type) {
    if (type.includes('mpeg')) return 'mp3';
    if (type.includes('mp4') || type.includes('m4a')) return 'm4a';
    if (type.includes('aac')) return 'aac';
    if (type.includes('flac')) return 'flac';
    if (type.includes('ogg')) return 'ogg';
    if (type.includes('wav')) return 'wav';
    return 'mp3';
  }

  async function exportToFiles(track) {
    try {
      const response = await fetch(track.url);
      const blob = await response.blob();
      const type = blob.type || 'audio/mpeg';
      const filename = `${track.title} - ${track.artist}.${extensionFor(type)}`;
      const file = new File([blob], filename, { type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: track.title });
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setPlayError(error.message);
    }
  }

  async function performSearch(page = 1, append = false) {
    const keyword = query.trim();
    if (!keyword) return;
    setSearching(true);
    setSearchError('');
    try {
      if (sourceId === ITUNES_ID) {
        const raw = await searchItunes(keyword);
        const tracks = raw.map(makeItunesTrack);
        setResults(append ? [...results, ...tracks] : tracks);
        setSearchPage(page);
        setSearchEnd(true);
      } else {
        const result = await runPlugin(sourceId, 'search', [keyword, page, searchType]);
        const data = Array.isArray(result?.data) ? result.data : [];
        const tracks = data.map((item) => makeTrack(item, sourceId, 'plugin'));
        setResults(append ? [...results, ...tracks] : tracks);
        setSearchPage(page);
        setSearchEnd(Boolean(result?.isEnd));
      }
    } catch (error) {
      setSearchError(error.message);
    } finally {
      setSearching(false);
    }
  }

  function loadMore() {
    if (searching || searchEnd || sourceId === ITUNES_ID) return;
    performSearch(searchPage + 1, true);
  }

  async function loadTopLists() {
    if (sourceId === ITUNES_ID) {
      setTopLists([]);
      setTopListTracks(null);
      return;
    }
    setDiscoverLoading(true);
    setDiscoverError('');
    try {
      const result = await runPlugin(sourceId, 'getTopLists', []);
      setTopLists(Array.isArray(result) ? result : []);
      setTopListTracks(null);
    } catch (error) {
      setDiscoverError(error.message);
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function openTopList(groupTitle, item) {
    setDiscoverLoading(true);
    setDiscoverError('');
    try {
      const result = await runPlugin(sourceId, 'getTopListDetail', [item, 1]);
      const list = result?.musicList || result?.data || [];
      setTopListTitle(groupTitle || item.title);
      setTopListTracks(list.map((track) => makeTrack(track, sourceId, 'plugin')));
    } catch (error) {
      setDiscoverError(error.message);
    } finally {
      setDiscoverLoading(false);
    }
  }

  async function loadTrack(track) {
    const audio = audioRef.current;
    if (!audio) return;
    setPlayError('');
    setLoadingTrack(true);
    setProgress(0);
    setDuration(track.duration || 0);
    try {
      let src = '';
      const downloaded = downloads.find((item) => trackKey(item) === trackKey(track));
      if (track.sourceType === 'downloaded' || downloaded) {
        src = track.url || downloaded?.url || '';
      } else if (track.sourceType === 'itunes') {
        src = track.previewUrl;
      } else {
        const resolved = await resolveMedia(track.plugin, track.item, 'standard');
        src = resolved.streamUrl;
      }
      if (!src) throw new Error('没有可用的播放地址');
      audio.src = src;
      audio.load();
      await audio.play();
    } catch (error) {
      setPlayError(error.message);
      setIsPlaying(false);
    } finally {
      setLoadingTrack(false);
    }
  }

  function playList(list, startIndex = 0) {
    if (!list.length) return;
    const safeIndex = Math.max(0, Math.min(startIndex, list.length - 1));
    setQueue(list);
    setQueueIndex(safeIndex);
    const track = list[safeIndex];
    setCurrent(track);
    setPlayerOpen(false);
    loadTrack(track);
  }

  function playCurrent(index) {
    const track = queue[index];
    if (!track) return;
    setQueueIndex(index);
    setCurrent(track);
    loadTrack(track);
  }

  function step(delta) {
    if (!queue.length) return;
    const nextIndex = (queueIndex + delta + queue.length) % queue.length;
    playCurrent(nextIndex);
  }

  function playNext(auto = false) {
    if (!queue.length) return;
    if (repeat === 'one' && auto) {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play();
      }
      return;
    }
    if (shuffle) {
      let nextIndex = queueIndex;
      if (queue.length > 1) {
        while (nextIndex === queueIndex) nextIndex = Math.floor(Math.random() * queue.length);
      }
      playCurrent(nextIndex);
      return;
    }
    if (queueIndex < queue.length - 1) {
      playCurrent(queueIndex + 1);
    } else if (repeat === 'all') {
      playCurrent(0);
    } else {
      setIsPlaying(false);
      setProgress(0);
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !current) return;
    if (audio.paused) {
      audio.play().catch((error) => setPlayError(error.message));
    } else {
      audio.pause();
    }
  }

  function seek(seconds) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(seconds, audio.duration || 0));
    setProgress(audio.currentTime);
  }

  function cycleRepeat() {
    setRepeat((value) => (value === 'off' ? 'all' : value === 'all' ? 'one' : 'off'));
  }

  const currentFavorite = current ? isFavorite(current) : false;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Music size={19} /></span>
          <div className="brand-text">
            <strong>拾音</strong>
            <span>Open Music</span>
          </div>
        </div>
        <SourceSelect
          value={sourceId}
          plugins={plugins}
          onChange={(next) => {
            setSourceId(next);
            setResults([]);
            setTopLists([]);
            setTopListTracks(null);
          }}
        />
      </header>

      <main className="content">
        {tab === 'search' && (
          <SearchView
            query={query}
            setQuery={setQuery}
            searchType={searchType}
            setSearchType={setSearchType}
            typeOptions={typeOptions}
            results={results}
            searching={searching}
            searchError={searchError}
            searchEnd={searchEnd}
            current={current}
            isFavorite={isFavorite}
            toggleFavorite={toggleFavorite}
            isDownloaded={isDownloaded}
            downloading={downloading}
            onDownload={downloadTrack}
            onSearch={() => performSearch(1)}
            onLoadMore={loadMore}
            onPlay={(track, index) => playList(results, index)}
          />
        )}

        {tab === 'discover' && (
          <DiscoverView
            sourceId={sourceId}
            topLists={topLists}
            topListTitle={topListTitle}
            topListTracks={topListTracks}
            loading={discoverLoading}
            error={discoverError}
            current={current}
            isFavorite={isFavorite}
            toggleFavorite={toggleFavorite}
            isDownloaded={isDownloaded}
            downloading={downloading}
            onDownload={downloadTrack}
            onOpenTopList={openTopList}
            onBack={() => setTopListTracks(null)}
            onPlay={(track, index) => playList(topListTracks, index)}
          />
        )}

        {tab === 'favorites' && (
          <FavoritesView
            favorites={favorites}
            current={current}
            isFavorite={isFavorite}
            toggleFavorite={toggleFavorite}
            isDownloaded={isDownloaded}
            downloading={downloading}
            onDownload={downloadTrack}
            onPlay={(track, index) => playList(favorites, index)}
          />
        )}

        {tab === 'downloads' && (
          <DownloadsView
            downloads={downloads}
            current={current}
            isDownloaded={isDownloaded}
            onRemove={removeDownload}
            onExport={exportToFiles}
            onPlay={(track, index) => playList(downloads, index)}
          />
        )}

        {tab === 'settings' && (
          <SettingsView
            plugins={plugins}
            subscriptions={subscriptions}
            onRefresh={refreshPlugins}
          />
        )}
      </main>

      {current && (
        <MiniPlayer
          track={current}
          playing={isPlaying}
          loading={loadingTrack}
          onToggle={togglePlay}
          onOpen={() => setPlayerOpen(true)}
        />
      )}

      <nav className="tabbar">
        <TabButton active={tab === 'search'} icon={<Search size={20} />} label="搜索" onClick={() => setTab('search')} />
        <TabButton active={tab === 'discover'} icon={<Compass size={20} />} label="发现" onClick={() => setTab('discover')} />
        <TabButton active={tab === 'favorites'} icon={<Heart size={20} />} label="收藏" onClick={() => setTab('favorites')} />
        <TabButton active={tab === 'downloads'} icon={<Download size={20} />} label="下载" onClick={() => setTab('downloads')} />
        <TabButton active={tab === 'settings'} icon={<Settings size={20} />} label="设置" onClick={() => setTab('settings')} />
      </nav>

      <audio
        ref={audioRef}
        preload="auto"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(event) => setProgress(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onEnded={() => playNext(true)}
        onError={() => setPlayError('音频加载失败')}
      />

      {playerOpen && current && (
        <PlayerOverlay
          track={current}
          queue={queue}
          queueIndex={queueIndex}
          playing={isPlaying}
          loading={loadingTrack}
          progress={progress}
          duration={duration}
          volume={volume}
          muted={muted}
          shuffle={shuffle}
          repeat={repeat}
          favorite={currentFavorite}
          downloaded={current ? isDownloaded(current) : false}
          downloading={current ? downloading[trackKey(current)] : false}
          error={playError}
          onClose={() => setPlayerOpen(false)}
          onToggle={togglePlay}
          onPrev={() => step(-1)}
          onNext={() => playNext(false)}
          onSeek={seek}
          onVolume={setVolume}
          onMute={() => setMuted(!muted)}
          onShuffle={() => setShuffle(!shuffle)}
          onRepeat={cycleRepeat}
          onFavorite={() => current && toggleFavorite(current)}
          onDownload={() => current && downloadTrack(current)}
          onPlayIndex={playCurrent}
          isFavorite={isFavorite}
        />
      )}
    </div>
  );
}

function SourceSelect({ value, plugins, onChange }) {
  const [open, setOpen] = useState(false);
  const currentLabel = value === ITUNES_ID ? 'Apple Music 试听' : plugins.find((item) => item.id === value)?.platform || '选择音源';
  return (
    <div className="source-select">
      <button className="source-trigger" onClick={() => setOpen(!open)}>
        <span>{currentLabel}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="source-menu" onMouseLeave={() => setOpen(false)}>
          <button
            className={value === ITUNES_ID ? 'active' : ''}
            onClick={() => { onChange(ITUNES_ID); setOpen(false); }}
          >
            <span>Apple Music 试听</span>
            <span className="source-tag">内置</span>
          </button>
          {plugins.map((plugin) => (
            <button
              key={plugin.id}
              className={value === plugin.id ? 'active' : ''}
              onClick={() => { onChange(plugin.id); setOpen(false); }}
            >
              <span>{plugin.platform || plugin.id}</span>
              <span className="source-tag">插件</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, icon, label, onClick }) {
  return (
    <button className={`tab-button ${active ? 'active' : ''}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SearchView(props) {
  const {
    query,
    setQuery,
    searchType,
    setSearchType,
    typeOptions,
    results,
    searching,
    searchError,
    searchEnd,
    current,
    isFavorite,
    toggleFavorite,
    isDownloaded,
    downloading,
    onDownload,
    onSearch,
    onLoadMore,
    onPlay,
  } = props;

  return (
    <section className="view">
      <div className="search-box">
        <Search size={18} />
        <input
          value={query}
          placeholder="搜索歌曲"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && onSearch()}
        />
        {query && <button className="clear-button" onClick={() => setQuery('')}><X size={16} /></button>}
        <button className="primary-button compact" onClick={onSearch}>搜索</button>
      </div>

      {typeOptions.length > 1 && (
        <div className="segmented">
          {typeOptions.map((type) => (
            <button
              key={type.value}
              className={searchType === type.value ? 'active' : ''}
              onClick={() => {
                setSearchType(type.value);
                if (query.trim()) onSearch();
              }}
            >
              {type.label}
            </button>
          ))}
        </div>
      )}

      {searching && results.length === 0 ? (
        <Loading label="正在搜索" />
      ) : searchError ? (
        <Empty icon={<X size={22} />} title="搜索失败" text={searchError} />
      ) : results.length === 0 ? (
        <Empty icon={<Music size={24} />} title="输入关键词开始找歌" text="支持插件音源与 Apple Music 试听" />
      ) : (
        <>
          <TrackList
            tracks={results}
            current={current}
            isFavorite={isFavorite}
            onFavorite={toggleFavorite}
            isDownloaded={isDownloaded}
            downloading={downloading}
            onDownload={onDownload}
            onPlay={onPlay}
          />
          {!searchEnd && (
            <button className="load-more" onClick={onLoadMore} disabled={searching}>
              {searching ? <Loader2 className="spin" size={16} /> : '加载更多'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function DiscoverView(props) {
  const {
    sourceId,
    topLists,
    topListTitle,
    topListTracks,
    loading,
    error,
    current,
    isFavorite,
    toggleFavorite,
    isDownloaded,
    downloading,
    onDownload,
    onOpenTopList,
    onBack,
    onPlay,
  } = props;

  if (topListTracks) {
    return (
      <section className="view">
        <div className="section-head">
          <button className="icon-button" onClick={onBack}><ChevronDown size={19} /></button>
          <h1>{topListTitle}</h1>
        </div>
        <TrackList
          tracks={topListTracks}
          current={current}
          isFavorite={isFavorite}
          onFavorite={toggleFavorite}
          isDownloaded={isDownloaded}
          downloading={downloading}
          onDownload={onDownload}
          onPlay={onPlay}
        />
      </section>
    );
  }

  return (
    <section className="view">
      <div className="section-head">
        <h1>发现</h1>
      </div>
      {sourceId === ITUNES_ID ? (
        <Empty
          icon={<Compass size={24} />}
          title="安装插件后浏览榜单"
          text="在设置中粘贴 MusicFree 插件地址或订阅地址"
        />
      ) : loading ? (
        <Loading label="正在加载榜单" />
      ) : error ? (
        <Empty icon={<X size={22} />} title="榜单加载失败" text={error} />
      ) : (
        <div className="toplist-groups">
          {topLists.map((group, groupIndex) => (
            <div className="toplist-group" key={`${group.title}-${groupIndex}`}>
              <h2>{group.title}</h2>
              <div className="toplist-grid">
                {(group.data || []).map((item, itemIndex) => (
                  <button
                    className="toplist-card"
                    key={item.id || `${item.title}-${itemIndex}`}
                    onClick={() => onOpenTopList(group.title, item)}
                  >
                    {item.artwork || item.cover ? (
                      <img src={item.artwork || item.cover} alt="" />
                    ) : (
                      <span className="toplist-placeholder"><Album size={24} /></span>
                    )}
                    <span className="toplist-name">{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FavoritesView(props) {
  const {
    favorites,
    current,
    isFavorite,
    toggleFavorite,
    isDownloaded,
    downloading,
    onDownload,
    onPlay,
  } = props;
  return (
    <section className="view">
      <div className="section-head">
        <h1>收藏</h1>
        {favorites.length > 0 && <span className="count">{favorites.length} 首</span>}
      </div>
      {favorites.length === 0 ? (
        <Empty icon={<Heart size={24} />} title="还没有收藏" text="点歌曲旁边的心形按钮收藏到本机" />
      ) : (
        <TrackList
          tracks={favorites}
          current={current}
          isFavorite={isFavorite}
          onFavorite={toggleFavorite}
          isDownloaded={isDownloaded}
          downloading={downloading}
          onDownload={onDownload}
          onPlay={onPlay}
        />
      )}
    </section>
  );
}

function DownloadsView({ downloads, current, isDownloaded, onRemove, onExport, onPlay }) {
  return (
    <section className="view">
      <div className="section-head">
        <h1>下载</h1>
        {downloads.length > 0 && <span className="count">{downloads.length} 首</span>}
      </div>
      {downloads.length === 0 ? (
        <Empty icon={<Download size={24} />} title="还没有下载" text="在歌曲列表点下载按钮即可保存到本机" />
      ) : (
        <div className="download-list">
          {downloads.map((track, index) => (
            <div
              className={`download-row ${current && trackKey(current) === trackKey(track) ? 'active' : ''}`}
              key={`${trackKey(track)}-${index}`}
              onClick={() => onPlay(track, index)}
            >
              <div className="track-index">
                {current && trackKey(current) === trackKey(track) ? <Music size={16} className="equalizer" /> : index + 1}
              </div>
              <div className="track-art">
                {track.artwork ? <img src={track.artwork} alt="" /> : <span><Music size={18} /></span>}
              </div>
              <div className="track-main">
                <div className="track-title">{track.title}</div>
                <div className="track-sub">{track.artist}{track.album ? ` · ${track.album}` : ''}</div>
              </div>
              <button
                className="download-export"
                onClick={(event) => {
                  event.stopPropagation();
                  onExport(track);
                }}
              >
                <Save size={16} />
                <span>保存到文件</span>
              </button>
              <button
                className="icon-button danger"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(track);
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsView({ plugins, subscriptions, onRefresh }) {
  const [backendUrl, setBackendUrl] = useState(getApiBase);
  const [url, setUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [importing, setImporting] = useState(false);
  const [variablesFor, setVariablesFor] = useState(null);
  const [variablesDraft, setVariablesDraft] = useState('');

  async function handleInstall() {
    if (!url.trim()) return;
    setInstalling(true);
    setMessage('');
    try {
      const result = await installPlugin(url.trim());
      setMessage(result.type === 'subscription' ? `已读取订阅，包含 ${result.plugins.length} 个插件` : `已安装 ${result.plugin.platform}`);
      setUrl('');
      await onRefresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setInstalling(false);
    }
  }

  async function handleImport() {
    if (!code.trim()) return;
    setImporting(true);
    setMessage('');
    try {
      const result = await importLocalPlugin(name.trim(), code);
      setMessage(`已安装 ${result.plugin.platform}`);
      setName('');
      setCode('');
      await onRefresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(id) {
    await deletePlugin(id);
    await onRefresh();
  }

  async function openVariables(plugin) {
    setVariablesFor(plugin.id);
    setVariablesDraft(JSON.stringify(plugin.variables || {}, null, 2));
  }

  async function saveVariables() {
    try {
      const variables = JSON.parse(variablesDraft || '{}');
      await savePluginVariables(variablesFor, variables);
      setVariablesFor(null);
      setMessage('变量已保存');
      await onRefresh();
    } catch (error) {
      setMessage(`JSON 格式错误: ${error.message}`);
    }
  }

  async function saveBackend() {
    setApiBase(backendUrl);
    setMessage('服务地址已保存');
  }

  return (
    <section className="view settings">
      <div className="section-head"><h1>设置</h1></div>

      <div className="settings-card">
        <div className="settings-card-title">
          <Link2 size={17} />
          <span>后端服务地址</span>
        </div>
        <p className="muted">原生 App 内运行插件需要连接后端；本机调试可留空。</p>
        <div className="input-row">
          <input
            value={backendUrl}
            onChange={(event) => setBackendUrl(event.target.value)}
            placeholder="https://example.com"
          />
          <button className="primary-button" onClick={saveBackend}>保存</button>
        </div>
      </div>

      <div className="settings-card">
        <div className="settings-card-title">
          <Link2 size={17} />
          <span>添加插件</span>
        </div>
        <p className="muted">粘贴 MusicFree 插件 .js 地址，或 plugins.json 订阅地址。</p>
        <div className="input-row">
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." />
          <button className="primary-button" onClick={handleInstall} disabled={installing}>
            {installing ? <Loader2 className="spin" size={16} /> : <Plus size={16} />} 安装
          </button>
        </div>
        {subscriptions.length > 0 && (
          <div className="subscription-list">
            {subscriptions.map((sub) => (
              <div className="subscription-item" key={sub.url}>
                <span>{sub.name || sub.url}</span>
                <button className="icon-button" onClick={() => navigator.clipboard?.writeText(sub.url)}><Copy size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-card">
        <div className="settings-card-title">
          <Upload size={17} />
          <span>本地导入插件</span>
        </div>
        <input className="text-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="插件名称（可选）" />
        <textarea value={code} onChange={(event) => setCode(event.target.value)} placeholder="粘贴插件 JavaScript 代码" rows={5} />
        <button className="secondary-button" onClick={handleImport} disabled={importing}>
          {importing ? <Loader2 className="spin" size={16} /> : '导入插件'}
        </button>
      </div>

      <div className="settings-card">
        <div className="settings-card-title">
          <ListMusic size={17} />
          <span>已安装插件</span>
          <span className="count">{plugins.length}</span>
        </div>
        {plugins.length === 0 ? (
          <p className="muted">还没有安装插件。Apple Music 试听源可直接使用。</p>
        ) : (
          <div className="plugin-list">
            {plugins.map((plugin) => (
              <div className="plugin-item" key={plugin.id}>
                <div className="plugin-info">
                  <strong>{plugin.platform || plugin.id}</strong>
                  <span>{plugin.author ? `${plugin.author} · ` : ''}v{plugin.version}</span>
                </div>
                <div className="plugin-actions">
                  <button className="icon-button" onClick={() => openVariables(plugin)}><Settings size={16} /></button>
                  <button className="icon-button danger" onClick={() => handleDelete(plugin.id)}><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {variablesFor && (
        <div className="modal-backdrop" onClick={() => setVariablesFor(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>插件变量</h2>
              <button className="icon-button" onClick={() => setVariablesFor(null)}><X size={18} /></button>
            </div>
            <textarea value={variablesDraft} onChange={(event) => setVariablesDraft(event.target.value)} rows={10} />
            <button className="primary-button" onClick={saveVariables}><Check size={16} /> 保存</button>
          </div>
        </div>
      )}

      {message && <p className="feedback">{message}</p>}
    </section>
  );
}

function TrackList({
  tracks,
  current,
  isFavorite,
  onFavorite,
  isDownloaded,
  downloading,
  onDownload,
  onPlay,
}) {
  return (
    <div className="track-list">
      {tracks.map((track, index) => {
        const active = current && trackKey(current) === trackKey(track);
        return (
          <div
            className={`track-row ${active ? 'active' : ''}`}
            key={`${trackKey(track)}-${index}`}
            onClick={() => onPlay(track, index)}
          >
            <div className="track-index">
              {active ? <Music size={16} className="equalizer" /> : index + 1}
            </div>
            <div className="track-art">
              {track.artwork ? <img src={track.artwork} alt="" /> : <span><Music size={18} /></span>}
            </div>
            <div className="track-main">
              <div className="track-title">{track.title}</div>
              <div className="track-sub">{track.artist}{track.album ? ` · ${track.album}` : ''}</div>
            </div>
            <div className="track-meta">
              {track.duration ? formatTime(track.duration) : ''}
            </div>
            <button
              className={`download-button ${isDownloaded(track) ? 'downloaded' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                onDownload(track);
              }}
              title={isDownloaded(track) ? '已下载' : '下载'}
            >
              {downloading[trackKey(track)] ? (
                <Loader2 className="spin" size={16} />
              ) : isDownloaded(track) ? (
                <Check size={16} />
              ) : (
                <Download size={16} />
              )}
            </button>
            <button
              className={`favorite-button ${isFavorite(track) ? 'active' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                onFavorite(track);
              }}
            >
              <Heart size={17} fill={isFavorite(track) ? 'currentColor' : 'none'} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MiniPlayer({ track, playing, loading, onToggle, onOpen }) {
  return (
    <div className="mini-player" onClick={onOpen}>
      <div className="mini-art">
        {track.artwork ? <img src={track.artwork} alt="" /> : <span><Music size={19} /></span>}
      </div>
      <div className="mini-text">
        <div className="mini-title">{track.title}</div>
        <div className="mini-sub">{track.artist}</div>
      </div>
      <button className="mini-play" onClick={(event) => { event.stopPropagation(); onToggle(); }}>
        {loading ? <Loader2 className="spin" size={21} /> : playing ? <Pause size={21} /> : <Play size={21} />}
      </button>
    </div>
  );
}

function PlayerOverlay(props) {
  const {
    track,
    queue,
    queueIndex,
    playing,
    loading,
    progress,
    duration,
    volume,
    muted,
    shuffle,
    repeat,
    favorite,
    downloaded,
    downloading,
    error,
    onClose,
    onToggle,
    onPrev,
    onNext,
    onSeek,
    onVolume,
    onMute,
    onShuffle,
    onRepeat,
    onFavorite,
    onDownload,
    onPlayIndex,
    isFavorite,
  } = props;

  const currentDuration = duration || track.duration || 0;

  return (
    <div className="player-overlay">
      <div className="player-top">
        <button className="icon-button" onClick={onClose}><ChevronDown size={22} /></button>
        <div className="player-context"><span>正在播放</span><strong>{queueIndex + 1}/{queue.length}</strong></div>
        <div className="player-actions">
          <button className="icon-button" onClick={onDownload} title={downloaded ? '已下载' : '下载'}>
            {downloading ? <Loader2 className="spin" size={18} /> : downloaded ? <Check size={18} /> : <Download size={18} />}
          </button>
          <button className="icon-button" onClick={onFavorite}><Heart size={20} fill={favorite ? 'currentColor' : 'none'} /></button>
        </div>
      </div>

      <div className="player-artwork">
        {track.artwork ? <img src={track.artwork} alt="" /> : <span className="art-fallback"><Music size={64} /></span>}
      </div>

      <div className="player-now">
        <h1>{track.title}</h1>
        <p>{track.artist}</p>
      </div>

      <div className="player-progress">
        <input
          type="range"
          min="0"
          max={currentDuration || 1}
          step="1"
          value={progress}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <div className="progress-time">
          <span>{formatTime(progress)}</span>
          <span>{formatTime(currentDuration)}</span>
        </div>
      </div>

      <div className="player-controls">
        <button className={`mode-button ${shuffle ? 'active' : ''}`} onClick={onShuffle}><Shuffle size={19} /></button>
        <button className="skip-button" onClick={onPrev}><SkipBack size={28} /></button>
        <button className="play-button" onClick={onToggle} disabled={loading}>
          {loading ? <Loader2 className="spin" size={30} /> : playing ? <Pause size={30} /> : <Play size={30} />}
        </button>
        <button className="skip-button" onClick={onNext}><SkipForward size={28} /></button>
        <button className={`mode-button ${repeat !== 'off' ? 'active' : ''}`} onClick={onRepeat}>
          {repeat === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}
        </button>
      </div>

      <div className="volume-row">
        <button className="mode-button" onClick={onMute}>{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} onChange={(event) => onVolume(Number(event.target.value))} />
      </div>

      {error && <p className="player-error">{error}</p>}

      <div className="queue-list">
        <div className="queue-title">播放队列</div>
        {queue.map((item, index) => (
          <button
            key={`${trackKey(item)}-${index}`}
            className={`queue-row ${index === queueIndex ? 'active' : ''}`}
            onClick={() => onPlayIndex(index)}
          >
            <span className="queue-index">{index === queueIndex ? <Music size={14} className="equalizer" /> : index + 1}</span>
            <span className="queue-art">{item.artwork ? <img src={item.artwork} alt="" /> : <Music size={15} />}</span>
            <span className="queue-text"><strong>{item.title}</strong><small>{item.artist}</small></span>
            {isFavorite(item) && <Heart size={14} fill="currentColor" className="queue-fav" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function Loading({ label }) {
  return (
    <div className="loading">
      <Loader2 className="spin" size={24} />
      <span>{label}</span>
    </div>
  );
}

function Empty({ icon, title, text }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
