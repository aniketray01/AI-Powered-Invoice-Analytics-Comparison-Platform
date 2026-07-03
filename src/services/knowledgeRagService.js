import kbRaw from './infozech_rag_knowledge.txt?raw';

const EMBEDDING_MODEL = 'text-embedding-3-small';

let kbIndex = {
  ready: false,
  indexing: false,
  chunks: [],
  vectors: [],
  embedEnabled: true,
  promise: null,
};

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

const embedTexts = async (texts) => {
  const BATCH = 128;
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
    out.push(...(data?.data || []).map((d) => d.embedding));
  }
  return out;
};

const toTokens = (text) =>
  (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

const parseKnowledgeChunks = () => {
  const text = (kbRaw || '').toString();
  if (!text.trim()) return [];

  // Split on "CHUNK XXX" headers.
  const parts = text.split(/^-{10,}\s*\nCHUNK\s+\d+\s+\|\s+TOPIC:/gmi);
  const headers = text.match(/CHUNK\s+(\d+)\s+\|\s+TOPIC:\s*(.+)/gmi) || [];

  // parts[0] is preamble; each subsequent part corresponds to a chunk body.
  const chunks = [];
  for (let i = 1; i < parts.length; i++) {
    const headerLine = headers[i - 1] || '';
    const m = headerLine.match(/CHUNK\s+(\d+)\s+\|\s+TOPIC:\s*(.+)$/i);
    const id = m ? m[1].padStart(3, '0') : String(i).padStart(3, '0');
    const topic = m ? m[2].trim() : `Chunk ${id}`;

    const body = parts[i]
      .replace(/^-{10,}[\s\S]*?^-{10,}\s*/m, '') // remove source separator block if present
      .trim();

    if (!body) continue;
    const chunkText = `TOPIC: ${topic}\n${body}`.slice(0, 4000);
    chunks.push({ id: `kb:${id}`, topic, text: chunkText });
  }

  if (chunks.length > 0) return chunks;

  // Fallback 1: headings like "### 3.6 FX RATE" (your edited knowledge file format).
  const headingMatches = [...text.matchAll(/^###\s+(.+)$/gmi)];
  if (headingMatches.length > 0) {
    const byHeading = [];
    for (let i = 0; i < headingMatches.length; i++) {
      const start = headingMatches[i].index ?? 0;
      const end = i + 1 < headingMatches.length ? (headingMatches[i + 1].index ?? text.length) : text.length;
      const topic = (headingMatches[i][1] || `Section ${i + 1}`).trim();
      const body = text.slice(start, end).trim();
      if (!body) continue;
      byHeading.push({
        id: `kb:h${String(i + 1).padStart(3, '0')}`,
        topic,
        text: `TOPIC: ${topic}\n${body}`.slice(0, 4000),
      });
    }
    if (byHeading.length > 0) return byHeading;
  }

  // Fallback 2: fixed-size windows so retrieval still works even if formatting changes.
  const lines = text.split(/\r?\n/).filter(Boolean);
  const windowSize = 70;
  const windows = [];
  for (let i = 0; i < lines.length; i += windowSize) {
    const slice = lines.slice(i, i + windowSize);
    windows.push({
      id: `kb:w${String(i / windowSize + 1).padStart(3, '0')}`,
      topic: `Window ${i / windowSize + 1}`,
      text: slice.join('\n').slice(0, 4000),
    });
  }
  return windows;
};

const ensureChunksLoaded = () => {
  if (kbIndex.chunks.length > 0) return kbIndex.chunks;
  const chunks = parseKnowledgeChunks();
  kbIndex.chunks = chunks;
  // "ready" means chunks are available for retrieval (lexical minimum viable mode).
  kbIndex.ready = chunks.length > 0;
  return chunks;
};

export const getKnowledgeRagStatus = () => ({
  ready: kbIndex.ready,
  indexing: kbIndex.indexing,
  chunkCount: kbIndex.chunks.length,
  embedEnabled: kbIndex.embedEnabled,
});

export const ensureKnowledgeIndexed = async () => {
  ensureChunksLoaded();
  if (kbIndex.ready && kbIndex.vectors.length > 0) return kbIndex;
  if (kbIndex.promise) return await kbIndex.promise;

  kbIndex.indexing = true;
  kbIndex.promise = (async () => {
    const chunks = ensureChunksLoaded();
    if (!chunks.length) {
      throw new Error('Knowledge file parsed into 0 chunks.');
    }
    // Embeddings are optional. If they fail, fall back to lexical retrieval.
    let vectors = [];
    let embedEnabled = true;
    try {
      vectors = await embedTexts(chunks.map((c) => c.text));
    } catch (_e) {
      vectors = [];
      embedEnabled = false;
    }

    kbIndex = { ready: true, indexing: false, chunks, vectors, embedEnabled, promise: null };
    return kbIndex;
  })().catch((e) => {
    // Keep parsed chunks available even if embeddings fail.
    kbIndex = {
      ready: kbIndex.chunks.length > 0,
      indexing: false,
      chunks: kbIndex.chunks,
      vectors: [],
      embedEnabled: false,
      promise: null,
    };
    throw e;
  });

  return await kbIndex.promise;
};

export const retrieveKnowledgeContext = async ({ question, topK = 6 }) => {
  ensureChunksLoaded();
  const q = (question || '').trim();
  if (!q) return { chunks: [], reason: 'empty' };
  if (!kbIndex.ready) return { chunks: [], reason: 'not_ready' };

  const qTokens = new Set(toTokens(q));
  const qUpper = q.toUpperCase();

  let qVec = null;
  if (kbIndex.embedEnabled && kbIndex.vectors.length === kbIndex.chunks.length && kbIndex.vectors.length > 0) {
    try {
      qVec = (await embedTexts([q]))[0];
    } catch (_e) {
      qVec = null;
    }
  }

  const scored = kbIndex.chunks.map((chunk, i) => {
    const sim = qVec && kbIndex.vectors[i] ? cosineSim(qVec, kbIndex.vectors[i]) : 0;
    let boost = 0;
    const cTokens = new Set(toTokens(chunk.text));
    let overlap = 0;
    qTokens.forEach((t) => {
      if (cTokens.has(t)) overlap += 1;
    });
    // Heavier lexical weighting so exact KB terms always win.
    boost += Math.min(0.45, overlap * 0.07);

    // Direct phrase/term match boost (great for underscore terms like CUMULATIVE_ESCALATION).
    const txtUpper = chunk.text.toUpperCase();
    if (txtUpper.includes(qUpper)) boost += 0.35;
    qTokens.forEach((t) => {
      if (t.length >= 4 && txtUpper.includes(t.toUpperCase())) boost += 0.03;
    });

    // Keyword boost for product names.
    if (qUpper.includes('IBILL') && txtUpper.includes('IBILL')) boost += 0.12;
    if (qUpper.includes('IETS') && txtUpper.includes('IETS')) boost += 0.12;
    if (qUpper.includes('IROC') && txtUpper.includes('IROC')) boost += 0.12;
    if (qUpper.includes('IMAINTAIN') && txtUpper.includes('IMAINTAIN')) boost += 0.12;
    if (qUpper.includes('ITOWER') && txtUpper.includes('ITOWER')) boost += 0.12;
    if (qUpper.includes('FX') && txtUpper.includes('FX')) boost += 0.12;
    if (qUpper.includes('ESCALATION') && txtUpper.includes('ESCALATION')) boost += 0.12;
    return { chunk, score: sim + boost };
  });

  scored.sort((a, b) => b.score - a.score);
  return { chunks: scored.slice(0, topK).map((s) => s.chunk), reason: 'ok' };
};

