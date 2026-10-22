import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import { extractWebsite, normalizeTargetUrl } from './server/extractor.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Extract Endpoint
  app.post('/api/extract', async (req, res) => {
    try {
      const { url, uploadRemote = true } = req.body;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({
          status: false,
          error: 'URL target tidak boleh kosong (Target URL is required)',
        });
      }

      const result = await extractWebsite(url, { uploadZipFile: uploadRemote });
      return res.json(result);
    } catch (err: any) {
      console.error('Error in /api/extract:', err);
      return res.status(500).json({
        creator: 'IzzXd',
        credits: '@AlcaW44',
        status: false,
        error: err.message || 'Gagal mengekstrak website',
      });
    }
  });

  // Direct ZIP download endpoint (generates zip buffer and streams directly to client)
  app.post('/api/download-zip', async (req, res) => {
    try {
      const { url, files } = req.body;

      let fileList = files;
      let domainName = 'website';

      if (!fileList || !Array.isArray(fileList)) {
        if (!url) {
          return res.status(400).json({ error: 'URL or files array required' });
        }
        const extractResult = await extractWebsite(url, { uploadZipFile: false });
        fileList = extractResult.files;
        domainName = extractResult.domain;
      } else if (url) {
        try {
          domainName = new URL(normalizeTargetUrl(url)).hostname;
        } catch {
          domainName = 'website';
        }
      }

      const zip = new JSZip();
      for (const file of fileList) {
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

      const safeDomain = domainName.replace(/[^a-zA-Z0-9.-]/g, '_');
      const filename = `${safeDomain}_dump.zip`;

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', zipBuffer.length);
      return res.send(zipBuffer);
    } catch (err: any) {
      console.error('Error in /api/download-zip:', err);
      return res.status(500).json({ error: err.message || 'Failed to generate zip' });
    }
  });

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', credits: '@AlcaW44', service: 'WebClone API' });
  });

  // Vite middleware in dev or static serve in prod
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WebClone Server running at http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
