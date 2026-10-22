import type { Request, Response } from 'express';
import { extractWebsite } from '../server/extractor.ts';

export default async function handler(req: Request, res: Response) {
  // Enable CORS for Vercel deployment
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const { url, uploadRemote = true } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({
        status: false,
        error: 'URL target tidak boleh kosong (Target URL is required)',
      });
    }

    const result = await extractWebsite(url, { uploadZipFile: uploadRemote });
    return res.status(200).json(result);
  } catch (err: any) {
    console.error('Vercel API extract error:', err);
    return res.status(500).json({
      creator: 'IzzXd',
      credits: '@AlcaW44',
      status: false,
      error: err.message || 'Gagal mengekstrak website',
    });
  }
}
