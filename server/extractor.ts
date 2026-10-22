import JSZip from 'jszip';
import * as cheerio from 'cheerio';

export interface ExtractedFile {
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

export interface ExtractResult {
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

const BASE_URL = 'https://copywebsitetarget.netlify.app';
const API_URL = `${BASE_URL}/api/extract`;
const FALLBACK_API_URL = `${BASE_URL}/.netlify/functions/extract`;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function uploadTmpfiles(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.set('file', new Blob([new Uint8Array(buffer)]), filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT },
      body: form,
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => null)) as {
      data?: { url?: string };
      message?: string;
    } | null;

    if (!res.ok || !data?.data?.url) {
      throw new Error(data?.message || `Tmpfiles upload failed status ${res.status}`);
    }

    // Try fetching page to extract direct dl link
    try {
      const pageRes = await fetch(data.data.url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      const pageHtml = await pageRes.text();
      const match = pageHtml.match(/href="([^"]*\/dl\/[^"]+)"/);
      if (match && match[1]) {
        return match[1];
      }
    } catch {
      // fallback to replacement
    }

    return data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadLitterbox(buffer: Buffer, filename: string): Promise<string> {
  const form = new FormData();
  form.set('reqtype', 'fileupload');
  form.set('time', '72h');
  form.set('fileToUpload', new Blob([new Uint8Array(buffer)]), filename);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      headers: { 'User-Agent': USER_AGENT },
      body: form,
      signal: controller.signal,
    });

    const text = await res.text();
    if (res.ok && /^https?:\/\//i.test(text.trim())) {
      return text.trim();
    }
    throw new Error(`Litterbox upload failed status ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function uploadZip(buffer: Buffer, filename: string): Promise<string | undefined> {
  try {
    return await uploadTmpfiles(buffer, filename);
  } catch {
    try {
      return await uploadLitterbox(buffer, filename);
    } catch (e) {
      console.warn('External zip hosting upload skipped:', e);
      return undefined;
    }
  }
}

export function normalizeTargetUrl(targetUrl: string): string {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('Target URL cannot be empty');
  }

  let normalized = targetUrl.trim();
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  // Validate URL structure
  new URL(normalized);
  return normalized;
}

// Remote extraction via copywebsitetarget Netlify API
async function extractViaRemote(normalizedUrl: string): Promise<{
  files: ExtractedFile[];
  domain: string;
  totalFiles: number;
  totalSize: number;
}> {
  const payload = JSON.stringify({ url: normalizedUrl });
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': USER_AGENT,
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);

  try {
    let response = await fetch(API_URL, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    });

    if (response.status === 404 || !response.ok) {
      response = await fetch(FALLBACK_API_URL, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });
    }

    const rawText = await response.text();
    let data: {
      success?: boolean;
      domain?: string;
      targetUrl?: string;
      totalFiles?: number;
      totalSize?: number;
      files?: Array<{
        path?: string;
        name?: string;
        ext?: string;
        size?: number;
        type?: string;
        isBinary?: boolean;
        dataUrl?: string;
        content?: string;
        originalUrl?: string;
      }>;
      error?: string;
      message?: string;
    };

    try {
      data = JSON.parse(rawText);
    } catch {
      throw new Error(`Invalid response from remote extractor (${response.status})`);
    }

    if (!response.ok || !data.success || !Array.isArray(data.files)) {
      throw new Error(data.error || data.message || `Remote extraction failed with status ${response.status}`);
    }

    const files: ExtractedFile[] = data.files.map((file) => {
      const fileName = file.name || file.path?.split('/').pop() || 'file.bin';
      const ext = file.ext || (fileName.includes('.') ? fileName.split('.').pop()! : 'bin');
      return {
        path: file.path || fileName,
        name: fileName,
        ext,
        size: typeof file.size === 'number' ? file.size : (file.content?.length || 0),
        type: file.type || 'text/plain',
        isBinary: Boolean(file.isBinary),
        dataUrl: file.dataUrl,
        content: file.content,
        originalUrl: file.originalUrl,
      };
    });

    const parsedUrl = new URL(normalizedUrl);
    const domain = data.domain || parsedUrl.hostname;
    const totalFiles = data.totalFiles || files.length;
    const totalSize = data.totalSize || files.reduce((acc, f) => acc + (f.size || 0), 0);

    return { files, domain, totalFiles, totalSize };
  } finally {
    clearTimeout(timeout);
  }
}

// Native direct fallback scraper using fetch + cheerio
async function extractViaNative(normalizedUrl: string): Promise<{
  files: ExtractedFile[];
  domain: string;
  totalFiles: number;
  totalSize: number;
}> {
  const targetParsed = new URL(normalizedUrl);
  const domain = targetParsed.hostname;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let htmlResponse: Response;
  try {
    htmlResponse = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!htmlResponse.ok) {
    throw new Error(`Failed to fetch target website (HTTP ${htmlResponse.status})`);
  }

  const rawHtml = await htmlResponse.text();
  const $ = cheerio.load(rawHtml);
  const files: ExtractedFile[] = [];

  // Collect resources
  interface ResourceItem {
    url: string;
    path: string;
    type: string;
    isBinary: boolean;
  }

  const resources: ResourceItem[] = [];
  const seenUrls = new Set<string>();

  const resolveUrl = (rel: string): string | null => {
    try {
      if (!rel || rel.startsWith('data:') || rel.startsWith('javascript:') || rel.startsWith('#')) {
        return null;
      }
      return new URL(rel, normalizedUrl).href;
    } catch {
      return null;
    }
  };

  // 1. Stylesheets
  $('link[rel="stylesheet"]').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const full = resolveUrl(href);
    if (full && !seenUrls.has(full)) {
      seenUrls.add(full);
      const filename = `css/style_${i + 1}.css`;
      $(el).attr('href', filename);
      resources.push({ url: full, path: filename, type: 'text/css', isBinary: false });
    }
  });

  // 2. Scripts
  $('script[src]').each((i, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const full = resolveUrl(src);
    if (full && !seenUrls.has(full)) {
      seenUrls.add(full);
      const filename = `js/script_${i + 1}.js`;
      $(el).attr('src', filename);
      resources.push({ url: full, path: filename, type: 'application/javascript', isBinary: false });
    }
  });

  // 3. Images (limit to first 30 images to keep response fast and under payload limit)
  let imgCount = 0;
  $('img[src]').each((_, el) => {
    if (imgCount >= 30) return;
    const src = $(el).attr('src');
    if (!src) return;
    const full = resolveUrl(src);
    if (full && !seenUrls.has(full)) {
      seenUrls.add(full);
      imgCount++;
      const ext = full.split('?')[0].split('.').pop() || 'png';
      const safeExt = /^[a-zA-Z0-9]{2,4}$/.test(ext) ? ext : 'png';
      const filename = `images/img_${imgCount}.${safeExt}`;
      $(el).attr('src', filename);
      resources.push({
        url: full,
        path: filename,
        type: `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
        isBinary: true,
      });
    }
  });

  // 4. Favicon
  $('link[rel*="icon"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const full = resolveUrl(href);
    if (full && !seenUrls.has(full)) {
      seenUrls.add(full);
      const filename = 'favicon.ico';
      $(el).attr('href', filename);
      resources.push({ url: full, path: filename, type: 'image/x-icon', isBinary: true });
    }
  });

  // Download resources concurrently with batching
  const BATCH_SIZE = 6;
  for (let i = 0; i < resources.length; i += BATCH_SIZE) {
    const chunk = resources.slice(i, i + BATCH_SIZE);
    await Promise.all(
      chunk.map(async (resItem) => {
        try {
          const res = await fetch(resItem.url, {
            headers: { 'User-Agent': USER_AGENT, Referer: normalizedUrl },
          });
          if (!res.ok) return;

          const arrayBuffer = await res.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const fileName = resItem.path.split('/').pop() || 'file';
          const ext = fileName.split('.').pop() || 'bin';

          if (resItem.isBinary) {
            const base64 = buffer.toString('base64');
            files.push({
              path: resItem.path,
              name: fileName,
              ext,
              size: buffer.length,
              type: resItem.type,
              isBinary: true,
              dataUrl: `data:${resItem.type};base64,${base64}`,
              originalUrl: resItem.url,
            });
          } else {
            const content = buffer.toString('utf-8');
            files.push({
              path: resItem.path,
              name: fileName,
              ext,
              size: Buffer.byteLength(content, 'utf-8'),
              type: resItem.type,
              isBinary: false,
              content,
              originalUrl: resItem.url,
            });
          }
        } catch (e) {
          console.warn(`Failed to fetch resource ${resItem.url}:`, e);
        }
      })
    );
  }

  // Modified HTML as index.html
  const processedHtml = $.html();
  const htmlBuffer = Buffer.from(processedHtml, 'utf-8');
  files.unshift({
    path: 'index.html',
    name: 'index.html',
    ext: 'html',
    size: htmlBuffer.length,
    type: 'text/html',
    isBinary: false,
    content: processedHtml,
    originalUrl: normalizedUrl,
  });

  const totalFiles = files.length;
  const totalSize = files.reduce((acc, f) => acc + (f.size || 0), 0);

  return { files, domain, totalFiles, totalSize };
}

export async function extractWebsite(
  targetUrl: string,
  options: { uploadZipFile?: boolean } = {}
): Promise<ExtractResult> {
  const normalizedUrl = normalizeTargetUrl(targetUrl);

  let extractedData: {
    files: ExtractedFile[];
    domain: string;
    totalFiles: number;
    totalSize: number;
  };
  let engineUsed: 'remote' | 'native' = 'remote';

  try {
    // Primary engine: Remote API
    extractedData = await extractViaRemote(normalizedUrl);
  } catch (remoteError) {
    console.warn('Remote extraction failed, switching to native fallback:', (remoteError as Error).message);
    try {
      extractedData = await extractViaNative(normalizedUrl);
      engineUsed = 'native';
    } catch (nativeError) {
      throw new Error(
        `Failed to clone website: ${
          (remoteError as Error).message || (nativeError as Error).message || 'Extraction failed'
        }`
      );
    }
  }

  const { files, domain, totalFiles, totalSize } = extractedData;

  // Build ZIP buffer
  const zip = new JSZip();
  for (const file of files) {
    const relPath = file.path || file.name || 'file.bin';
    if (file.isBinary && file.dataUrl) {
      const parts = file.dataUrl.split(',');
      const fileBuffer = Buffer.from(parts[1] || '', 'base64');
      zip.file(relPath, fileBuffer);
    } else if (file.content !== undefined) {
      zip.file(relPath, file.content);
    }
  }

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  let downloadUrl: string | undefined;
  if (options.uploadZipFile !== false) {
    const safeDomain = (domain || 'website').replace(/[^a-zA-Z0-9.-]/g, '_');
    const zipFileName = `${safeDomain}_dump.zip`;
    downloadUrl = await uploadZip(zipBuffer, zipFileName);
  }

  return {
    creator: 'IzzXd',
    credits: '@AlcaW44',
    status: true,
    targetUrl: normalizedUrl,
    domain,
    download: downloadUrl,
    totalFiles,
    totalSize,
    files,
    engineUsed,
  };
}
