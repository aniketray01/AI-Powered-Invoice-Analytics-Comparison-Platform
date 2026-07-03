const EMBEDDING_MODEL = 'text-embedding-3-small';

// In-memory cache (per tab). Key should be stable for the currently loaded invoice.
// { chunks: [{ id, text, meta }], vectors: number[][], ready: boolean }
const ragIndexCache = new Map();

const cosineSim = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
};

const normalizeText = (s) => (s || '').toString().toLowerCase();

const inferColumnKey = (rows, predicate) => {
  if (!rows?.length) return null;
  const keys = Object.keys(rows[0] || {});
  return keys.find((k) => predicate(normalizeText(k))) || null;
};

const makeProjector = (rows) => {
  const siteKey =
    inferColumnKey(rows, (k) => (k.includes('site') && k.includes('id')) || k.includes('site code') || k.includes('identity')) ||
    inferColumnKey(rows, (k) => k === 'site' || k === 'siteid' || k === 'site_id') ||
    null;

  const regionKey = inferColumnKey(rows, (k) => k.includes('region') || k.includes('zone') || k.includes('area') || k.includes('province') || k.includes('state'));

  const dieselKey = inferColumnKey(rows, (k) => k.includes('diesel') || k.includes('amount_diesel') || k.includes('dg'));
  const elecKey = inferColumnKey(rows, (k) => k.includes('electric') || k.includes('amount_electric') || k.includes('amount_eb') || (k.includes('grid') && k.includes('amount')) || k === 'eb_amount');

  const totalKey = inferColumnKey(rows, (k) => k.includes('grand_total') || (k.includes('total') && (k.includes('amount') || k.includes('payable') || k.includes('cost'))));

  const toNum = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  };

  return { siteKey, regionKey, dieselKey, elecKey, totalKey, toNum };
};

const buildSiteChunks = (rows) => {
  const { siteKey, regionKey, dieselKey, elecKey, totalKey, toNum } = makeProjector(rows);

  // If we can’t find a site identifier, fall back to chunking by row windows.
  if (!siteKey) {
    const windowSize = 25;
    const chunks = [];
    for (let i = 0; i < rows.length; i += windowSize) {
      const slice = rows.slice(i, i + windowSize);
      const text = `Invoice rows ${i + 1}-${i + slice.length}:\n` + JSON.stringify(slice.slice(0, 8));
      chunks.push({ id: `rows:${i}`, text, meta: { type: 'rows', from: i + 1, to: i + slice.length } });
    }
    return chunks;
  }

  const siteAgg = new Map();
  for (const row of rows) {
    const rawSite = row?.[siteKey];
    if (rawSite === null || rawSite === undefined || rawSite === '') continue;
    const siteId = String(rawSite).trim();
    if (!siteAgg.has(siteId)) {
      siteAgg.set(siteId, {
        siteId,
        region: regionKey ? String(row?.[regionKey] ?? '').trim() : '',
        rowCount: 0,
        diesel: 0,
        electricity: 0,
        total: 0,
      });
    }
    const agg = siteAgg.get(siteId);
    agg.rowCount += 1;
    if (dieselKey) agg.diesel += toNum(row?.[dieselKey]);
    if (elecKey) agg.electricity += toNum(row?.[elecKey]);
    if (totalKey) agg.total += toNum(row?.[totalKey]);
    if (!agg.region && regionKey) agg.region = String(row?.[regionKey] ?? '').trim();
  }

  const chunks = [];
  for (const agg of siteAgg.values()) {
    const dieselOnly = agg.diesel > 0 && agg.electricity === 0;
    const text =
      `SITE: ${agg.siteId}\n` +
      (agg.region ? `REGION: ${agg.region}\n` : '') +
      `ROWS: ${agg.rowCount}\n` +
      `DIESEL_AMOUNT: ${agg.diesel}\n` +
      `ELECTRICITY_AMOUNT: ${agg.electricity}\n` +
      (totalKey ? `TOTAL_AMOUNT: ${agg.total}\n` : '') +
      `FLAGS: ${dieselOnly ? 'DIESEL_ONLY' : '—'}`;
    chunks.push({
      id: `site:${agg.siteId}`,
      text,
      meta: { type: 'site', siteId: agg.siteId, region: agg.region || null, diesel: agg.diesel, electricity: agg.electricity, total: agg.total, rowCount: agg.rowCount, dieselOnly },
    });
  }

  // Keep deterministic order to align with embedding outputs.
  chunks.sort((a, b) => (a.meta?.siteId || '').localeCompare(b.meta?.siteId || ''));
  return chunks;
};

const embedTexts = async (texts) => {
  const BATCH = 128; // keep payload sizes reasonable
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const resp = await fetch('/api/openai/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      const msg = data?.error?.message || `Embeddings request failed (${resp.status})`;
      throw new Error(msg);
    }
    const vectors = (data?.data || []).map((d) => d.embedding);
    out.push(...vectors);
  }
  return out;
};

export const ensureInvoiceRagIndexed = async (invoiceKey, rows) => {
  if (!invoiceKey) throw new Error('Missing invoiceKey');
  if (!Array.isArray(rows)) throw new Error('Rows must be an array');

  const cached = ragIndexCache.get(invoiceKey);
  if (cached?.ready) return cached;
  if (cached?.indexingPromise) return await cached.indexingPromise;

  const indexingPromise = (async () => {
    const chunks = buildSiteChunks(rows);
    // If huge, cap embeddings to avoid runaway costs (still useful).
    const MAX_CHUNKS = 600;
    const capped = chunks.slice(0, MAX_CHUNKS);
    const vectors = await embedTexts(capped.map((c) => c.text));
    const entry = { chunks: capped, vectors, ready: true };
    ragIndexCache.set(invoiceKey, entry);
    return entry;
  })();

  ragIndexCache.set(invoiceKey, { ready: false, indexingPromise });
  return await indexingPromise;
};

export const getInvoiceRagStatus = (invoiceKey) => {
  const entry = ragIndexCache.get(invoiceKey);
  if (!entry) return { ready: false, indexing: false };
  if (entry.ready) return { ready: true, indexing: false };
  return { ready: false, indexing: !!entry.indexingPromise };
};

export const retrieveInvoiceRagContext = async ({ invoiceKey, question, topK = 6 }) => {
  const entry = ragIndexCache.get(invoiceKey);
  if (!entry?.ready) return { chunks: [], reason: 'not_indexed' };

  const q = (question || '').trim();
  if (!q) return { chunks: [], reason: 'empty_question' };

  const qVecResp = await embedTexts([q]);
  const qVec = qVecResp[0];

  // Keyword boost for site IDs and diesel/grid terms.
  const qLower = normalizeText(q);
  const siteLike = q.toUpperCase().match(/\b[A-Z]{2,8}\d{3,10}\b/g) || [];
  const wantsDieselOnly = qLower.includes('diesel') && qLower.includes('only');

  const scored = entry.chunks.map((chunk, i) => {
    const sim = cosineSim(qVec, entry.vectors[i]);
    let boost = 0;
    const txt = chunk.text.toUpperCase();
    for (const code of siteLike) {
      if (txt.includes(code)) boost += 0.15;
    }
    if (wantsDieselOnly && chunk.meta?.dieselOnly) boost += 0.12;
    if (qLower.includes('diesel') && (chunk.meta?.diesel || 0) > 0) boost += 0.05;
    if (qLower.includes('grid') && (chunk.meta?.electricity || 0) > 0) boost += 0.05;
    return { chunk, score: sim + boost };
  });

  scored.sort((a, b) => b.score - a.score);
  return { chunks: scored.slice(0, topK).map((s) => s.chunk), reason: 'ok' };
};

export const clearRagCache = () => {
  ragIndexCache.clear();
};

