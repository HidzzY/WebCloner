import React, { useState, useMemo, useEffect } from 'react';
import JSZip from 'jszip';
import {
  Copy,
  Check,
  ExternalLink,
  FileCode,
  FileText,
  Image as ImageIcon,
  Globe,
  Search,
  Code2,
  Terminal,
  ArrowRight,
  RefreshCw,
  Eye,
  FileQuestion,
  HardDriveDownload,
  AlertCircle,
  X
} from 'lucide-react';

interface ExtractedFile {
  path: string;
  name: string;
  ext: string;
  size: number;
  type: string;
  isBinary: boolean;
  dataUrl?: string;
  content?: string;
  originalUrl?: string;
}

interface ExtractResult {
  creator: string;
  credits: string;
  status: boolean;
  targetUrl: string;
  domain: string;
  download?: string;
  totalFiles: number;
  totalSize: number;
  files: ExtractedFile[];
  engineUsed: 'remote' | 'native';
  error?: string;
}

function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [uploadRemote, setUploadRemote] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);

  // Inspector states
  const [selectedFile, setSelectedFile] = useState<ExtractedFile | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [fileFilter, setFileFilter] = useState<'all' | 'html' | 'css' | 'js' | 'image' | 'other'>('all');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [isZippingClient, setIsZippingClient] = useState(false);

  // WhatsApp Channel notification (auto-close in 5 seconds)
  const [showWaNotice, setShowWaNotice] = useState(true);
  const [countdown, setCountdown] = useState(5);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (!showWaNotice || isPaused) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setShowWaNotice(false);
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [showWaNotice, isPaused]);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
      }
    } catch {
      // ignore clipboard error
    }
  };

  const handleExtract = async (targetUrlToUse?: string) => {
    const target = (targetUrlToUse || url).trim();
    if (!target) {
      setError('Masukkan URL website yang ingin diklon');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setSelectedFile(null);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target, uploadRemote }),
      });

      const data = await res.json();
      if (!res.ok || !data.status) {
        throw new Error(data.error || 'Ekstraksi gagal diproses');
      }

      setResult(data);
      if (data.files && data.files.length > 0) {
        // default select index.html or first file
        const indexFile = data.files.find((f: ExtractedFile) => f.name === 'index.html') || data.files[0];
        setSelectedFile(indexFile);
      }
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat mengekstrak website.');
    } finally {
      setLoading(false);
    }
  };

  // Client-side ZIP generation & instant download
  const handleDownloadZipClient = async () => {
    if (!result || !result.files || result.files.length === 0) return;

    setIsZippingClient(true);
    try {
      const zip = new JSZip();

      for (const file of result.files) {
        const relPath = file.path || file.name || 'file.bin';
        if (file.isBinary && file.dataUrl) {
          const parts = file.dataUrl.split(',');
          const base64Data = parts[1] || '';
          zip.file(relPath, base64Data, { base64: true });
        } else if (file.content !== undefined) {
          zip.file(relPath, file.content);
        }
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const safeDomain = (result.domain || 'website').replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${safeDomain}_dump.zip`;

      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err: any) {
      alert('Gagal membuat file ZIP di browser: ' + err.message);
    } finally {
      setIsZippingClient(false);
    }
  };

  const handleCopyLink = () => {
    if (!result?.download) return;
    navigator.clipboard.writeText(result.download);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyCode = () => {
    if (!selectedFile?.content) return;
    navigator.clipboard.writeText(selectedFile.content);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Filter files
  const filteredFiles = useMemo(() => {
    if (!result?.files) return [];
    return result.files.filter((file) => {
      const ext = (file.ext || '').toLowerCase();
      let matchesFilter = true;

      if (fileFilter === 'html') matchesFilter = ext === 'html' || ext === 'htm';
      else if (fileFilter === 'css') matchesFilter = ext === 'css';
      else if (fileFilter === 'js') matchesFilter = ext === 'js' || ext === 'mjs' || ext === 'ts';
      else if (fileFilter === 'image') matchesFilter = ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'ico'].includes(ext) || file.type.startsWith('image/');
      else if (fileFilter === 'other') matchesFilter = !['html', 'htm', 'css', 'js', 'mjs', 'png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'ico'].includes(ext);

      if (!matchesFilter) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return file.path.toLowerCase().includes(q) || file.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [result?.files, fileFilter, searchQuery]);

  const getFileIcon = (file: ExtractedFile) => {
    const ext = (file.ext || '').toLowerCase();
    if (ext === 'html' || ext === 'htm') return <FileCode className="w-4 h-4 text-amber-400 shrink-0" />;
    if (ext === 'css') return <Code2 className="w-4 h-4 text-sky-400 shrink-0" />;
    if (ext === 'js' || ext === 'ts') return <Terminal className="w-4 h-4 text-yellow-300 shrink-0" />;
    if (['png', 'jpg', 'jpeg', 'svg', 'webp', 'ico'].includes(ext) || file.type.startsWith('image/')) {
      return <ImageIcon className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    return <FileText className="w-4 h-4 text-zinc-400 shrink-0" />;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-zinc-800 relative">
      {/* WhatsApp Channel Notification Toast (Auto-close in 5s) */}
      {showWaNotice && (
        <aside
          role="alert"
          aria-live="polite"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          className="fixed top-4 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-96 animate-in fade-in slide-in-from-top-4 duration-300"
        >
          <div className="relative overflow-hidden rounded-xl border border-emerald-500/30 bg-zinc-900/95 backdrop-blur-xl p-4 shadow-2xl shadow-emerald-950/40 text-zinc-100">
            {/* Subtle atmospheric glow */}
            <div className="absolute -top-10 -right-10 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-start gap-3 relative z-10">
              {/* WhatsApp Icon Badge */}
              <div className="w-9 h-9 rounded-lg bg-emerald-950/80 border border-emerald-500/40 flex items-center justify-center shrink-0 shadow-inner">
                <svg
                  className="w-4 h-4 text-emerald-400 fill-current"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              </div>

              {/* Notification Content */}
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-100">Saluran WhatsApp</span>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                    {countdown}s
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 leading-snug">
                  Gabung ke saluran WhatsApp kami untuk update fitur, tools, dan source code.
                </p>

                <div className="mt-2.5 flex items-center gap-2">
                  <a
                    href="https://whatsapp.com/channel/0029Vb82nkLEwEjtLSQ49I44"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors shadow-sm"
                  >
                    <span>Gabung Sekarang</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowWaNotice(false)}
                    className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
                  >
                    Tutup
                  </button>
                </div>
              </div>

              {/* Dismiss Button */}
              <button
                type="button"
                onClick={() => setShowWaNotice(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5"
                title="Tutup pemberitahuan"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Smooth 5-Second Countdown Progress Bar */}
            <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-zinc-800">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-1000 ease-linear"
                style={{ width: `${(countdown / 5) * 100}%` }}
              />
            </div>
          </div>
        </aside>
      )}

      {/* Top Bar Contract (3 zones) */}
      <header className="border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          {/* Zone 1: Wordmark */}
          <div className="flex items-center gap-2.5 shrink-0">
            <img
              src="https://cdn.zass.in/Xlzt4ocuYx.jpg"
              alt="Logo"
              referrerPolicy="no-referrer"
              className="w-7 h-7 rounded-md object-cover border border-zinc-800 shadow-sm"
            />
            <span className="font-semibold text-sm tracking-tight text-zinc-100 whitespace-nowrap">
              WebClone
            </span>
          </div>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => {
                setResult(null);
                setUrl('');
                setError(null);
              }}
              className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 transition-colors whitespace-nowrap"
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 flex flex-col gap-8" id="cloner">
        {/* Minimal Hero Header */}
        <section className="text-center max-w-2xl mx-auto space-y-3">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-100">
            Website Cloner & Asset Scraper
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Salin seluruh halaman web, struktur file, CSS, JavaScript, dan aset visual ke dalam format arsip ZIP.
          </p>
        </section>

        {/* URL Input Box */}
        <section className="max-w-2xl w-full mx-auto">
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-2.5 sm:p-3 shadow-2xl backdrop-blur-sm">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleExtract();
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <div className="relative flex-1 flex items-center">
                <Globe className="w-4 h-4 text-zinc-500 absolute left-3.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="https://example.com"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading}
                  className="w-full bg-zinc-950/70 border border-zinc-800/90 rounded-lg pl-10 pr-16 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={handlePaste}
                  title="Paste dari clipboard"
                  className="absolute right-2 px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800/80 hover:bg-zinc-700/80 rounded transition-colors"
                >
                  Paste
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="px-5 py-2.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 font-medium text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Mengekstrak...</span>
                  </>
                ) : (
                  <>
                    <span>Klon Website</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Quick config & preset strip */}
            <div className="mt-3 pt-3 border-t border-zinc-800/60 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-400">
              <label className="flex items-center gap-2 cursor-pointer select-none hover:text-zinc-300 transition-colors">
                <input
                  type="checkbox"
                  checked={uploadRemote}
                  onChange={(e) => setUploadRemote(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-950 text-zinc-200 focus:ring-0 w-3.5 h-3.5 accent-zinc-500"
                />
                <span>Generate URL Unduhan Publik (Tmpfiles / Catbox)</span>
              </label>

              {/* Sample test sites */}
              <div className="flex items-center gap-2 text-zinc-500">
                <span className="text-[11px]">Contoh:</span>
                <button
                  type="button"
                  onClick={() => {
                    setUrl('https://example.com');
                    handleExtract('https://example.com');
                  }}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 underline decoration-zinc-700 underline-offset-2"
                >
                  example.com
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => {
                    setUrl('https://motherfuckingwebsite.com');
                    handleExtract('https://motherfuckingwebsite.com');
                  }}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 underline decoration-zinc-700 underline-offset-2"
                >
                  motherfuckingwebsite
                </button>
              </div>
            </div>
          </div>

          {/* Error notice */}
          {error && (
            <div className="mt-4 p-3.5 rounded-lg bg-red-950/40 border border-red-900/50 flex items-start gap-3 text-xs text-red-200">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">Proses Ekstraksi Gagal</p>
                <p className="text-red-300/80">{error}</p>
              </div>
            </div>
          )}
        </section>

        {/* Loading state indicator */}
        {loading && (
          <section className="max-w-2xl mx-auto w-full py-10 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-10 h-10 border-2 border-zinc-800 border-t-zinc-300 rounded-full animate-spin" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-200">Mengambil konten dan dependensi situs...</p>
              <p className="text-xs text-zinc-500 font-mono">Parsing HTML, bundle stylesheet, script, dan aset media</p>
            </div>
          </section>
        )}

        {/* Result Area */}
        {result && (
          <section className="space-y-5 animate-in fade-in duration-200">
            {/* Summary KPI Strip */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold text-zinc-100 font-mono">{result.domain}</span>
                  <span className="text-xs text-zinc-500 font-mono">({result.engineUsed === 'remote' ? 'Remote API' : 'Direct Scraper'})</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  <span className="truncate max-w-xs sm:max-w-md">{result.targetUrl}</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums font-mono text-zinc-300">{result.totalFiles} file</span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums font-mono text-zinc-300">{formatBytes(result.totalSize)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleDownloadZipClient}
                  disabled={isZippingClient}
                  className="px-4 py-2 rounded-lg bg-zinc-100 hover:bg-white text-zinc-900 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {isZippingClient ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <HardDriveDownload className="w-3.5 h-3.5" />
                  )}
                  <span>Download ZIP ({formatBytes(result.totalSize)})</span>
                </button>

                {result.download && (
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="px-3.5 py-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
                    title="Salin tautan unduhan publik"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Tersalin</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Salin Link</span>
                      </>
                    )}
                  </button>
                )}

                {result.download && (
                  <a
                    href={result.download}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
                    title="Buka link unduhan eksternal"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>

            {/* File Explorer & Asset Inspector */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-[520px]">
              {/* Left Column: File Tree & Navigation (5 cols) */}
              <div className="lg:col-span-5 border-b lg:border-b-0 lg:border-r border-zinc-800 flex flex-col bg-zinc-950/60">
                {/* Search & Filter bar */}
                <div className="p-3 border-b border-zinc-800/80 space-y-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Cari file..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-md pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 font-mono"
                    />
                  </div>

                  {/* Filter segmented buttons */}
                  <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs no-scrollbar">
                    {(['all', 'html', 'css', 'js', 'image', 'other'] as const).map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setFileFilter(cat)}
                        className={`px-2.5 py-1 rounded text-[11px] font-medium uppercase tracking-wider transition-colors shrink-0 ${
                          fileFilter === cat
                            ? 'bg-zinc-200 text-zinc-950 font-semibold'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* File List */}
                <div className="flex-1 overflow-y-auto max-h-[440px] divide-y divide-zinc-900/70">
                  {filteredFiles.length === 0 ? (
                    <div className="p-8 text-center text-xs text-zinc-500">
                      Tidak ada file yang cocok dengan pencarian
                    </div>
                  ) : (
                    filteredFiles.map((file) => {
                      const isSelected = selectedFile?.path === file.path;
                      return (
                        <button
                          key={file.path}
                          onClick={() => setSelectedFile(file)}
                          className={`w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs transition-colors ${
                            isSelected
                              ? 'bg-zinc-800/90 text-zinc-100 border-l-2 border-zinc-200'
                              : 'text-zinc-400 hover:bg-zinc-900/50 hover:text-zinc-200'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 truncate min-w-0">
                            {getFileIcon(file)}
                            <span className="font-mono truncate">{file.path}</span>
                          </div>
                          <span className="text-[11px] font-mono text-zinc-500 shrink-0 tabular-nums">
                            {formatBytes(file.size)}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Code / Asset Viewer (7 cols) */}
              <div className="lg:col-span-7 flex flex-col bg-zinc-950">
                {selectedFile ? (
                  <>
                    {/* Viewer Header */}
                    <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between gap-3 bg-zinc-900/40">
                      <div className="flex items-center gap-2 truncate">
                        {getFileIcon(selectedFile)}
                        <span className="font-mono text-xs text-zinc-200 truncate">{selectedFile.path}</span>
                        <span className="text-[11px] text-zinc-500 font-mono tabular-nums">
                          ({formatBytes(selectedFile.size)})
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {selectedFile.content !== undefined && (
                          <button
                            type="button"
                            onClick={handleCopyCode}
                            className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded flex items-center gap-1 transition-colors"
                          >
                            {copiedCode ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400">Disalin</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Salin Kode</span>
                              </>
                            )}
                          </button>
                        )}
                        {selectedFile.originalUrl && (
                          <a
                            href={selectedFile.originalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors"
                            title="Buka file asli"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Viewer Body */}
                    <div className="flex-1 p-4 overflow-auto max-h-[460px] font-mono text-xs leading-relaxed text-zinc-300">
                      {selectedFile.isBinary ? (
                        selectedFile.dataUrl ? (
                          <div className="flex flex-col items-center justify-center p-6 gap-3">
                            <img
                              src={selectedFile.dataUrl}
                              alt={selectedFile.name}
                              className="max-h-64 max-w-full rounded border border-zinc-800 object-contain bg-zinc-900/50 p-2"
                            />
                            <p className="text-[11px] text-zinc-500">Preview Aset Biner ({selectedFile.type})</p>
                          </div>
                        ) : (
                          <div className="text-zinc-500 flex flex-col items-center justify-center py-16 gap-2">
                            <FileQuestion className="w-8 h-8 text-zinc-600" />
                            <p>File biner ({selectedFile.type}) tersimpan dalam arsip ZIP.</p>
                          </div>
                        )
                      ) : selectedFile.content !== undefined ? (
                        <pre className="whitespace-pre-wrap break-all select-text font-mono text-[12px] text-zinc-300">
                          {selectedFile.content}
                        </pre>
                      ) : (
                        <div className="text-zinc-500 text-center py-12">Konten file kosong</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-zinc-600 text-xs gap-2">
                    <Eye className="w-6 h-6 text-zinc-700" />
                    <p>Pilih file di sebelah kiri untuk melihat isi kode atau aset.</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Clean Footer (Dark & minimal, Credits @AlcaW44) */}
      <footer className="border-t border-zinc-800/80 bg-zinc-950 py-5 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-center text-xs text-zinc-500">
          <span>Credits @AlcaW44</span>
        </div>
      </footer>
    </div>
  );
}
