export const filterRows = (data, query) => {
    if (!query) return [];

    // Keep prompts cheap: select only a few rows and project only relevant fields.
    const MAX_ROWS = 8;
    const MAX_FIELDS_PER_ROW = 12;
    const MAX_FIELD_VALUE_CHARS = 200;

    const lowerQuery = query.toLowerCase();

    // Tokenize query and remove common stopwords so "diesel only" matches "diesel"
    // even when the exact phrase doesn't appear in invoice cells.
    const stopwords = new Set([
        'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'at', 'by',
        'with', 'without', 'what', 'which', 'who', 'whom', 'is', 'are', 'was', 'were',
        'be', 'been', 'being', 'only', 'please', 'tell', 'show', 'give', 'me', 'my',
        'how', 'many', 'amount', 'total', 'payable', 'cost', 'value', 'amounts',
    ]);

    const rawTokens = lowerQuery
        .replace(/[^a-z0-9_]+/g, ' ')
        .split(/\s+/)
        .map((t) => t.trim())
        .filter(Boolean);

    const tokens = rawTokens.filter((t) => t.length >= 3 && !stopwords.has(t));

    // If tokenization removes everything (e.g. "GHGR0440"), fall back to the full query.
    const effectiveTokens = tokens.length ? tokens : [lowerQuery.trim()].filter(Boolean);

    const safeValue = (val) => {
        if (val === null || val === undefined) return val;
        if (typeof val === 'number' || typeof val === 'boolean') return val;
        const s = String(val);
        return s.length > MAX_FIELD_VALUE_CHARS ? s.slice(0, MAX_FIELD_VALUE_CHARS) + '…' : s;
    };

    const wantDiesel = effectiveTokens.some((t) => t === 'diesel' || t === 'dg' || t === 'generator' || t === 'fuel');
    const wantElectricity = effectiveTokens.some((t) => t === 'electricity' || t === 'grid' || t === 'eb' || t === 'power' || t === 'kwh');
    const wantAmendment = effectiveTokens.some((t) => t === 'amendment' || t === 'adjustment' || t === 'correction');
    const wantTime = effectiveTokens.some((t) => t.includes('month') || t.includes('period') || t.includes('date') || t.includes('backbill') || t.includes('billing'));

    const isLikelySiteIdKey = (k) => {
        const key = k.toLowerCase();
        return (
            (key.includes('site') && key.includes('id')) ||
            key.includes('site code') ||
            key.includes('site#') ||
            key.includes('site #') ||
            key.includes('identity') // e.g. IDENTITY_KEY
        );
    };

    const isLikelyDieselKey = (k) => {
        const key = k.toLowerCase();
        return key.includes('diesel') || key.includes('dg') || key.includes('generator') || key.includes('amount_dg');
    };

    const isLikelyElectricityKey = (k) => {
        const key = k.toLowerCase();
        return key.includes('electricity') || key.includes('eb') || key.includes('grid') || key.includes('power') || key.includes('amount_eb');
    };

    const isLikelyAmountKey = (k) => {
        const key = k.toLowerCase();
        return (
            key.includes('total') ||
            key.includes('amount') ||
            key.includes('payable') ||
            key.includes('net') ||
            key.includes('grand') ||
            key.includes('invoice') ||
            key.includes('cost')
        );
    };

    const isLikelyTimeKey = (k) => {
        const key = k.toLowerCase();
        return (
            key.includes('month') ||
            key.includes('period') ||
            key.includes('date') ||
            key.includes('start') ||
            key.includes('end') ||
            key.includes('backbill') ||
            key.includes('billing')
        );
    };

    return data
        .filter((row) =>
            row &&
            Object.entries(row).some(([k, v]) => {
                const valStr = String(v ?? '').toLowerCase();
                const keyStr = String(k ?? '').toLowerCase();
                return effectiveTokens.some((tok) => {
                    if (!tok) return false;
                    return valStr.includes(tok) || keyStr.includes(tok);
                });
            })
        )
        .slice(0, MAX_ROWS)
        .map((row) => {
            const projected = {};

            // Always try to include identifying fields so the model can list sites.
            for (const [k, v] of Object.entries(row)) {
                if (Object.keys(projected).length >= MAX_FIELDS_PER_ROW) break;
                if (isLikelySiteIdKey(k)) projected[k] = safeValue(v);
            }

            // 1) Add a few priority fields based on intent.
            for (const [k, v] of Object.entries(row)) {
                if (Object.keys(projected).length >= MAX_FIELDS_PER_ROW) break;
                const keyStr = k.toLowerCase();
                const shouldIncludeByIntent =
                    (wantDiesel && isLikelyDieselKey(k)) ||
                    (wantElectricity && isLikelyElectricityKey(k)) ||
                    (wantAmendment && keyStr.includes('amend')) ||
                    (wantTime && isLikelyTimeKey(k)) ||
                    isLikelyAmountKey(k) ||
                    isLikelyTimeKey(k);

                if (shouldIncludeByIntent) {
                    projected[k] = safeValue(v);
                }
            }

            // 2) Add fields that match query tokens until we hit the limit.
            for (const [k, v] of Object.entries(row)) {
                if (Object.keys(projected).length >= MAX_FIELDS_PER_ROW) break;
                const valStr = String(v ?? '').toLowerCase();
                const keyStr = String(k ?? '').toLowerCase();
                const matches = effectiveTokens.some((tok) => {
                    if (!tok) return false;
                    return valStr.includes(tok) || keyStr.includes(tok) || keyStr.includes(tok);
                });

                if (matches) {
                    projected[k] = safeValue(v);
                }
            }

            return projected;
        });
};