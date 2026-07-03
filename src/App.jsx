import React, { useState, useEffect } from 'react';
import {
    Radio,
    FileSpreadsheet,
    AlertCircle,
    UploadCloud,
    Zap,
    Building2,
    MapPin,
    DollarSign,
    Scale,
    Layers,
    ArrowLeft,
    Search,
    ChevronUp,
    ChevronDown,
    Check,
    Info,
    PlusCircle,
    MessageSquare,
    Send,
    RefreshCw,
    Mic,
    Volume2,
    X,
    LogOut,
    Users,
    Fingerprint,
    User,
    Download,
    FileText
} from 'lucide-react';
import { exportToPDF } from './utils/pdfExport';
import { exportToExcel, exportComparisonToExcel } from './utils/excelExport';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';
import * as XLSX from 'xlsx';
import { useAuth } from './context/AuthContext';
import Login from './components/Login';
import Profile from './components/Profile';
import { logActivity } from './utils/logger';
import { getSpeechRecognition, normalizeSpeechTranscript, speakEnglish, stopSpeaking } from './utils/voiceAssistant';
import { 
    PieChart, Pie, Cell, Tooltip, ResponsiveContainer, 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend 
} from 'recharts';
import { filterRows } from './services/filterService';
import { ensureInvoiceRagIndexed, retrieveInvoiceRagContext, getInvoiceRagStatus } from './services/ragService';
import { ensureKnowledgeIndexed, retrieveKnowledgeContext, getKnowledgeRagStatus } from './services/knowledgeRagService';

const getOpenAIKey = () =>
    (import.meta.env.VITE_OPENAI_KEY || localStorage.getItem('IBILL_OPENAI_KEY') || '').trim();

const fetchOpenAIChatCompletion = async ({
    apiKey,
    model = 'gpt-4o-mini',
    messages,
    maxTokens = 900,
    temperature = 0.2,
    topP = 0.9
}) => {
    // Use local dev proxy to avoid browser CORS and to keep API key off the client.
    // The proxy reads VITE_OPENAI_KEY from your server env.
    const response = await fetch('/api/openai/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // Authorization is injected by Vite dev proxy
        },
        body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
            top_p: topP
        })
    });

    const data = await response.json();
    if (!response.ok) {
        const msg = data?.error?.message || `OpenAI request failed (${response.status})`;
        throw new Error(msg);
    }
    return data;
};

const DEEP_LAYER_LS_KEY = 'IBILL_DEEP_LAYER_AI_SUPPLEMENT';

const readDeepLayerSupplementPref = () => {
    try {
        return localStorage.getItem(DEEP_LAYER_LS_KEY) !== '0';
    } catch (_) {
        return true;
    }
};

const wrapDeepLayerSupplementSection = (innerHtml) => `
                    <div style="margin-top: 32px; padding-top: 32px; border-top: 1px solid rgba(255,255,255,0.05);">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px;">
                            <div style="width: 8px; height: 8px; background: #6366f1; border-radius: 50%; box-shadow: 0 0 10px #6366f1;"></div>
                            <span style="font-size: 0.75rem; font-weight: 800; color: #94a3b8; text-transform: uppercase;">Deep-Layer AI Analysis (Supplement)</span>
                        </div>
                        ${innerHtml}
                    </div>
                `;

const getDeepLayerPendingHtml = () =>
    wrapDeepLayerSupplementSection(`
                    <div style="display:flex; align-items:flex-start; gap:14px; padding:16px 18px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.22); border-radius: 14px;">
                        <div style="flex-shrink:0; width:22px; height:22px; border:2px solid rgba(129,140,248,0.35); border-top-color:#a5b4fc; border-radius:50%; animation: ibillDlSpin 0.85s linear infinite;"></div>
                        <div>
                            <div style="color:#e2e8f0; font-weight:800; font-size:0.95rem;">Generating Deep-Layer AI…</div>
                            <div style="color:#94a3b8; font-size:0.82rem; margin-top:6px; line-height:1.5;">This runs a second OpenAI request and may take about 15–45 seconds. Your local forensic sections above are already complete.</div>
                        </div>
                    </div>
                `);

const TOWER_GLOSSARY = {
    energy: {
        terms: ['energy', 'eb', 'electricity', 'grid', 'power', 'kwh', 'eb power'],
        explanation: "This is the cost for grid electricity used to keep the tower and communication equipment running 24/7."
    },
    diesel: {
        terms: ['diesel', 'dg', 'fuel', 'generator', 'hsd', 'diesel filling'],
        explanation: "This charge covers the diesel fuel used by the backup generator during power outages to ensure network uptime."
    },
    rent: {
        terms: ['rent', 'license', 'ground', 'ip', 'lease', 'space', 'site rental'],
        explanation: "This is the fixed monthly cost for the land or roof space where the tower is physically standing."
    },
    maintenance: {
        terms: ['o&m', 'maintenance', 'repair', 'servicing', 'visit', 'preventive'],
        explanation: "These are charges for the technical team that visits the site for routine checkups and equipment repairs."
    },
    security: {
        terms: ['security', 'guard', 'care taker', 'watchman', 'patrol'],
        explanation: "This covers the personnel responsible for protecting the site from theft or unauthorized access."
    },
    fiber: {
        terms: ['fiber', 'backhaul', 'lease line', 'broadband', 'data', 'transmission'],
        explanation: "This is the cost for the high-speed data cables that connect this tower to the rest of the cellular network."
    },
    penalty: {
        terms: ['late', 'penalty', 'fine', 'interest', 'delay'],
        explanation: "These are avoidable 'punishment' fees charged for late payments or missing contract deadlines."
    },
    insurance: {
        terms: ['insurance', 'cover', 'premium'],
        explanation: "This is a protection payment to cover the tower equipment against theft, fire, or accidental damage."
    }
};

const InvoiceSelector = ({ onSelect }) => {
    const [error, setError] = useState(null);

    const handleFileUpload = (e) => {
        try {
            setError(null);
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const bstr = evt.target.result;
                    const wb = XLSX.read(bstr, { type: 'binary' });
                    
                    const wsname = wb.SheetNames[0];
                    if (!wsname) throw new Error("The file appears to be empty or invalid.");
                    
                    const ws = wb.Sheets[wsname];
                    const data = XLSX.utils.sheet_to_json(ws);
                    
                    if (!data || data.length === 0) throw new Error("No readable data records found in this sheet.");

                    onSelect({
                        id: Date.now().toString(),
                        name: file.name,
                        data: data
                    });
                } catch (err) {
                    setError(err.message || "Failed to process the Excel data. Please check the file format.");
                }
            };
            reader.onerror = () => setError("File reader error. The file might be corrupted.");
            reader.readAsBinaryString(file);
        } catch (err) {
            setError("Unexpected upload error.");
        }
    };

    return (
        <section className="hero" style={{ padding: '60px 20px', textAlign: 'center' }}>
            <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="hero-content"
            >
                <div style={{ 
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 20px',
                    background: 'rgba(99, 102, 241, 0.1)',
                    borderRadius: '100px',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    color: 'var(--primary)',
                    fontSize: '0.85rem',
                    fontWeight: '700',
                    marginBottom: '32px',
                    letterSpacing: '0.5px',
                    textTransform: 'uppercase'
                }}>
                    <div style={{ width: '6px', height: '6px', background: 'var(--primary)', borderRadius: '50%', boxShadow: '0 0 10px var(--primary)' }}></div>
                    AI-Powered Forensic Audit Suite v2.0
                </div>

                <h1 style={{ 
                    fontSize: '4.5rem', 
                    fontWeight: '900', 
                    lineHeight: '1.05', 
                    marginBottom: '24px',
                    letterSpacing: '-2px',
                    background: 'linear-gradient(to right, #fff 20%, #94a3b8 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                }}>
                    Audit Any Invoice.<br />
                    With <span style={{ color: 'var(--primary)' }}>Sovereign Confidence.</span>
                </h1>

                <p style={{ 
                    color: 'var(--text-dim)', 
                    fontSize: '1.25rem', 
                    maxWidth: '700px', 
                    margin: '0 auto 56px',
                    lineHeight: '1.6'
                }}>
                    Upload any telecom style excel file. Our Heuristic Engine auto-reconciles Site IDs, 
                    financial variants, and operational metrics with 100% local processing.
                </p>

                <div className="upload-container" style={{ maxWidth: '650px', margin: '0 auto' }}>
                    {error && (
                        <motion.div 
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="glass-panel" 
                            style={{ padding: '15px 20px', background: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.2)', color: '#f87171', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.9rem' }}
                        >
                            <AlertCircle size={20} /> {error}
                        </motion.div>
                    )}
                    
                    <div className="glass-panel" style={{ padding: '4px', overflow: 'hidden' }}>
                        <div style={{ 
                            position: 'relative',
                            padding: '60px 40px',
                            border: '2px dashed rgba(255, 255, 255, 0.1)',
                            borderRadius: '16px',
                            textAlign: 'center',
                            background: 'rgba(255, 255, 255, 0.02)',
                            transition: 'all 0.3s'
                        }} className="upload-dropzone">
                            <input 
                                type="file" 
                                accept=".xlsx, .xls, .csv" 
                                onChange={handleFileUpload}
                                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 10 }}
                            />
                            <div style={{ 
                                width: '80px', 
                                height: '80px', 
                                background: 'rgba(99, 102, 241, 0.1)', 
                                border: '1px solid rgba(99, 102, 241, 0.2)',
                                borderRadius: '24px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 24px',
                                color: 'var(--primary)'
                            }}>
                                <UploadCloud size={40} />
                            </div>
                            <h3 style={{ fontSize: '1.5rem', marginBottom: '8px', fontWeight: '800' }}>Drop Invoice Here</h3>
                            <p style={{ color: 'var(--text-dim)', fontSize: '0.95rem' }}>Securely process Excel or CSV local files</p>
                        </div>
                    </div>
                </div>
            </motion.div>
        </section>
    );
};

// Heuristic Search Patterns for Robust Column Discovery
const COLUMN_PATTERNS = {
    siteId: ['SITERRA_SITE_ID', 'SITE_ID', 'SITE ID', 'Site ID', 'Site Code', 'SiteName', 'Site #', 'SiteId', 'site_id', 'SITERRASITE ID'],
    nonEnergy: ['AMOUNT_NONENERGY', 'NON_ENERGY', 'Rent', 'Non-Energy', 'NonEnergy', 'Base Charge', 'License', 'Space Fee', 'Lease', 'RENTAL'],
    electricity: ['AMOUNT_ELECTRICITY', 'ELECTRICITY', 'EB_AMOUNT', 'EB', 'Electricity', 'Grid Power', 'Grid', 'Power', 'ENERGY_EB'],
    diesel: ['AMOUNT_DIESEL', 'DIESEL', 'DG_AMOUNT', 'DG', 'Diesel', 'Fuel', 'Generator', 'ENERGY_DG'],
    amendment: ['AMENDMENT_AMOUNT', 'ADJUSTMENT_AMOUNT', 'CORRECTION_AMOUNT', 'AMENDMENT_VALUE', 'AMENDMENT', 'Amendment', 'Adjustment', 'Correction', 'Retro', 'Late Fee', 'LATE_PENALTY'],
    amendmentDescription: ['AMENDMENT_ITEM', 'AMENDMENT_DESCRIPTION', 'AMENDMENT_DESC', 'DESCRIPTION', 'CHARGE_DESCRIPTION'],
    total: ['GRAND_TOTAL', 'TOTAL_AMOUNT', 'Total', 'Invoice Amount', 'Net Amount', 'Payable', 'Amount Due', 'TOTAL'],
    region: ['REGION_NAME', 'REGIONAL_NAME', 'REGION', 'Region', 'State', 'Province', 'Zone', 'Area', 'STATION_NAME'],
    currency: ['CURRENCY', 'CURRENCY_CODE', 'CURRENCY_NE', 'CCY', 'Cur', 'Currency', 'CURR'],
    // Specialized Forensic Dimensions
    customer: ['CUSTOMER', 'CLIENT', 'OPERATOR', 'TENANT_NAME', 'KNOWN_AS', 'CUSTOMER NAME', 'CUSTOMER_KNOWN_AS'],
    siteType: ['SITE_TYPE', 'TYPE', 'STRUCTURE_TYPE', 'SITE TYPE', 'SITE_CATEGORY'],
    status: ['SITE_STATUS', 'STATUS', 'SITE STATUS', 'Active', 'SITE_STATE'],
    leaseStart: ['LEASE_START', 'RENT_START', 'COMMENCEMENT', 'START_DATE', 'LEASESTART_DATE', 'RENT_START_DATE', 'AGREEMENT_DATE'],
    rentFree: ['RENT_FREE', 'RENT_PERIOD', 'FREE_MONTHS', 'RENT FREE', 'RENT_FREE_PERIOD'],
    amdBase: ['AMD_BASE', 'CHARGE_BASE', 'AMENDMENT_BASE', 'BASE_AMD'],
    discount: ['DISCOUNT', 'REBATE', 'DEDUCTION', 'DISCOUNT_AMOUNT'],
    billMonth: ['BILL_MONTH', 'BILLING_PERIOD', 'MONTH', 'BILL MONTH', 'PERIOD', 'INVOICE_MONTH']
};

const findMetricValue = (row, patterns) => {
    const keys = Object.keys(row);
    const foundKey = keys.find(k => 
        patterns.some(p => k.toUpperCase().includes(p.toUpperCase()))
    );
    return foundKey ? row[foundKey] : null;
};

// Helpers for ranking "drivers" we already computed from the invoice dataset.
const topEntries = (obj, k = 5) => {
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj)
        .filter(([, v]) => typeof v === 'number' && isFinite(v))
        .sort((a, b) => b[1] - a[1])
        .slice(0, k);
};

const topAbsEntries = (obj, k = 5) => {
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(obj)
        .filter(([, v]) => typeof v === 'number' && isFinite(v) && v !== 0)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, k);
};

const topDeltaAbsEntries = (objA, objB, k = 5) => {
    const a = objA || {};
    const b = objB || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return Array.from(keys)
        .map((key) => {
            const av = typeof a[key] === 'number' && isFinite(a[key]) ? a[key] : 0;
            const bv = typeof b[key] === 'number' && isFinite(b[key]) ? b[key] : 0;
            return [key, bv - av];
        })
        .filter(([, delta]) => delta !== 0)
        .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
        .slice(0, k);
};

const pad2 = (n) => String(n).padStart(2, '0');
const formatDateDDMonYYYY = (d) => {
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${pad2(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()}`;
};

const randomObjectIdHex = () => {
    // 24 hex chars (Mongo ObjectId string form)
    const bytes = crypto?.getRandomValues ? crypto.getRandomValues(new Uint8Array(12)) : Array.from({ length: 12 }, () => Math.floor(Math.random() * 256));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

const toMongoDocString = (doc) => JSON.stringify(doc, null, 4);

const toMongoBulkDocString = (docs) => {
    if (!Array.isArray(docs)) return toMongoDocString(docs);
    // Output one object after another (no [] and no commas).
    return docs.map((item) => toMongoDocString(item)).join('\n\n');
};

const stripHtml = (html) => {
    if (!html) return '';
    return html
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const sanitizeAiText = (text) => {
    if (!text) return '';
    let t = String(text);
    // Convert markdown bullets to a readable bullet and remove emphasis markers.
    t = t.replace(/^(\s*)[-*]\s+/gm, '$1• ');
    t = t.replace(/\*\*(.*?)\*\*/g, '$1');
    t = t.replace(/\*(.*?)\*/g, '$1');
    return t.trim();
};

// Converts an Excel serial number to a readable date string
const excelSerialToDate = (serial) => {
    try {
        // Excel's epoch is Dec 30, 1899; JavaScript's is Jan 1, 1970
        // Also account for Excel's erroneous leap year 1900 bug (serial > 60)
        const adjustedSerial = serial > 60 ? serial : serial + 1;
        const date = new Date(Math.round((adjustedSerial - 25569) * 86400 * 1000));
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
        }
    } catch (_) {}
    return null;
};

// Keywords that identify a column as date-bearing (case-insensitive substring match)
const DATE_COLUMN_KEYWORDS = [
    'DATE', 'MONTH', 'PERIOD', 'START', 'END', 'EFFECTIVE', 'DUE',
    'BACK_BILL', 'BACKBILL',
    'LEASE', 'COMMENCEMENT', 'COMMENCE', 'EXPIRY', 'EXPIRE', 'EXPIRATION',
    'INCEPTION', 'TERM', 'RENT_FREE', 'RENT FREE',
    'BILLING', 'BILL_DATE', 'INVOICE_DATE',
    'CONTRACT', 'AGREEMENT',
    'CREATED', 'MODIFIED', 'UPDATED',
    'HANDOVER', 'ROLLOUT', 'ACTIVATION', 'DECOMMISSION',
    'VALID', 'FROM', 'TO', 'TILL', 'UNTIL',
    'ISSUE', 'PAYMENT', 'SETTLEMENT', 'RFI', 'RFS', 'RFA'
];

const formatValueWithDates = (val, key) => {
    if (val === null || val === undefined) return '-';

    const keyStr = (key || '').toString().toUpperCase();
    const isDateKey = DATE_COLUMN_KEYWORDS.some(dk => keyStr.includes(dk));

    // ── Numeric value: try Excel serial date conversion ──────────────────────
    if (typeof val === 'number') {
        // Excel serial range: ~25568 = 01-Jan-1970, ~109574 = 31-Dec-2199
        const looksLikeSerial = val >= 1 && val <= 109574;
        if (isDateKey && looksLikeSerial) {
            const formatted = excelSerialToDate(val);
            if (formatted) return formatted;
        }
        // Not a date — return as-is (will be formatted by the caller if needed)
        return val.toString();
    }

    // ── String value: try multiple date format parsers ────────────────────────
    if (typeof val === 'string') {
        const trimmed = val.trim();

        if (isDateKey && trimmed.length > 0) {
            // ISO format: 2026-01-15 or 2026-01-15T00:00:00
            if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
                try {
                    const d = new Date(trimmed);
                    if (!isNaN(d.getTime())) {
                        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                    }
                } catch (_) {}
            }
            // UK format: 15/01/2026 or 15-01-2026
            if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(trimmed)) {
                try {
                    const [d, m, y] = trimmed.split(/[\/\-]/);
                    const date = new Date(`${y}-${m}-${d}`);
                    if (!isNaN(date.getTime())) {
                        return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                    }
                } catch (_) {}
            }
            // US format: 01/15/2026
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
                try {
                    const d = new Date(trimmed);
                    if (!isNaN(d.getTime())) {
                        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                    }
                } catch (_) {}
            }
            // Named month format: 15-Jan-2026 or 15 Jan 2026
            if (/^\d{1,2}[\s\-][A-Za-z]{3}[\s\-]\d{4}$/.test(trimmed)) {
                try {
                    const d = new Date(trimmed);
                    if (!isNaN(d.getTime())) {
                        return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
                    }
                } catch (_) {}
            }
        }
        return trimmed || '-';
    }

    return val.toString();
};

const calculateDetailedMetrics = (data) => {
    let uniqueSites = new Set();
    let totalRecords = data.length;
    let totalNonEnergy = 0;
    let totalElectricity = 0;
    let totalDiesel = 0;
    let totalAmendment = 0;
    let gridCount = 0;
    let offGridCount = 0;
    let regionCounts = {};
    let rooftopCount = 0;
    let greenfieldCount = 0;
    let multiTenancyCount = 0;
    let singleTenancyCount = 0;
    let rentFreeCount = 0;
    let backBillCount = 0;
    let onAirCount = 0;
    let currency = '';

    // Enhanced Forensic Tracking
    let customerCounts = {};
    let siteStatusCounts = {};
    let siteTypeCounts = {};
    let siteAmdCounts = {}; // siteId -> count
    let totalDiscounts = 0;
    let amdBaseEnergy = 0;
    let amdBaseNonEnergy = 0;
    let rentFreeAudit = []; // sites flagged by start_date vs bill_month logic
    
    // Breakdown objects
    let tenantMix = {};
    let amendmentBreakdown = {};
    let leaseComponentBreakdown = {};
    
    // Escalation tracking
    let fxRates = [];
    let escalations = [];

    const getVal = (val) => {
        if (val === null || val === undefined) return 0;
        if (typeof val === 'string') {
            val = val.replace(/,/g, '');
        }
        let num = parseFloat(val);
        return isNaN(num) ? 0 : num;
    };

    // Helper: return the actual matched column key name from a row for the given pattern list
    const findActualKey = (row, patterns) => {
        const keys = Object.keys(row);
        // Priority 1: Exact matches (case insensitive)
        const exact = keys.find(k => patterns.some(p => k.toUpperCase() === p.toUpperCase()));
        if (exact) return exact;
        
        // Priority 2: Fuzzy matches with false-positive filtering for financial columns
        return keys.find(k => {
            const ku = k.toUpperCase();
            const matches = patterns.some(p => ku.includes(p.toUpperCase()));
            if (!matches) return false;
            
            // False positive protection: financial patterns shouldn't accidentally hit dates
            const isFinancialPattern = patterns.some(p => 
                ['AMOUNT', 'RENT', 'NON_ENERGY', 'NONENERGY', 'CHARGE', 'FEE', 'TOTAL', 'LEASE'].some(fp => p.toUpperCase().includes(fp))
            );
            if (isFinancialPattern) {
                const dateKeywords = ['DATE', 'START', 'MONTH', 'YEAR', 'PERIOD'];
                const hasDateInfo = dateKeywords.some(dk => ku.includes(dk));
                if (hasDateInfo) {
                    // Only keep if the pattern itself specifically asked for date/start/etc keywords
                    const patternWantsDate = patterns.some(p => dateKeywords.some(dk => p.toUpperCase().includes(dk)));
                    if (!patternWantsDate) return false;
                }
            }
            return true;
        }) || null;
    };

    // Pre-scan first row to discover actual column names (used as dynamic chart labels)
    let nonEnergyKey = null, electricityKey = null, dieselKey = null, amendmentKey = null;
    if (data.length > 0) {
        const firstRow = data[0];
        nonEnergyKey   = findActualKey(firstRow, COLUMN_PATTERNS.nonEnergy);
        electricityKey = findActualKey(firstRow, COLUMN_PATTERNS.electricity);
        dieselKey      = findActualKey(firstRow, COLUMN_PATTERNS.diesel);
        amendmentKey   = findActualKey(firstRow, COLUMN_PATTERNS.amendment);
    }

    data.forEach(row => {
        // Site Tracking using Heuristics
        const sId = findMetricValue(row, COLUMN_PATTERNS.siteId);
        if (sId) uniqueSites.add(sId.toString());

        // Currency detection — prefer dedicated currency column, validate it looks like a code
        if (!currency) {
            const rowCurr = findMetricValue(row, COLUMN_PATTERNS.currency);
            if (rowCurr && typeof rowCurr === 'string' && rowCurr.trim().length > 0 && rowCurr.trim().length <= 5) {
                currency = rowCurr.trim();
            }
        }
        
        // Status tracking — search dynamically for status columns
        const statusKey = Object.keys(row).find(k => k.toUpperCase() === 'SITE_STATUS' || k.toUpperCase() === 'STATUS' || k.toUpperCase() === 'SITE STATUS');
        const siteStatus = (statusKey ? row[statusKey] : '').toString().toUpperCase();
        if (siteStatus.includes('ON AIR') || siteStatus === 'ACTIVE') onAirCount++;

        // Financials using Heuristics
        const neAmount  = getVal(findMetricValue(row, COLUMN_PATTERNS.nonEnergy));
        const ebAmount  = getVal(findMetricValue(row, COLUMN_PATTERNS.electricity));
        const dgAmount  = getVal(findMetricValue(row, COLUMN_PATTERNS.diesel));
        const amdAmount = getVal(findMetricValue(row, COLUMN_PATTERNS.amendment));
        
        totalNonEnergy   += neAmount;
        totalElectricity += ebAmount;
        totalDiesel      += dgAmount;
        totalAmendment   += amdAmount;

        // Lease Components — discover column dynamically
        const lrcKey = Object.keys(row).find(k =>
            k.toUpperCase().includes('LEASE_RATE') || k.toUpperCase() === 'COMPONENT' || k.toUpperCase() === 'CHARGE_TYPE'
        );
        const component = (lrcKey ? row[lrcKey] : null) || 'Unspecified';
        leaseComponentBreakdown[component] = (leaseComponentBreakdown[component] || 0) + (neAmount + ebAmount + dgAmount + amdAmount);

        // Amendments Breakdown — discover description column dynamically using STRICTER patterns
        const amdDescKey = findActualKey(row, COLUMN_PATTERNS.amendmentDescription);
        const amdItem = amdDescKey ? row[amdDescKey] : null;
        if (amdItem && amdItem !== '-' && amdAmount !== 0) {
            amendmentBreakdown[amdItem] = (amendmentBreakdown[amdItem] || 0) + amdAmount;
        }

        // Grid / Power Status — discover dynamically
        const gridKey = Object.keys(row).find(k =>
            k.toUpperCase().includes('GRID_STATUS') || k.toUpperCase() === 'POWERSOURCE' || k.toUpperCase() === 'POWER_SOURCE'
        );
        const gridStatus = (gridKey ? row[gridKey] : '').toString().toUpperCase();
        if (gridStatus.includes('OFF-GRID') || gridStatus === 'OFF GRID' || gridStatus === 'DG') offGridCount++;
        else if (gridStatus.includes('GRID') || gridStatus === 'EB') gridCount++;

        // Site Type
        const siteTypeKey = Object.keys(row).find(k =>
            k.toUpperCase() === 'SITE_TYPE' || k.toUpperCase() === 'SITETYPE' || k.toUpperCase() === 'TYPE'
        );
        const siteType = (siteTypeKey ? row[siteTypeKey] : '').toString().toUpperCase();
        if (siteType.includes('ROOFTOP')) rooftopCount++;
        else if (siteType.includes('GREENFIELD')) greenfieldCount++;

        // Tenancy
        const tenancyKey = Object.keys(row).find(k =>
            k.toUpperCase().includes('TENANCY') || k.toUpperCase().includes('MULTI_TENANT')
        );
        const tenancy = (tenancyKey ? row[tenancyKey] : '').toString().toUpperCase();
        if (tenancy.includes('MULTIPLE') || tenancy.includes('SHARED') || tenancy.includes('MULTI')) multiTenancyCount++;
        else singleTenancyCount++;

        // Anchor Tenant / Customer
        const anchorKey = Object.keys(row).find(k =>
            k.toUpperCase().includes('ANCHOR_TENANT') || k.toUpperCase() === 'CLIENT' ||
            k.toUpperCase() === 'TENANT_NAME' || k.toUpperCase() === 'CUSTOMER' || k.toUpperCase() === 'OPERATOR'
        );
        const anchor = (anchorKey ? row[anchorKey] : null) || 'Unknown';
        tenantMix[anchor] = (tenantMix[anchor] || 0) + 1;

        // Rent Free
        const rfKey = Object.keys(row).find(k => k.toUpperCase().includes('RENT_FREE'));
        const rfPeriod = rfKey ? row[rfKey] : null;
        const isRentFree = (rfPeriod && rfPeriod.toString() !== '0') || (neAmount === 0 && ebAmount === 0 && dgAmount === 0);
        if (isRentFree) rentFreeCount++;

        // Back-billing detection — any column containing BACK_BILL
        const hasBackBillCol = Object.keys(row).some(k => k.toUpperCase().includes('BACK_BILL'));
        const descKey = Object.keys(row).find(k => k.toUpperCase() === 'DESCRIPTION' || k.toUpperCase() === 'CHARGE_DESCRIPTION');
        if (hasBackBillCol || (descKey && (row[descKey] || '').toString().toUpperCase().includes('BACKBILL'))) backBillCount++;

        const region = findMetricValue(row, COLUMN_PATTERNS.region) || 'Unknown';
        regionCounts[region] = (regionCounts[region] || 0) + 1;

        // Custom Forensic Logic requested by User
        const custVal = findMetricValue(row, COLUMN_PATTERNS.customer) || 'Unknown';
        customerCounts[custVal] = (customerCounts[custVal] || 0) + 1;

        const statVal = findMetricValue(row, COLUMN_PATTERNS.status) || 'Unknown';
        siteStatusCounts[statVal] = (siteStatusCounts[statVal] || 0) + 1;

        const typeVal = findMetricValue(row, COLUMN_PATTERNS.siteType) || 'Unknown';
        siteTypeCounts[typeVal] = (siteTypeCounts[typeVal] || 0) + 1;

        const discAmount = getVal(findMetricValue(row, COLUMN_PATTERNS.discount));
        totalDiscounts += discAmount;

        const amdBaseVal = (findMetricValue(row, COLUMN_PATTERNS.amdBase) || '').toString().toUpperCase();
        if (amdBaseVal.includes('ENERGY') || amdBaseVal.includes('EB') || amdBaseVal.includes('POWER')) amdBaseEnergy += amdAmount;
        else if (amdBaseVal.trim() !== '') amdBaseNonEnergy += amdAmount;

        if (amdAmount !== 0 && sId) {
            const sidStr = sId.toString();
            siteAmdCounts[sidStr] = (siteAmdCounts[sidStr] || 0) + 1;
        }

        // Advanced Rent-Free Logic: Rent Start > Bill Month
        const rentStart = findMetricValue(row, COLUMN_PATTERNS.leaseStart);
        const billMonth = findMetricValue(row, COLUMN_PATTERNS.billMonth);
        if (rentStart && billMonth && sId) {
            try {
                const rsDate = new Date(typeof rentStart === 'number' ? Math.round((rentStart - 25569) * 86400 * 1000) : rentStart);
                const bmDate = new Date(typeof billMonth === 'number' ? Math.round((billMonth - 25569) * 86400 * 1000) : billMonth);
                if (!isNaN(rsDate.getTime()) && !isNaN(bmDate.getTime())) {
                    if (rsDate > bmDate) {
                        rentFreeAudit.push(sId.toString());
                    }
                }
            } catch (e) {}
        }

        // Escalation / FX
        const fxKey = Object.keys(row).find(k => k.toUpperCase().includes('FX_RATE') || k.toUpperCase() === 'EXCHANGERATE');
        if (fxKey) fxRates.push(getVal(row[fxKey]));
        const escKey = Object.keys(row).find(k => k.toUpperCase().includes('CUMULATIVE_ESC') || k.toUpperCase() === 'ESCALATION');
        if (escKey) escalations.push(getVal(row[escKey]));
    });

    let topRegion = 'N/A';
    let topRegionCount = 0;
    Object.entries(regionCounts).forEach(([r, c]) => {
        if (c > topRegionCount) {
            topRegion = r;
            topRegionCount = c;
        }
    });

    const avgFxRate = fxRates.length ? (fxRates.reduce((a, b) => a + b, 0) / fxRates.length) : 0;
    const avgEscalation = escalations.length ? (escalations.reduce((a, b) => a + b, 0) / escalations.length) : 1;

    // Dynamic labels derived from the actual matched column headers in the uploaded file
    const nonEnergyLabel   = nonEnergyKey   || 'Non-Energy Charges';
    const electricityLabel = electricityKey || 'Electricity / Grid';
    const dieselLabel      = dieselKey      || 'Diesel / Generator';
    const amendmentLabel   = amendmentKey   || 'Amendments';

    // currency stays '' if not found — callers must guard before displaying
    const totalEnergy = totalElectricity + totalDiesel;
    const grandTotal  = totalNonEnergy + totalEnergy + totalAmendment;

    return {
        totalRecords,
        uniqueSites,
        grandTotal,
        totalNonEnergy,
        totalEnergy,
        totalElectricity,
        totalDiesel,
        totalAmendment,
        rooftopCount,
        greenfieldCount,
        onAirCount,
        multiTenancyCount,
        singleTenancyCount,
        rentFreeCount,
        backBillCount,
        tenantMix,
        amendmentBreakdown,
        leaseComponentBreakdown,
        avgFxRate,
        avgEscalation,
        currency,
        nonEnergyLabel,
        electricityLabel,
        dieselLabel,
        amendmentLabel,
        regionCounts,
        topRegion,
        topRegionCount,
        gridCount,
        offGridCount,
        // AI detailed forensic data
        customerCounts,
        siteStatusCounts,
        siteTypeCounts,
        siteAmdCounts,
        totalDiscounts,
        amdBaseEnergy,
        amdBaseNonEnergy,
        rentFreeAudit: Array.from(new Set(rentFreeAudit)), // uniq list
        multiAmdSiteCount: Object.values(siteAmdCounts).filter(c => c > 1).length
    };
};

const ReportView = ({ invoice, onBack }) => {
    const data = invoice.data || [];
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 100;
    
    // Pagination logic
    const indexOfLastRow = currentPage * rowsPerPage;
    const indexOfFirstRow = indexOfLastRow - rowsPerPage;
    const currentRows = data.slice(indexOfFirstRow, indexOfLastRow);
    const totalPages = Math.ceil(data.length / rowsPerPage);

    const m = React.useMemo(() => calculateDetailedMetrics(data), [data]);

    const handleNextPage = () => {
        if (currentPage < totalPages) setCurrentPage(currentPage + 1);
    };

    const handlePrevPage = () => {
        if (currentPage > 1) setCurrentPage(currentPage - 1);
    };

    const [summary, setSummary] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [deepLayerSupplementEnabled, setDeepLayerSupplementEnabled] = useState(readDeepLayerSupplementPref);

    const persistDeepLayerPref = (on) => {
        setDeepLayerSupplementEnabled(on);
        try {
            localStorage.setItem(DEEP_LAYER_LS_KEY, on ? '1' : '0');
        } catch (_) {}
    };

    // Optimized headers extraction
    const headers = React.useMemo(() => {
        const headerSet = new Set();
        if (data.length > 0) {
            Object.keys(data[0]).forEach(key => headerSet.add(key));
        }
        return Array.from(headerSet);
    }, [data]);

    const generateAnalysis = async () => {
        setIsAnalyzing(true);
        try {
            const storedKey = getOpenAIKey();
            
            if (!storedKey) {
                // High-quality local fallback if no key is present
                setTimeout(() => {
                            const totalEnergy = m.totalEnergy || (m.totalElectricity + m.totalDiesel);
                            const gridSharePct = totalEnergy ? (m.totalElectricity / totalEnergy) * 100 : 0;
                            const dieselSharePct = totalEnergy ? (m.totalDiesel / totalEnergy) * 100 : 0;
                            const backBillRatePct = m.totalRecords ? (m.backBillCount / m.totalRecords) * 100 : 0;
                            const rentFreeRatePct = m.totalRecords ? (m.rentFreeCount / m.totalRecords) * 100 : 0;
                            const amendmentSharePct = m.grandTotal ? (Math.abs(m.totalAmendment) / m.grandTotal) * 100 : 0;
                            const offGridRatePct = m.totalRecords ? (m.offGridCount / m.totalRecords) * 100 : 0;

                            const topRegions = topEntries(m.regionCounts, 5);
                            const topAmendments = topAbsEntries(m.amendmentBreakdown, 5);
                            const topLeaseComponents = topAbsEntries(m.leaseComponentBreakdown, 5);
                            const topTenants = topEntries(m.tenantMix, 5);

                            const verdictScore =
                                (backBillRatePct > 5 ? 2 : 0) +
                                (rentFreeRatePct > 2 ? 2 : 0) +
                                (amendmentSharePct > 3 ? 2 : 0) +
                                (offGridRatePct > 20 ? 1 : 0);
                            const verdict = verdictScore >= 4 ? 'High Volatility' : (verdictScore >= 2 ? 'Moderate Risk' : 'Stable');

                            const formatAmt = (n) => {
                                const x = parseFloat(n);
                                if (isNaN(x)) return '0.00';
                                return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            };

                            const topRegionsHtml = topRegions.length
                                ? topRegions.map(([reg, count]) => `
                                    <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.05);">
                                        <span style="color:#94a3b8; font-family:monospace;">${reg}</span>
                                        <span style="font-weight:700; color:white;">${count} Sites</span>
                                    </div>
                                `).join('')
                                : `No notable signals detected from the provided summary for this section.`;

                            const topAmendmentsHtml = topAmendments.length
                                ? topAmendments.map(([item, amount]) => `
                                    <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                                        <span style="color:#cbd5e1; font-weight:700;">${item}</span>
                                        <span style="color:${amount > 0 ? '#f87171' : '#10b981'}; font-weight:800;">${m.currency} ${formatAmt(amount)}</span>
                                    </div>
                                `).join('')
                                : `No notable signals detected from the provided summary for this section.`;

                            const topLeaseComponentsHtml = topLeaseComponents.length
                                ? topLeaseComponents.map(([component, amount]) => `
                                    <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                                        <span style="color:#cbd5e1; font-weight:700;">${component}</span>
                                        <span style="color:${amount > 0 ? '#f87171' : '#10b981'}; font-weight:800;">${m.currency} ${formatAmt(amount)}</span>
                                    </div>
                                `).join('')
                                : `No notable signals detected from the provided summary for this section.`;

                            const topTenantsHtml = topTenants.length
                                ? topTenants.map(([tenant, count]) => `
                                    <div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
                                        <span style="color:#cbd5e1; font-weight:700;">${tenant}</span>
                                        <span style="color:#94a3b8; font-weight:800;">${count} sites</span>
                                    </div>
                                `).join('')
                                : `No notable signals detected from the provided summary for this section.`;

                            const text = `
<div style="font-family: 'Inter', sans-serif; animation: fadeIn 0.45s ease-out;">
    <div style="margin-bottom: 18px; padding: 16px; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 14px;">
        <p style="color: #c7d2fe; font-size: 0.9rem; line-height: 1.5; font-weight: 700;">
            Offline forensic summary generated from your invoice metrics (no OpenAI API key).
        </p>
    </div>

    <h3 style="color: var(--primary); margin-bottom: 12px;">Executive Forensic Summary</h3>
    <div style="padding: 18px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; margin-bottom: 22px;">
        <div style="display:flex; flex-wrap:wrap; gap:18px; margin-bottom: 10px;">
            <div style="min-width: 240px;">
                <div style="color:#94a3b8; text-transform:uppercase; font-size:0.75rem; font-weight:800; letter-spacing:1px;">Total Payable</div>
                <div style="font-size:1.25rem; font-weight:900; color: #e2e8f0;">${m.currency} ${formatAmt(m.grandTotal)}</div>
                <div style="color:#94a3b8; font-size:0.85rem; margin-top:6px;">Across ${m.uniqueSites.size} sites / ${m.totalRecords} lines</div>
            </div>
            <div style="min-width: 240px;">
                <div style="color:#94a3b8; text-transform:uppercase; font-size:0.75rem; font-weight:800; letter-spacing:1px;">Energy Split</div>
                <div style="font-size:1.05rem; font-weight:900; color:#fbbf24;">Grid: ${gridSharePct.toFixed(1)}%</div>
                <div style="font-size:1.05rem; font-weight:900; color:#f87171;">Diesel: ${dieselSharePct.toFixed(1)}%</div>
            </div>
        </div>
        <p style="color:#cbd5e1; line-height:1.7; margin: 10px 0;">
            Key risk flags: back-billing rate is <span style="color:#f87171; font-weight:900;">${backBillRatePct.toFixed(1)}%</span>, rent-free rate is <span style="color:#f87171; font-weight:900;">${rentFreeRatePct.toFixed(1)}%</span>, and amendment share is <span style="color:#f87171; font-weight:900;">${amendmentSharePct.toFixed(2)}%</span> of total payable.
            Operationally, off-grid exposure is <span style="color:#f87171; font-weight:900;">${offGridRatePct.toFixed(1)}%</span> of records.
        </p>
        <p style="color:#cbd5e1; line-height:1.7; margin: 10px 0;">
            <strong>Forensic Verdict:</strong> <span style="color:${verdict === 'Stable' ? '#10b981' : (verdict === 'Moderate Risk' ? '#f59e0b' : '#ef4444')}; font-weight:900;">${verdict}</span>. Expect ledger volatility when amendments and back-bills cluster around the same sites/months.
        </p>
    </div>

    <h3 style="color: var(--primary); margin-bottom: 12px;">Leakage Detection</h3>
    <div style="padding: 18px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; margin-bottom: 22px;">
        <ul style="margin-left: 18px; color:#e2e8f0; line-height:1.75;">
            <li>
                <strong>Back-billing:</strong> ${m.backBillCount} flagged instances (${backBillRatePct.toFixed(1)}% of ${m.totalRecords} lines).
                <div style="color:#cbd5e1; margin-top:4px;">Why it matters: back-billing indicates retroactive corrections that distort month-to-month OPEX visibility.</div>
                <div style="color:#cbd5e1; margin-top:4px;">Ledger check: verify 'BACK_BILL_MONTH' / 'BACK_BILL_DATE' for affected sites and reconcile against the correct invoice period.</div>
            </li>
            <li style="margin-top:10px;">
                <strong>Rent-free sites:</strong> ${m.rentFreeCount} records (${rentFreeRatePct.toFixed(1)}%).
                <div style="color:#cbd5e1; margin-top:4px;">Why it matters: rent-free mix can mask true tenancy economics (especially when paired with amendments).</div>
                <div style="color:#cbd5e1; margin-top:4px;">Ledger check: confirm 'RENT_FREE_PERIOD' criteria and ensure rent is not zeroed due to classification mismatch.</div>
            </li>
            <li style="margin-top:10px;">
                <strong>Amendment load:</strong> ${m.totalAmendment < 0 ? 'net reduction' : 'net increase'} of ${m.currency} ${formatAmt(m.totalAmendment)} (amendment share ${amendmentSharePct.toFixed(2)}%).
                <div style="color:#cbd5e1; margin-top:4px;">Why it matters: large amendment share suggests either pricing corrections, FX remeasurement, or retroactive component changes.</div>
                <div style="color:#cbd5e1; margin-top:4px;">Ledger check: cross-check top 'AMENDMENT_ITEM' and 'AMENDMENT_AMOUNT' rows for the same 'SITE_ID' + period.</div>
            </li>
            <li style="margin-top:10px;">
                <strong>Off-grid exposure:</strong> ${m.offGridCount} records (${offGridRatePct.toFixed(1)}%).
                <div style="color:#cbd5e1; margin-top:4px;">Why it matters: off-grid / diesel intensity increases operational leakage during grid instability, impacting forecasting.</div>
                <div style="color:#cbd5e1; margin-top:4px;">Ledger check: validate 'GRID_STATUS' / 'PowerSource' mapping and review diesel-related component lines ('AMOUNT_DIESEL').</div>
            </li>
        </ul>
    </div>

    <h3 style="color: var(--primary); margin-bottom: 12px;">Regional Risk</h3>
    <div style="padding: 18px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; margin-bottom: 22px;">
        <p style="color:#cbd5e1; line-height:1.7;">
            Your highest concentration is in <strong>${m.topRegion}</strong> with <strong>${m.topRegionCount}</strong> sites (top region concentration).
            When energy mix includes a meaningful diesel share (${dieselSharePct.toFixed(1)}%) or off-grid exposure (${offGridRatePct.toFixed(1)}%), regional grid variability can amplify OPEX surprises.
        </p>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px;">
            <div style="padding: 14px; border-radius: 14px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05);">
                <div style="color:#94a3b8; text-transform:uppercase; font-size:0.75rem; font-weight:800; letter-spacing:1px; margin-bottom:10px;">Top regions by site count</div>
                ${topRegionsHtml}
            </div>
            <div style="padding: 14px; border-radius: 14px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05);">
                <div style="color:#94a3b8; text-transform:uppercase; font-size:0.75rem; font-weight:800; letter-spacing:1px; margin-bottom:10px;">Ledger checks (2-3)</div>
                <ul style="margin-left:18px; margin-top: 8px; color:#e2e8f0; line-height:1.7;">
                    <li>For ${m.topRegion}: compare 'AMOUNT_ELECTRICITY' vs 'AMOUNT_DIESEL' and watch for sudden diesel spikes.</li>
                    <li>Filter by 'BACK_BILL_MONTH' for sites in top regions; locate back-bill clustering.</li>
                    <li>Audit amendment items most common in the same region—focus on 'AMENDMENT_ITEM' that correlate with energy component changes.</li>
                </ul>
            </div>
        </div>
    </div>

    <h3 style="color: var(--primary); margin-bottom: 12px;">Lease & Amendment Drivers</h3>
    <div style="padding: 18px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px; margin-bottom: 22px;">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 16px;">
            <div style="padding: 14px; border-radius: 14px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05);">
                <div style="color:#94a3b8; text-transform:uppercase; font-size:0.75rem; font-weight:800; letter-spacing:1px; margin-bottom:10px;">Top Amendment Items (ranked)</div>
                ${topAmendmentsHtml}
                <p style="color:#cbd5e1; line-height:1.7; margin-top:10px; font-size:0.95rem;">
                    Interpretation: these items dominate the amendment magnitude, so they are likely the main source of invoice corrections.
                    Verify whether changes reflect pricing renegotiation, FX remeasurement, or contract retro adjustments.
                </p>
                <ul style="margin-left:18px; margin-top: 8px; color:#e2e8f0; line-height:1.7;">
                    <li>Cross-check 'AMENDMENT_PERC_TO_APPLY' and 'CUMULATIVE_ESCALATION' around the same invoice period.</li>
                    <li>Review 'AMENDMENT_AMOUNT' by 'SITE_ID' for concentration (few sites causing most of the delta).</li>
                </ul>
            </div>
            <div style="padding: 14px; border-radius: 14px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05);">
                <div style="color:#94a3b8; text-transform:uppercase; font-size:0.75rem; font-weight:800; letter-spacing:1px; margin-bottom:10px;">Top Lease Components (ranked)</div>
                ${topLeaseComponentsHtml}
                <p style="color:#cbd5e1; line-height:1.7; margin-top:10px; font-size:0.95rem;">
                    Interpretation: lease component concentration points to where base pricing or tenancy structure changes are impacting total OPEX.
                    A high component share often aligns with consistent amendment patterns across the period.
                </p>
                <ul style="margin-left:18px; margin-top: 8px; color:#e2e8f0; line-height:1.7;">
                    <li>Confirm 'LEASE_RATE_COMPONENT' mapping and ensure component taxonomies are consistent across months.</li>
                    <li>Check if off-grid / diesel exposure coincides with the same lease component lines.</li>
                </ul>
            </div>
        </div>

        <div style="margin-top: 16px; padding: 14px; border-radius: 14px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05);">
            <div style="color:#94a3b8; text-transform:uppercase; font-size:0.75rem; font-weight:800; letter-spacing:1px; margin-bottom:10px;">Anchor Tenants (top by count)</div>
            ${topTenantsHtml}
            <p style="color:#cbd5e1; line-height:1.7; margin-top:10px; font-size:0.95rem;">
                Interpretation: anchor tenants represent repeated billing contexts; if leakage signals cluster here, the operational issue is likely contractual or classification-driven.
                Use this list to prioritize ledger drill-down.
            </p>
            <ul style="margin-left:18px; margin-top: 8px; color:#e2e8f0; line-height:1.7;">
                <li>Drill into the top tenant sites and verify 'TENANCY_CLASSIFICATION_SITE_BILLING_TYPE' and rent-free rules.</li>
                <li>Check whether these sites are overrepresented in back-bill rows.</li>
            </ul>
        </div>
    </div>

    <h3 style="color: var(--primary); margin-bottom: 12px;">Optimization Suggestions & Next Steps</h3>
    <div style="padding: 18px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 16px;">
        <ol style="margin-left: 18px; color:#e2e8f0; line-height:1.75;">
            <li>Reconcile back-billing: review 'BACK_BILL_MONTH' for the ${m.backBillCount} flagged instances and match them to the correct invoice period.</li>
            <li>Validate rent-free criteria: sample ${m.rentFreeCount} rent-free records and confirm 'RENT_FREE_PERIOD' logic is correctly mapped.</li>
            <li>Isolate amendment drivers: pull the ledger rows for the top amendment items above and confirm whether the deltas are contractual, pricing, or FX/esc updates.</li>
            <li>Sanity-check energy mix: compare diesel share (${dieselSharePct.toFixed(1)}%) vs off-grid rate (${offGridRatePct.toFixed(1)}%) and verify 'GRID_STATUS' mapping.</li>
            <li>Check regional concentration: prioritize investigation in <strong>${m.topRegion}</strong> (top region) and verify energy leakage + amendment items move together.</li>
            <li>Audit tenant concentration: focus on anchor tenants (top list) where leakage signals cluster; validate tenancy classification and billing type rules.</li>
            <li>Cross-check escalation: use FX/escalation signals (avg values) to confirm whether amendments align with expected rate movements.</li>
            <li>After adjustments, re-run the ledger metrics to ensure amendment share and back-billing rate reduce for the next invoice.</li>
        </ol>
    </div>
</div>
                            `.trim();
                    setSummary(text);
                    setIsAnalyzing(false);
                }, 1000);
                return;
            }

            // Real AI Analysis with OpenAI

            const totalEnergy = m.totalEnergy || (m.totalElectricity + m.totalDiesel);
            const gridSharePct = totalEnergy ? (m.totalElectricity / totalEnergy) * 100 : 0;
            const dieselSharePct = totalEnergy ? (m.totalDiesel / totalEnergy) * 100 : 0;
            const backBillRatePct = m.totalRecords ? (m.backBillCount / m.totalRecords) * 100 : 0;
            const rentFreeRatePct = m.totalRecords ? (m.rentFreeCount / m.totalRecords) * 100 : 0;
            const amendmentSharePct = m.grandTotal ? (Math.abs(m.totalAmendment) / m.grandTotal) * 100 : 0;
            const offGridRatePct = m.totalRecords ? (m.offGridCount / m.totalRecords) * 100 : 0;

            const topRegions = topEntries(m.regionCounts, 5).map(([region, count]) => ({ region, count }));
            const topAmendments = topAbsEntries(m.amendmentBreakdown, 5).map(([item, amount]) => ({ item, amount }));
            const topLeaseComponents = topAbsEntries(m.leaseComponentBreakdown, 5).map(([component, amount]) => ({ component, amount }));
            const topTenants = topEntries(m.tenantMix, 5).map(([tenant, count]) => ({ tenant, count }));

            const context = {
                invoiceName: invoice.name,
                currency: m.currency,
                totals: {
                    grandTotal: m.grandTotal,
                    totalNonEnergy: m.totalNonEnergy,
                    totalElectricity: m.totalElectricity,
                    totalDiesel: m.totalDiesel,
                    totalAmendment: m.totalAmendment,
                    uniqueSitesCount: m.uniqueSites.size,
                    totalRecords: m.totalRecords
                },
                siteMix: {
                    rooftopCount: m.rooftopCount,
                    greenfieldCount: m.greenfieldCount,
                    onAirCount: m.onAirCount,
                    multiTenancyCount: m.multiTenancyCount,
                    singleTenancyCount: m.singleTenancyCount
                },
                energyMix: {
                    totalEnergy: totalEnergy,
                    gridCount: m.gridCount,
                    offGridCount: m.offGridCount,
                    gridSharePct: gridSharePct,
                    dieselSharePct: dieselSharePct,
                    offGridRatePct: offGridRatePct
                },
                leakageSignals: {
                    backBillCount: m.backBillCount,
                    backBillRatePct: backBillRatePct,
                    rentFreeCount: m.rentFreeCount,
                    rentFreeRatePct: rentFreeRatePct,
                    amendmentSharePct: amendmentSharePct
                },
                regionalRisk: {
                    topRegion: m.topRegion,
                    topRegionCount: m.topRegionCount,
                    topRegions
                },
                drivers: {
                    topAmendments,
                    topLeaseComponents,
                    topTenants,
                    avgFxRate: m.avgFxRate,
                    avgEscalation: m.avgEscalation
                }
            };

            const prompt = `
You are iBill Forensic Audit Brain. Write a very detailed forensic explanation of the whole invoice for a business user.

CONTEXT_JSON (Source of Truth): 
${JSON.stringify(context)}

OUTPUT RULES:
- Return ONLY CLEAN HTML fragment (ABSOLUTELY NO MARKDOWN CODE BLOCKS).
- Present findings using a formal, forensic tone.
- Start by writing these sections in order using EXACT heading text:
  1) <h3 style="color: var(--primary)">Executive Forensic Summary</h3>
  2) <h3 style="color: var(--primary)">Complete Cost Breakdown</h3>
  3) <h3 style="color: var(--primary)">Operational View of the Invoice</h3>
  4) <h3 style="color: var(--primary)">Leakage, Exceptions, and Risk Signals</h3>
  5) <h3 style="color: var(--primary)">Region and Site Concentration Story</h3>
  6) <h3 style="color: var(--primary)">Driver-Level Explanation (Amendments, Lease Components, Tenants)</h3>
  7) <h3 style="color: var(--primary)">What This Means for the Business</h3>
  8) <h3 style="color: var(--primary)">Recommended Validation Checklist</h3>
- Highlight key numbers with <span style="color:#f87171;font-weight:800">...</span>.
- Finish with 10 concrete audit actions.
`;

            // 1. Initial Local Report (Guaranteed coverage)
            const localText = generateLocalSingleSummary(m, invoice.name);

            if (deepLayerSupplementEnabled) {
                setSummary(localText + getDeepLayerPendingHtml());
            } else {
                setSummary(localText);
            }
            setIsAnalyzing(false);

            if (!deepLayerSupplementEnabled) {
                return;
            }

            try {
                const result = await fetchOpenAIChatCompletion({
                    apiKey: storedKey,
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    maxTokens: 2000,
                    temperature: 0.1,
                    topP: 0.85
                });

                let aiText = result?.choices?.[0]?.message?.content || '';
                aiText = aiText.replace(/^```html\n?|```$/g, '').replace(/^```\n?|```$/g, '').trim();

                const combined = `${localText}${wrapDeepLayerSupplementSection(aiText)}`;
                setSummary(combined);
            } catch (openaiErr) {
                console.warn("AI Engine Quota/Error. Local summary remains active.", openaiErr);
                const errNote = `<p style="color:#94a3b8; margin:0; line-height:1.6;">Deep-Layer AI could not be loaded (${openaiErr.message || 'request failed'}). Your local forensic report above is complete.</p>`;
                setSummary(localText + wrapDeepLayerSupplementSection(errNote));
            }
        } catch (err) {
            setSummary(`<div style="color: #f87171;">Forensic Engine Critical Failure: ${err.message}</div>`);
        }
        setIsAnalyzing(false);
    };

    const generateLocalSingleSummary = (m, name) => {
        const totalEnergy = m.totalEnergy || (m.totalElectricity + m.totalDiesel);
        const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const curr = m.currency || '';
        const dClr = (v) => v > 0 ? '#f87171' : (v < 0 ? '#10b981' : '#cbd5e1');

        // Extract Top Details
        const topCust = Object.keys(m.customerCounts)[0] || 'N/A';
        const topStatus = Object.keys(m.siteStatusCounts)[0] || 'N/A';
        
        // Extract Top Amendments
        const sortedAmds = Object.entries(m.amendmentBreakdown)
            .sort((a,b) => Math.abs(b[1]) - Math.abs(a[1]))
            .slice(0, 5);

        return `
            <div style="font-family: 'Inter', sans-serif; animation: fadeIn 0.4s ease-out;">
                <div style="margin-bottom: 24px; padding: 18px; background: rgba(99, 102, 241, 0.08); border-left: 4px solid var(--primary); border-radius: 0 12px 12px 0;">
                    <p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.6; margin: 0;">
                        <strong>Local Forensic Intelligence Report</strong> • ${name}<br/>
                        Successfully synthesized high-precision audit metrics across 10 forensic dimensions.
                    </p>
                </div>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">1) Network Footprint & Site Reconciliation</h3>
                <ul>
                    <li><strong>Unique Sites:</strong> Detected <span style="color:#FFF;font-weight:700;">${m.uniqueSites.size}</span> distinct Site IDs within this invoice.</li>
                    <li><strong>Total Line Items:</strong> Reconciled ${m.totalRecords.toLocaleString()} billing records for the period.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">2) Customer & Site Profile (Known As)</h3>
                <ul>
                    <li><strong>Primary Customer:</strong> Top recognized customer is "${topCust}" (${m.customerCounts[topCust] || 0} records).</li>
                    <li><strong>Operational Status:</strong> Primary site status is "${topStatus}" (${m.siteStatusCounts[topStatus] || 0} sites).</li>
                    <li><strong>Site Type Mix:</strong> Rooftop count: ${m.siteTypeCounts['Rooftop'] || 0} | Greenfield count: ${m.siteTypeCounts['Greenfield'] || 0}.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">3) Lease & Rent-Free Anomaly Audit</h3>
                <ul>
                    <li><strong>Rent-Free Flag:</strong> Identified ${m.rentFreeCount} standard rent-free records on ledger.</li>
                    <li><strong>Date Anomaly Detection:</strong> Found <span style="color:#f87171;font-weight:900;">${m.rentFreeAudit.length} anomalies</span> where Lease/Rent Start Date is in the future relative to this billing month. High risk of overpayment leakage.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">4) Energy & Grid Status Exposure</h3>
                <ul>
                    <li><strong>Grid Status:</strong> Total of ${m.gridCount} Grid-powered sites vs <span style="color:#f87171;font-weight:800;">${m.offGridCount} Off-Grid sites</span> (Intensity check required).</li>
                    <li><strong>Operational Risk:</strong> Off-grid records represent ${((m.offGridCount / m.totalRecords)*100).toFixed(1)}% of total invoice lines.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">5) Amendment & Amd_Base Integrity</h3>
                <ul>
                    <li><strong>Itemized Signals:</strong> Largest amendment items: ${sortedAmds.map(([item, val]) => `<em>${item}</em> (${curr} ${fmt(val)})`).join(', ')}.</li>
                    <li><strong>Classification:</strong> Energy-based amendments: ${curr} ${fmt(m.amdBaseEnergy)} | Non-Energy based: ${curr} ${fmt(m.amdBaseNonEnergy)}.</li>
                    <li><strong>Double-Billing Risk:</strong> Detected <span style="color:#f87171;font-weight:900;">${m.multiAmdSiteCount} sites</span> with more than one amendment in this single invoice.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">6) Comprehensive Financial Bridge</h3>
                <ul>
                    <li><strong>Non-Energy Base (${m.nonEnergyLabel}):</strong> Total ${curr} ${fmt(m.totalNonEnergy)}.</li>
                    <li><strong>Energy Base (${m.electricityLabel}):</strong> Total ${curr} ${fmt(m.totalElectricity)}.</li>
                    <li><strong>Energy Base (${m.dieselLabel}):</strong> Total ${curr} ${fmt(m.totalDiesel)}.</li>
                    <li><strong>Total Discounts Applied:</strong> <span style="color:#10b981;font-weight:800;">${curr} ${fmt(m.totalDiscounts)}</span>.</li>
                    <li><strong>Total Net Payable:</strong> <span style="color:#FFF;font-weight:900;">${curr} ${fmt(m.grandTotal)}</span>.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">7) Forensic Action Items</h3>
                <ol>
                    <li>Review the ${m.rentFreeAudit.length} sites with future Lease Start Dates for immediate credit notes.</li>
                    <li>Audit the ${m.multiAmdSiteCount} sites with multiple amendments for description duplication.</li>
                    <li>Validate the "${topCust}" volume against the master tenant list.</li>
                    <li>Cross-verify the ${curr} ${fmt(m.totalDiesel)} diesel spend for the ${m.offGridCount} off-grid sites.</li>
                </ol>
            </div>
        `;
    };

    const formatCurr = (val) => {
        let n = parseFloat(val);
        if (isNaN(n)) return '0.00';
        return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const summaryContext = React.useMemo(() => ({
        module: 'single-invoice',
        invoiceName: invoice?.name || '',
        currency: m.currency,
        totals: {
            grandTotal: m.grandTotal,
            totalNonEnergy: m.totalNonEnergy,
            totalElectricity: m.totalElectricity,
            totalDiesel: m.totalDiesel,
            totalAmendment: m.totalAmendment,
            uniqueSites: m.uniqueSites,
            totalRecords: m.totalRecords
        },
        topRegions: topEntries(m.regionCounts, 5).map(([region, count]) => ({ region, count })),
        topAmendments: topAbsEntries(m.amendmentBreakdown, 5).map(([item, amount]) => ({ item, amount })),
        topLeaseComponents: topAbsEntries(m.leaseComponentBreakdown, 5).map(([component, amount]) => ({ component, amount })),
        topTenants: topEntries(m.tenantMix, 5).map(([tenant, count]) => ({ tenant, count }))
    }), [invoice, m]);

    return (
        <div id="single-invoice-report" className="report-container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <FileSpreadsheet className="text-primary" size={18} />
                        <span style={{ fontSize: '0.75rem', fontWeight: '800', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Analysis Dashboard</span>
                    </div>
                    <h1 style={{ fontSize: '2rem', fontWeight: '900', letterSpacing: '-0.5px' }}>{invoice.name}</h1>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button 
                        onClick={() => exportToPDF('single-invoice-report', `iBill_Audit_${invoice.name.replace(/\.[^/.]+$/, "")}.pdf`, { reportTitle: 'Forensic Audit Report', subtitle: invoice.name })} 
                        className="btn-primary" 
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <Download size={18} /> Export PDF
                    </button>
                    <button 
                        onClick={() => exportToExcel(invoice.data, `iBill_Audit_${invoice.name.replace(/\.[^/.]+$/, "")}.xlsx`)} 
                        className="btn-secondary" 
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <FileSpreadsheet size={18} /> Export Excel
                    </button>
                    <button onClick={onBack} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ArrowLeft size={18} /> Back to Vault
                    </button>
                </div>
            </div>

            {/* Metric Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-panel metric-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="metric-label">Total Volume</span>
                        <Building2 size={20} className="text-primary" style={{ opacity: 0.5 }} />
                    </div>
                    <div className="metric-value">{m.uniqueSites.size.toLocaleString()}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Across {m.totalRecords.toLocaleString()} invoice lines</div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-panel metric-card" style={{ borderLeft: '4px solid var(--secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="metric-label">Total Payable</span>
                        <DollarSign size={20} style={{ color: 'var(--secondary)', opacity: 0.5 }} />
                    </div>
                    <div className="metric-value" style={{ color: 'var(--secondary)' }}>{m.currency || ''} {formatCurr(m.grandTotal)}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Avg. {m.currency || ''} {formatCurr(m.uniqueSites > 0 ? m.grandTotal / m.uniqueSites : 0)}/site</div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="glass-panel metric-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="metric-label">Energy Exposure</span>
                        <Zap size={20} className="text-primary" style={{ opacity: 0.5 }} />
                    </div>
                    <div className="metric-value">{m.currency || ''} {formatCurr(m.totalEnergy)}</div>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '0.75rem', fontWeight: 'bold' }}>
                        <span style={{ color: '#fbbf24' }}>Grid: {m.totalEnergy > 0 ? formatCurr((m.totalElectricity / m.totalEnergy) * 100) : '0.00'}%</span>
                        <span style={{ color: '#f87171' }}>Diesel: {m.totalEnergy > 0 ? formatCurr((m.totalDiesel / m.totalEnergy) * 100) : '0.00'}%</span>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="glass-panel metric-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="metric-label">Regional Hub</span>
                        <MapPin size={20} className="text-primary" style={{ opacity: 0.5 }} />
                    </div>
                    <div className="metric-value">{m.topRegion}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{m.topRegionCount} sites in this zone</div>
                </motion.div>
            </div>

            <div style={{ display: 'flex', gap: '20px', marginBottom: '32px', alignItems: 'flex-start' }}>
               <div style={{ flex: 1 }}>
                    <label
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '12px',
                            cursor: isAnalyzing ? 'default' : 'pointer',
                            fontSize: '0.88rem',
                            color: 'var(--text-dim)',
                            marginBottom: '14px',
                            lineHeight: 1.5
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={deepLayerSupplementEnabled}
                            onChange={(e) => persistDeepLayerPref(e.target.checked)}
                            disabled={isAnalyzing}
                            style={{ marginTop: '3px', width: '16px', height: '16px', accentColor: 'var(--primary)', flexShrink: 0 }}
                        />
                        <span>
                            <strong style={{ color: '#e2e8f0' }}>Include Deep-Layer AI supplement</strong>
                            <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.9, marginTop: '2px' }}>
                                Second OpenAI request (~15–45s, extra cost). Uncheck to use only the fast local report.
                            </span>
                        </span>
                    </label>
                    {!summary && (
                        <button onClick={generateAnalysis} className="btn-primary" disabled={isAnalyzing} style={{ width: '100%', justifyContent: 'center', padding: '16px' }}>
                            {isAnalyzing ? (
                                <><div className="animate-spin"><Radio size={20} /></div> Calibrating Heuristics...</>
                            ) : (
                                <>✨ Perform Deep Forensic Audit</>
                            )}
                        </button>
                    )}
                    <AnimatePresence>
                        {summary && (
                            <>
                                <motion.div 
                                    initial={{ opacity: 0, scale: 0.98 }} 
                                    animate={{ opacity: 1, scale: 1 }} 
                                    className="glass-panel" 
                                    style={{ padding: '30px', borderLeft: '4px solid var(--primary)', background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.05) 0%, transparent 100%)' }}
                                >
                                    <div className="invoice-summary-content" style={{ color: '#e2e8f0', fontSize: '1rem' }} dangerouslySetInnerHTML={{ __html: summary }} />
                                    <style>{`
                                      .invoice-summary-content h3 { margin: 16px 0 10px; }
                                      .invoice-summary-content p { margin: 8px 0; line-height: 1.55; }
                                      .invoice-summary-content ul, .invoice-summary-content ol { margin: 8px 0 12px; padding-left: 20px; }
                                      .invoice-summary-content li { margin: 4px 0; line-height: 1.45; }
                                      .invoice-summary-content div { line-height: 1.55; }
                                    `}</style>
                                    <button onClick={() => setSummary(null)} style={{ marginTop: '20px', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline' }}>Dismiss Audit</button>
                                </motion.div>
                                <SummaryQnA
                                    title="Invoice Summary Q&A"
                                    summaryHtml={summary}
                                    contextType="single"
                                    contextPayload={summaryContext}
                                    invoiceData={data}
                                    invoiceKey={invoice?.id || invoice?.name || 'single'}
                                />
                            </>
                        )}
                    </AnimatePresence>
               </div>
            </div>

            {/* Visual Analytics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="glass-panel" style={{ padding: '24px', height: '380px' }}>
                    <h3 style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '24px', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '800' }}>Opex Segmentation</h3>
                    <ResponsiveContainer width="100%" height="80%">
                        <PieChart>
                            <Pie
                                data={[
                                    ...(m.totalNonEnergy > 0 ? [{ name: m.nonEnergyLabel || 'Non-Energy Charges', value: m.totalNonEnergy }] : []),
                                    ...(m.totalElectricity > 0 ? [{ name: m.electricityLabel || 'Electricity / Grid', value: m.totalElectricity }] : []),
                                    ...(m.totalDiesel > 0 ? [{ name: m.dieselLabel || 'Diesel / Generator', value: m.totalDiesel }] : []),
                                    ...(m.totalAmendment !== 0 ? [{ name: m.amendmentLabel || 'Amendments / Adjustments', value: Math.abs(m.totalAmendment) }] : [])
                                ].filter(d => d.value > 0)}
                                cx="50%" cy="50%" innerRadius={70} outerRadius={100} paddingAngle={8} dataKey="value"
                                stroke="none"
                            >
                                <Cell fill="#6366f1" />
                                <Cell fill="#fbbf24" />
                                <Cell fill="#f87171" />
                                <Cell fill="#94a3b8" />
                            </Pie>
                            <Tooltip 
                                contentStyle={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', backdropFilter: 'blur(8px)' }} 
                                itemStyle={{ color: '#fff', fontSize: '0.85rem' }}
                                formatter={(val) => `${m.currency || ''} ${val.toLocaleString()}`}
                            />
                            <Legend verticalAlign="bottom" height={36}/>
                        </PieChart>
                    </ResponsiveContainer>
                </motion.div>

                <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="glass-panel" style={{ padding: '24px', height: '380px' }}>
                    <h3 style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '24px', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '800' }}>
                        {Object.keys(m.regionCounts).length > 0 ? 'Regional Distribution' : 'No Regional Data Detected'}
                    </h3>
                    <ResponsiveContainer width="100%" height="80%">
                        <BarChart data={Object.entries(m.regionCounts).map(([k, v]) => ({ name: k, count: v })).sort((a,b) => b.count - a.count).slice(0, 6)}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis hide />
                            <Tooltip 
                                cursor={{fill: 'rgba(255,255,255,0.02)'}}
                                contentStyle={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', backdropFilter: 'blur(8px)' }}
                                itemStyle={{ color: '#fff', fontSize: '0.85rem' }}
                            />
                            <Bar dataKey="count" fill="url(#barGradient)" radius={[8, 8, 0, 0]} barSize={40} />
                            <defs>
                                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#6366f1" />
                                    <stop offset="100%" stopColor="#818cf8" />
                                </linearGradient>
                            </defs>
                        </BarChart>
                    </ResponsiveContainer>
                </motion.div>
            </div>

            <div className="glass-panel" style={{ padding: '24px' }}>
                <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: '800' }}>Line Item Ledger</h3>
                     <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <button onClick={handlePrevPage} disabled={currentPage === 1} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem', opacity: currentPage === 1 ? 0.3 : 1 }}>Prev</button>
                        <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-dim)' }}>Page {currentPage} of {totalPages}</span>
                        <button onClick={handleNextPage} disabled={currentPage === totalPages} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem', opacity: currentPage === totalPages ? 0.3 : 1 }}>Next</button>
                    </div>
                </div>
                
                {data.length > 0 ? (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '1000px' }}>
                            <thead style={{ backgroundColor: 'rgba(15, 23, 42, 0.8)' }}>
                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                    <th style={{ padding: '15px', color: 'var(--primary)', fontWeight: '600', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        S.No.
                                    </th>
                                    {headers.map((header, idx) => (
                                        <th key={idx} style={{ padding: '15px', color: 'var(--primary)', fontWeight: '600', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            {header}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {currentRows.map((row, index) => {
                                    const actualRowIdx = indexOfFirstRow + index;
                                    return (
                                        <tr key={actualRowIdx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', backgroundColor: index % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', transition: 'background-color 0.2s' }} className="table-row-hover">
                                            <td style={{ padding: '12px 15px', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 'bold' }}>
                                                {actualRowIdx + 1}
                                            </td>
                                            {headers.map((header, colIdx) => (
                                                <td key={colIdx} style={{ padding: '12px 15px', fontSize: '0.85rem', color: '#e2e8f0', whiteSpace: 'nowrap' }}>
                                                    {formatValueWithDates(row[header], header)}
                                                </td>
                                            ))}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                        <FileSpreadsheet size={48} style={{ margin: '0 auto 20px', opacity: 0.5 }} />
                        <p>No data records found in this invoice.</p>
                    </div>
                )}
            </div>

            <div style={{ marginTop: '30px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
                 <button onClick={handlePrevPage} disabled={currentPage === 1} className="btn-secondary" style={{ opacity: currentPage === 1 ? 0.5 : 1 }}>&larr; Previous Page</button>
                 <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Page {currentPage} of {totalPages}</span>
                 <button onClick={handleNextPage} disabled={currentPage === totalPages} className="btn-secondary" style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}>Next Page &rarr;</button>
            </div>

            <div style={{ marginTop: '40px', display: 'flex', gap: '20px', justifyContent: 'center' }}>
                <button onClick={onBack} className="btn-primary">Upload Another Invoice</button>
            </div>
            
            <style>{`
                table th, table td { border: none; }
                .table-row-hover:hover { background-color: rgba(99, 102, 241, 0.1) !important; }
                
                /* Custom Scrollbar for table container */
                .glass-card::-webkit-scrollbar { width: 8px; height: 8px; }
                .glass-card::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); border-radius: 4px; }
                .glass-card::-webkit-scrollbar-thumb { background: rgba(99, 102, 241, 0.5); border-radius: 4px; }
                .glass-card::-webkit-scrollbar-thumb:hover { background: rgba(99, 102, 241, 0.8); }
            `}</style>
        </div>
    );
};

const CompareInvoices = ({ onBack, onDeepCompare }) => {
    const [invoiceA, setInvoiceA] = useState(null);
    const [invoiceB, setInvoiceB] = useState(null);
    const [error, setError] = useState(null);

    const handleFileUpload = (e, target) => {
        try {
            setError(null);
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const bstr = evt.target.result;
                    const wb = XLSX.read(bstr, { type: 'binary' });
                    const wsname = wb.SheetNames[0];
                    if (!wsname) throw new Error("Empty file or unreadable sheet.");
                    const ws = wb.Sheets[wsname];
                    const data = XLSX.utils.sheet_to_json(ws);
                    
                    if (!data || data.length === 0) throw new Error("No data records found in " + file.name);

                    const invoiceObj = {
                        id: Date.now().toString(),
                        name: file.name,
                        data: data
                    };
                    if (target === 'A') setInvoiceA(invoiceObj);
                    else setInvoiceB(invoiceObj);
                } catch (err) {
                    setError(err.message || "Failed to parse " + file.name);
                }
            };
            reader.onerror = () => setError("Error reading " + file.name);
            reader.readAsBinaryString(file);
        } catch (err) {
            setError("Upload error occurred.");
        }
    };

    // Performance Optimization: Cache Metrics
    const metricsA = React.useMemo(() => invoiceA ? calculateDetailedMetrics(invoiceA.data) : null, [invoiceA]);
    const metricsB = React.useMemo(() => invoiceB ? calculateDetailedMetrics(invoiceB.data) : null, [invoiceB]);

    const sitesA = metricsA?.uniqueSites || new Set();
    const sitesB = metricsB?.uniqueSites || new Set();
    const commonSites = [...sitesA].filter(id => sitesB.has(id));
    const onlyA = [...sitesA].filter(id => !sitesB.has(id));
    const onlyB = [...sitesB].filter(id => !sitesA.has(id));

    const [summary, setSummary] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [showFootprintModal, setShowFootprintModal] = useState(false);
    const [deepLayerSupplementEnabled, setDeepLayerSupplementEnabled] = useState(readDeepLayerSupplementPref);

    const persistDeepLayerPref = (on) => {
        setDeepLayerSupplementEnabled(on);
        try {
            localStorage.setItem(DEEP_LAYER_LS_KEY, on ? '1' : '0');
        } catch (_) {}
    };
    
    const compareSummaryContext = React.useMemo(() => {
        if (!sitesA.size || !sitesB.size || !invoiceA || !invoiceB) return null;
        return {
            module: 'invoice-comparison',
            invoiceA: {
                name: invoiceA.name,
                currency: metricsA.currency,
                grandTotal: metricsA.grandTotal,
                uniqueSitesCount: sitesA.size
            },
            invoiceB: {
                name: invoiceB.name,
                currency: metricsB.currency,
                grandTotal: metricsB.grandTotal,
                uniqueSitesCount: sitesB.size
            },
            reconciliation: {
                common: commonSites.length,
                onlyA: onlyA.length,
                onlyB: onlyB.length
            },
            topRegionsDelta: topDeltaAbsEntries(metricsA.regionCounts, metricsB.regionCounts, 5).map(([region, delta]) => ({ region, delta })),
            topAmendmentDeltas: topDeltaAbsEntries(metricsA.amendmentBreakdown, metricsB.amendmentBreakdown, 5).map(([item, delta]) => ({ item, delta })),
            topLeaseComponentDeltas: topDeltaAbsEntries(metricsA.leaseComponentBreakdown, metricsB.leaseComponentBreakdown, 5).map(([component, delta]) => ({ component, delta }))
        };
    }, [metricsA, metricsB, invoiceA, invoiceB, commonSites, onlyA, onlyB, sitesA, sitesB]);

    if (!invoiceA || !invoiceB) {
        return (
            <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px' }}>
                <div style={{ marginBottom: '40px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <Scale className="text-primary" size={20} />
                        <span style={{ fontSize: '0.8rem', fontWeight: '800', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Reconciliation Workspace</span>
                    </div>
                    <h1 style={{ fontSize: '2.5rem', fontWeight: '900', letterSpacing: '-1px' }}>Compare Invoices</h1>
                    <p style={{ color: 'var(--text-dim)', marginTop: '8px' }}>Select two disparate datasets for a side-by-side forensic delta analysis.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '40px' }}>
                    {[ {t: 'A', obj: invoiceA}, {t: 'B', obj: invoiceB}].map((slot, i) => (
                        <div key={i} className="glass-panel" style={{ padding: '60px 40px', textAlign: 'center', borderStyle: slot.obj ? 'solid' : 'dashed', borderColor: slot.obj ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }}>
                            {slot.obj ? (
                                <>
                                    <div style={{ width: '64px', height: '64px', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: 'var(--primary)' }}>
                                        <FileSpreadsheet size={32} />
                                    </div>
                                    <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>{slot.obj.name}</h3>
                                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{slot.obj.data.length.toLocaleString()} items synchronized</p>
                                    <button onClick={() => slot.t === 'A' ? setInvoiceA(null) : setInvoiceB(null)} className="btn-secondary" style={{ marginTop: '24px' }}>Change File</button>
                                </>
                            ) : (
                                <label style={{ cursor: 'pointer' }}>
                                    <div style={{ width: '64px', height: '64px', background: 'rgba(255,255,255,0.03)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: 'var(--text-dim)' }}>
                                        <UploadCloud size={32} />
                                    </div>
                                    <h3 style={{ fontSize: '1.25rem', marginBottom: '8px' }}>Select Invoice {slot.t === 'A' ? '1' : '2'}</h3>
                                    <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Drag or click to upload</p>
                                    <input type="file" onChange={(e) => handleFileUpload(e, slot.t)} style={{ display: 'none' }} />
                                </label>
                            )}
                        </div>
                    ))}
                </div>
                <button onClick={onBack} className="btn-secondary" style={{ width: '100%' }}>Back to Dashboard</button>
            </motion.div>
        );
    }


    const formatCurr = (val) => {
        let n = parseFloat(val);
        if (isNaN(n)) return '0.00';
        return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };
    const generateAnalysis = async () => {
        setIsAnalyzing(true);
        try {
            const storedKey = getOpenAIKey();
            if (!storedKey) {
                throw new Error("Audit key missing. Please set your OpenAI API key to run forensic analysis.");
            }

            const totalEnergyA = metricsA.totalEnergy || (metricsA.totalElectricity + metricsA.totalDiesel);
            const totalEnergyB = metricsB.totalEnergy || (metricsB.totalElectricity + metricsB.totalDiesel);

            const backBillRatePctA = metricsA.totalRecords ? (metricsA.backBillCount / metricsA.totalRecords) * 100 : 0;
            const backBillRatePctB = metricsB.totalRecords ? (metricsB.backBillCount / metricsB.totalRecords) * 100 : 0;
            const rentFreeRatePctA = metricsA.totalRecords ? (metricsA.rentFreeCount / metricsA.totalRecords) * 100 : 0;
            const rentFreeRatePctB = metricsB.totalRecords ? (metricsB.rentFreeCount / metricsB.totalRecords) * 100 : 0;

            const grandTotalDelta = metricsB.grandTotal - metricsA.grandTotal;
            const grandTotalDeltaPct = metricsA.grandTotal ? (grandTotalDelta / metricsA.grandTotal) * 100 : 0;

            const energyDelta = {
                [metricsA.nonEnergyLabel || 'Non-Energy']: metricsB.totalNonEnergy - metricsA.totalNonEnergy,
                [metricsA.electricityLabel || 'Electricity']: metricsB.totalElectricity - metricsA.totalElectricity,
                [metricsA.dieselLabel || 'Diesel']: metricsB.totalDiesel - metricsA.totalDiesel,
                [metricsA.amendmentLabel || 'Amendments']: metricsB.totalAmendment - metricsA.totalAmendment,
                discounts: metricsB.totalDiscounts - metricsA.totalDiscounts
            };

            const leakageDelta = {
                backBillCount: metricsB.backBillCount - metricsA.backBillCount,
                backBillRatePct: backBillRatePctB - backBillRatePctA,
                rentFreeCount: metricsB.rentFreeCount - metricsA.rentFreeCount,
                rentFreeRatePct: rentFreeRatePctB - rentFreeRatePctA,
rentFreeDateAnomalies: (metricsB.rentFreeAudit || []).length - (metricsA.rentFreeAudit || []).length
            };

            const topAmendmentDeltas = topDeltaAbsEntries(metricsA.amendmentBreakdown, metricsB.amendmentBreakdown, 8)
                .map(([item, deltaAmount]) => ({ item, deltaAmount }));
            const topLeaseComponentDeltas = topDeltaAbsEntries(metricsA.leaseComponentBreakdown, metricsB.leaseComponentBreakdown, 8)
                .map(([component, deltaAmount]) => ({ component, deltaAmount }));

            const context = {
                invoiceA: {
                    name: invoiceA.name,
                    currency: metricsA.currency,
                    uniqueSitesCount: sitesA.size,
                    grandTotal: metricsA.grandTotal,
                    customers: topEntries(metricsA.customerCounts, 5),
                    status: topEntries(metricsA.siteStatusCounts, 5),
                    types: topEntries(metricsA.siteTypeCounts, 5),
                    multiAmdSites: metricsA.multiAmdSiteCount,
                    rentFreeAnomalies: (metricsA.rentFreeAudit || []).length,
                    discounts: metricsA.totalDiscounts,
                    amdBaseExp: { energy: metricsA.amdBaseEnergy, nonEnergy: metricsA.amdBaseNonEnergy },
                    amendmentSummary: topDeltaAbsEntries(metricsA.amendmentBreakdown, metricsB.amendmentBreakdown, 10).map(([item, delta]) => ({ item, delta }))
                },
                invoiceB: {
                    name: invoiceB.name,
                    currency: metricsB.currency,
                    uniqueSitesCount: sitesB.size,
                    grandTotal: metricsB.grandTotal,
                    customers: topEntries(metricsB.customerCounts, 5),
                    status: topEntries(metricsB.siteStatusCounts, 5),
                    types: topEntries(metricsB.siteTypeCounts, 5),
                    multiAmdSites: metricsB.multiAmdSiteCount,
                    rentFreeAnomalies: (metricsB.rentFreeAudit || []).length,
                    discounts: metricsB.totalDiscounts,
                    amdBaseExp: { energy: metricsB.amdBaseEnergy, nonEnergy: metricsB.amdBaseNonEnergy },
                    amendmentSummaryStatus: topEntries(metricsB.amendmentBreakdown, 10)
                },
                deltas: {
                    grandTotalDelta,
                    grandTotalDeltaPct,
                    energyDelta,
                    leakageDelta,
                    topAmendmentDeltas: topAmendmentDeltas.slice(0, 10), // Limit to avoid prompt blowout
                    topLeaseComponentDeltas,
                    reconciliation: { common: commonSites.length, onlyA: onlyA.length, onlyB: onlyB.length },
                    customerDelta: topDeltaAbsEntries(metricsA.customerCounts, metricsB.customerCounts, 5),
                    statusDelta: topDeltaAbsEntries(metricsA.siteStatusCounts, metricsB.siteStatusCounts, 5)
                }
            };

            const prompt = `
You are the iBill Forensic Audit Intelligence. Analyze the delta between two telecom invoices (A vs B).
YOUR GOAL: Provide a HIGHLY DETAILED, 9-10 POINT DEEP DIVE audit report. Be verbose and forensic.

FOCUS ON THESE HIGH-PRIORITY DIMENSIONS (MANDATORY):

1. FINANCIAL & BASE PRICE ANALYSIS:
   - Deep dive into ${metricsA.nonEnergyLabel || 'Non-Energy'}, ${metricsA.electricityLabel || 'Electricity'}, ${metricsA.dieselLabel || 'Diesel'}.
   - Quantify movement in MWK. Explain which component is the primary driver of the ${grandTotalDelta.toLocaleString()} MWK delta.
   - Mention "discounts" specifically (A: ${metricsA.totalDiscounts} vs B: ${metricsB.totalDiscounts}).

2. AMENDMENT & AMD_BASE AUDIT (CRITICAL):
   - AMENDMENT LISTING: Detail exactly which items are new or increased. Use MWK amounts from "amendmentItems" context. (Invoice A items: ${JSON.stringify(metricsA.amendmentBreakdown)} vs Invoice B: ${JSON.stringify(metricsB.amendmentBreakdown)})
   - AMENDMENT SITE AUDIT: Compare site counts with amendments (A: ${Object.keys(metricsA.siteAmdCounts || {}).length} vs B: ${Object.keys(metricsB.siteAmdCounts || {}).length}).
   - MULTI-AMENDMENT LEAKAGE: Identify sites with >1 amendment (A: ${metricsA.multiAmdSiteCount}, B: ${metricsB.multiAmdSiteCount}). This is a priority signal.
   - ENERGY BASE RISK: Contrast Energy base amendments (${metricsA.amdBaseEnergy}) vs Non-Energy bases (${metricsA.amdBaseNonEnergy}). Explain potential billing reclassifications.

3. RENT-FREE & DATE ANOMALY INVESTIGATION:
   - FORENSIC DATE CHECK: Address any site where Lease Start Date > Bill/Backbill Month.
   - FINDINGS: Invoice A has ${(metricsA.rentFreeAudit || []).length} anomalies vs Invoice B: ${(metricsB.rentFreeAudit || []).length}.
   - Explain why this rent is invalid according to standard forensic lease rules.

4. CUSTOMER, SITE RECONCILIATION & STATUS:
   - RECONCILIATION: Discuss Site ID footprint movement. (Common: ${commonSites.length}, Only in A: ${onlyA.length}, Only in B: ${onlyB.length}). Highlight significant disposals or additions.
   - CUSTOMER SHIFT: Detail "Customer/Known As" volume shifts.
   - SITE LIFECYCLE: Analyze "Site Status" (Active/Inactive) & "Site Type" (Rooftop/Greenfield) trends.
   - POWER SOURCE: Contrast Grid vs Off-Grid site counts and sourcing trends.

CONTEXT_JSON (Source of Truth):
${JSON.stringify(context)}

OUTPUT RULES:
- Return ONLY CLEAN HTML fragment (ABSOLUTELY NO MARKDOWN CODE BLOCKS like \`\`\`html).
- Provide at least 10-15 detailed bullet points in total across the sections.
- Use EXACT heading order:
  1) <h3 style="color: var(--primary)">Financial Delta & Base Price Analysis</h3>
  2) <h3 style="color: var(--primary)">Amendment & Description Audit</h3>
  3) <h3 style="color: var(--primary)">Rent-Free & Date Anomaly Investigation</h3>
  4) <h3 style="color: var(--primary)">Customer & Site Lifecycle Shifts</h3>
  5) <h3 style="color: var(--primary)">Ranked Variance Drivers (Ranked)</h3>
  6) <h3 style="color: var(--primary)">Root Cause Forensic Hypotheses</h3>
  7) <h3 style="color: var(--primary)">Business Impact & Audit Confidence</h3>
  8) <h3 style="color: var(--primary)">12-Step Immediate Action Plan</h3>

Highlight numbers using <span style="color:#f87171;font-weight:800">...</span>.
Use <ul><li> and <ol><li>. Be formal, forensic, and precise.
`;

            // 1. Always generate the high-precision local report first (FOR GUARANTEED 10-POINT COVERAGE)
            const localReport = generateLocalComparisonSummary(metricsA, metricsB, invoiceA, invoiceB, commonSites, onlyA, onlyB);

            if (deepLayerSupplementEnabled) {
                setSummary(localReport + getDeepLayerPendingHtml());
            } else {
                setSummary(localReport);
            }
            setIsAnalyzing(false);

            if (!deepLayerSupplementEnabled) {
                return;
            }

            try {
                const result = await fetchOpenAIChatCompletion({
                    apiKey: storedKey,
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    maxTokens: 2200,
                    temperature: 0.1,
                    topP: 0.85
                });

                let aiText = result?.choices?.[0]?.message?.content || '';
                // Strip markdown code blocks
                aiText = aiText.replace(/^```html\n?|```$/g, '').replace(/^```\n?|```$/g, '').trim();

                const combinedSummary = `${localReport}${wrapDeepLayerSupplementSection(aiText)}`;
                setSummary(combinedSummary);
            } catch (openaiErr) {
                console.warn("AI Engine Rate Limit. Local report stands as primary.", openaiErr);
                const errNote = `<p style="color:#94a3b8; margin:0; line-height:1.6;">Deep-Layer AI could not be loaded (${openaiErr.message || 'request failed'}). Your local comparison report above is complete.</p>`;
                setSummary(localReport + wrapDeepLayerSupplementSection(errNote));
            }
        } catch (err) {
            setSummary(`<div style="color: #f87171;">Forensic Engine Critical Error: ${err.message}</div>`);
        }
        setIsAnalyzing(false);
    };

    const generateLocalComparisonSummary = (mA, mB, invA, invB, common, onlyA, onlyB) => {
        const grandTotalDelta = mB.grandTotal - mA.grandTotal;
        const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const dClr = (d) => d > 0 ? '#f87171' : (d < 0 ? '#10b981' : '#cbd5e1');
        const curr = mA.currency || mB.currency || '';

        // Extract Top Customer/Status Shifts
        const topCustA = Object.keys(mA.customerCounts)[0] || 'N/A';
        const topCustB = Object.keys(mB.customerCounts)[0] || 'N/A';
        
        // Extract Top Amendments
        const sortedAmds = Object.entries(mB.amendmentBreakdown)
            .sort((a,b) => Math.abs(b[1]) - Math.abs(a[1]))
            .slice(0, 5);

        return `
            <div style="font-family: 'Inter', sans-serif; animation: fadeIn 0.4s ease-out;">
                <div style="margin-bottom: 24px; padding: 18px; background: rgba(99, 102, 241, 0.08); border-left: 4px solid var(--primary); border-radius: 0 12px 12px 0;">
                    <p style="color: #cbd5e1; font-size: 0.95rem; line-height: 1.6; margin: 0;">
                        <strong>Local Forensic Intelligence Report</strong><br/>
                        Successfully synthesized audit deltas across 10 high-priority dimensions for ${invA.name} vs ${invB.name}.
                    </p>
                </div>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">1) Site Footprint & ID Reconciliation</h3>
                <ul>
                    <li><strong>Common Sites:</strong> ${common.length} Site IDs were found in both invoices.</li>
                    <li><strong>Disposals (A only):</strong> Found <span style="color:#f87171; font-weight:800;">${onlyA.length} Sites</span> that were present in A but are missing in B.</li>
                    <li><strong>New Onboarding (B only):</strong> Detected <span style="color:#10b981; font-weight:800;">${onlyB.length} new Site IDs</span> in the current B invoice.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">2) Customer & Site Lifecycle Shifts</h3>
                <ul>
                    <li><strong>Customer Shift:</strong> Top identified customer in A was "${topCustA}" vs "${topCustB}" in B.</li>
                    <li><strong>Site Status Movement:</strong> Active site count moved from ${mA.siteStatusCounts['Active'] || 0} (A) to ${mB.siteStatusCounts['Active'] || 0} (B).</li>
                    <li><strong>Site Type Mix:</strong> Rooftop count: ${mB.siteTypeCounts['Rooftop'] || 0} | Greenfield count: ${mB.siteTypeCounts['Greenfield'] || 0}.</li>
                    <li><strong>Grid Status:</strong> Found ${mB.gridCount} Grid-powered sites vs ${mB.offGridCount} Off-Grid sites in invoice B.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">3) Base Price & Total Financial Bridge</h3>
                <ul>
                    <li><strong>Non-Energy Base:</strong> Total ${mA.nonEnergyLabel || 'Rent'} delta: <span style="color:${dClr(mB.totalNonEnergy - mA.totalNonEnergy)}; font-weight:800;">${curr} ${fmt(mB.totalNonEnergy - mA.totalNonEnergy)}</span>.</li>
                    <li><strong>Energy Base (${mA.electricityLabel || 'Grid'}):</strong> Variance is ${curr} ${fmt(mB.totalElectricity - mA.totalElectricity)}.</li>
                    <li><strong>Energy Base (${mA.dieselLabel || 'Diesel'}):</strong> Variance is ${curr} ${fmt(mB.totalDiesel - mA.totalDiesel)}.</li>
                    <li><strong>Invoice Discounting:</strong> Total absolute discount delta: ${curr} ${fmt(mB.totalDiscounts - mA.totalDiscounts)}.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">4) Amendment & Amd_Base Integrity Audit</h3>
                <ul>
                    <li><strong>Specific Item Listing:</strong> The largest current amendments are: ${sortedAmds.map(([item, val]) => `<em>${item}</em> (${curr} ${fmt(val)})`).join(', ')}.</li>
                    <li><strong>Multi-Amendment Sites:</strong> Detected <span style="color:#f87171; font-weight:900;">${mB.multiAmdSiteCount} sites</span> with more than one amendment in current invoice—critical double-billing signals.</li>
                    <li><strong>Classification Risk:</strong> Energy-based amendments: ${mB.amdBaseEnergy} vs Non-Energy bases: ${mB.amdBaseNonEnergy}.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">5) Rent-Free & Future Date Anomaly Audit</h3>
                <ul>
                    <li><strong>Anomaly Statistics:</strong> A identified ${(mA.rentFreeAudit || []).length} date mismatches vs <span style="color:#f87171; font-weight:900;">${(mB.rentFreeAudit || []).length} currently in B</span>.</li>
                    <li><strong>Audit Exposure:</strong> Found Site IDs where Lease/Rent Start Date is after the bill/backbill period, representing potential high-priority overpayment leakage.</li>
                </ul>

                <h3 style="color: var(--primary); font-size: 1.1rem; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">6) Forensic Action Plan (Next Steps)</h3>
                <ol>
                    <li>Review the ${onlyB.length} new site IDs for validated RFS/RFA certificates before payment.</li>
                    <li>Cross-verify the ${(mB.rentFreeAudit || []).length} rent-free anomalies against recent lease amendments found in B.</li>
                    <li>Audit the ${mB.multiAmdSiteCount} multi-amendment sites for description-level duplication.</li>
                    <li>Validate the ${curr} ${fmt(mB.totalDiesel - mA.totalDiesel)} diesel variance against generator run-hour logs for those regions.</li>
                </ol>
            </div>
        `;
    };

    const getDiff = (a, b) => b - a;
    const formatDiff = (diff, isCurrency = false, curr = '', isPercent = false) => {
        const color = diff > 0 ? '#ef4444' : (diff < 0 ? '#10b981' : '#94a3b8'); 
        let val;
        if (isCurrency) {
            val = `${curr} ${Math.abs(diff).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        } else if (isPercent) {
            val = `${Math.abs(diff).toFixed(2)}%`;
        } else {
            val = Math.abs(diff).toLocaleString();
        }
        return <span style={{ color, fontWeight: 'bold' }}>{diff < 0 ? '-' : ''}{val}</span>;
    };

    const cards = [
        { 
            label: 'Footprint Audit', 
            a: sitesA.size, 
            b: sitesB.size, 
            icon: Fingerprint, 
            customHtml: (
                <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem', marginTop: '10px' }}>
                    <span style={{ color: '#a5b4fc', fontWeight: '800' }}>{commonSites.length} Common</span>
                    <span style={{ color: '#fca5a5', fontWeight: '800' }}>{onlyA.length} -A</span>
                    <span style={{ color: '#6ee7b7', fontWeight: '800' }}>{onlyB.length} +B</span>
                </div>
            ),
            onClick: () => setShowFootprintModal(true)
        },
        { label: 'Total Billed', a: metricsA.grandTotal, b: metricsB.grandTotal, icon: DollarSign, isCurr: true },
        { label: metricsA.nonEnergyLabel || metricsB.nonEnergyLabel || 'Non-Energy Charges', a: metricsA.totalNonEnergy, b: metricsB.totalNonEnergy, icon: Layers, isCurr: true },
        { label: metricsA.totalEnergy > 0 || metricsB.totalEnergy > 0 ? (metricsA.electricityLabel || metricsB.electricityLabel ? `${metricsA.electricityLabel || 'Grid'} + ${metricsA.dieselLabel || 'Diesel'}` : 'Energy Charges') : 'Energy Charges', a: metricsA.totalEnergy, b: metricsB.totalEnergy, icon: Zap, isCurr: true },
        { label: 'Multi-Tenant Sites', a: metricsA.multiTenancyCount, b: metricsB.multiTenancyCount, icon: Scale },
        { label: 'Top Region Shift', a: metricsA.topRegionCount, b: metricsB.topRegionCount, text: `${metricsB.topRegion || 'N/A'}`, icon: MapPin }
    ];

    return (
        <motion.div id="comparison-report" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="report-container" style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                         <div style={{ width: '8px', height: '8px', background: getOpenAIKey() ? '#10b981' : '#f59e0b', borderRadius: '50%', boxShadow: getOpenAIKey() ? '0 0 10px #10b981' : '0 0 10px #f59e0b' }}></div>
                        <span style={{ fontSize: '0.75rem', fontWeight: '800', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                            Forensic Delta Analysis • {getOpenAIKey() ? 'OpenAI Active' : 'Basic Engine'}
                        </span>
                    </div>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: '900' }}>{invoiceA.name} <span style={{ color: 'var(--text-dim)', fontWeight: '400' }}>vs</span> {invoiceB.name}</h1>
                </div>
                <div style={{ display: 'flex', gap: '15px' }}>
                    <button 
                        onClick={() => exportToPDF('comparison-report', `iBill_Comparison_${invoiceA.name.replace(/\.[^/.]+$/, "")}_vs_${invoiceB.name.replace(/\.[^/.]+$/, "")}.pdf`, { reportTitle: 'Invoice Comparison Audit', subtitle: `${invoiceA.name} vs ${invoiceB.name}` })} 
                        className="btn-primary" 
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <Download size={18} /> Export PDF
                    </button>
                    <button onClick={() => onDeepCompare(invoiceA, invoiceB)} className="btn-primary">🔍 Ledger Drill-Down</button>
                    <button onClick={() => { setInvoiceA(null); setInvoiceB(null); }} className="btn-secondary">Reset</button>
                    <button onClick={onBack} className="btn-secondary"><ArrowLeft size={18} /></button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                {cards.map((card, i) => {
                    const diff = card.b - card.a;
                    const percent = card.a !== 0 ? (diff / card.a) * 100 : 0;
                    return (
                        <motion.div 
                            key={i} 
                            initial={{ opacity: 0, y: 10 }} 
                            animate={{ opacity: 1, y: 0 }} 
                            transition={{ delay: i * 0.05 }} 
                            className="glass-panel metric-card"
                            style={{ 
                                cursor: card.onClick ? 'pointer' : 'default',
                                position: 'relative',
                                background: card.onClick ? 'rgba(99, 102, 241, 0.05)' : ''
                            }}
                            onClick={card.onClick}
                            hover={{ scale: card.onClick ? 1.02 : 1 }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <span className="metric-label">{card.label}</span>
                                <card.icon size={18} className="text-primary" style={{ opacity: 0.4 }} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                                <div className="metric-value" style={{ fontSize: '1.6rem', fontWeight: '900' }}>{card.isCurr ? `${metricsA.currency || metricsB.currency || ''} ${formatCurr(card.b)}` : (card.text || card.b.toLocaleString())}</div>
                                {card.label !== 'Regional Focus' && (
                                    <div style={{ fontSize: '0.8rem', fontWeight: '800', color: diff > 0 ? '#f87171' : (diff < 0 ? '#4ade80' : 'var(--text-dim)') }}>
                                        {diff > 0 ? '↑' : (diff < 0 ? '↓' : '')} {Math.abs(percent).toFixed(1)}%
                                    </div>
                                )}
                            </div>
                            {card.customHtml}
                        </motion.div>
                    );
                })}
            </div>

            <label
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    cursor: isAnalyzing ? 'default' : 'pointer',
                    fontSize: '0.88rem',
                    color: 'var(--text-dim)',
                    marginBottom: '14px',
                    lineHeight: 1.5
                }}
            >
                <input
                    type="checkbox"
                    checked={deepLayerSupplementEnabled}
                    onChange={(e) => persistDeepLayerPref(e.target.checked)}
                    disabled={isAnalyzing}
                    style={{ marginTop: '3px', width: '16px', height: '16px', accentColor: 'var(--primary)', flexShrink: 0 }}
                />
                <span>
                    <strong style={{ color: '#e2e8f0' }}>Include Deep-Layer AI supplement</strong>
                    <span style={{ display: 'block', fontSize: '0.8rem', opacity: 0.9, marginTop: '2px' }}>
                        Second OpenAI request (~15–45s, extra cost). Uncheck for local-only comparison report.
                    </span>
                </span>
            </label>
            {!summary && (
                <button onClick={generateAnalysis} className="btn-primary" disabled={isAnalyzing} style={{ width: '100%', padding: '20px', marginBottom: '32px', justifyContent: 'center' }}>
                    {isAnalyzing ? "Calibrating Delta Variants..." : "✨ Run AI Comparison"}
                </button>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '32px' }}>
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-panel" style={{ padding: '24px', height: '380px' }}>
                    <h3 style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '24px', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '800' }}>Segment Variance Bridge (A vs B)</h3>
                    <ResponsiveContainer width="100%" height="80%">
                        <BarChart data={[
                            ...(metricsA.totalNonEnergy > 0 || metricsB.totalNonEnergy > 0 ? [{ name: metricsA.nonEnergyLabel || metricsB.nonEnergyLabel || 'Non-Energy', a: metricsA.totalNonEnergy, b: metricsB.totalNonEnergy }] : []),
                            ...(metricsA.totalElectricity > 0 || metricsB.totalElectricity > 0 ? [{ name: metricsA.electricityLabel || metricsB.electricityLabel || 'Electricity', a: metricsA.totalElectricity, b: metricsB.totalElectricity }] : []),
                            ...(metricsA.totalDiesel > 0 || metricsB.totalDiesel > 0 ? [{ name: metricsA.dieselLabel || metricsB.dieselLabel || 'Diesel', a: metricsA.totalDiesel, b: metricsB.totalDiesel }] : []),
                            ...(metricsA.totalAmendment !== 0 || metricsB.totalAmendment !== 0 ? [{ name: metricsA.amendmentLabel || metricsB.amendmentLabel || 'Amendments', a: metricsA.totalAmendment, b: metricsB.totalAmendment }] : [])
                        ]}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                            <YAxis hide />
                            <Tooltip 
                                contentStyle={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', backdropFilter: 'blur(8px)' }}
                                itemStyle={{ color: '#fff', fontSize: '0.8rem' }}
                                formatter={(val) => `${metricsA.currency || metricsB.currency || ''} ${val.toLocaleString()}`}
                            />
                            <Legend iconType="circle" wrapperStyle={{ fontSize: '0.8rem', paddingTop: '10px' }} />
                            <Bar dataKey="a" name={invoiceA.name} fill="#475569" radius={[4, 4, 0, 0]} barSize={24} />
                            <Bar dataKey="b" name={invoiceB.name} fill="#6366f1" radius={[4, 4, 0, 0]} barSize={24} />
                        </BarChart>
                    </ResponsiveContainer>
                </motion.div>

                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-panel" style={{ padding: '24px', height: '380px' }}>
                    <h3 style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '24px', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '800' }}>Amendment Category Comparison</h3>
                    <ResponsiveContainer width="100%" height="85%">
                        <BarChart layout="vertical" data={Object.entries(metricsB.amendmentBreakdown).map(([name, bVal]) => ({
                            name,
                            a: metricsA.amendmentBreakdown[name] || 0,
                            b: bVal
                        })).sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a)).slice(0, 5)}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(255,255,255,0.05)" />
                            <XAxis type="number" hide />
                            <YAxis dataKey="name" type="category" stroke="#94a3b8" fontSize={9} tickLine={false} axisLine={false} width={100} />
                            <Tooltip 
                                contentStyle={{ background: 'rgba(15, 23, 42, 0.9)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                                formatter={(val) => `${metricsA.currency || ''} ${val.toLocaleString()}`}
                            />
                            <Bar dataKey="a" name={invoiceA.name} fill="#475569" radius={[0, 4, 4, 0]} barSize={12} />
                            <Bar dataKey="b" name={invoiceB.name} fill="#10b981" radius={[0, 4, 4, 0]} barSize={12} />
                        </BarChart>
                    </ResponsiveContainer>
                </motion.div>
            </div>
            
            <AnimatePresence>
                {showFootprintModal && (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="glass-panel" style={{ width: '100%', maxWidth: '900px', maxHeight: '80vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
                            <button onClick={() => setShowFootprintModal(false)} style={{ position: 'absolute', top: '20px', right: '20px', background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={24} /></button>
                            
                            <div style={{ padding: '30px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                <h2 style={{ fontSize: '1.5rem', fontWeight: '900', marginBottom: '8px' }}>Site ID Reconciliation</h2>
                                <p style={{ color: 'var(--text-dim)' }}>Detailed comparison of site presence between the two datasets.</p>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.05)', flex: 1, overflow: 'hidden' }}>
                                <div style={{ background: 'var(--bg)', padding: '20px', overflowY: 'auto' }}>
                                    <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#6366f1', marginBottom: '15px' }}>Common Sites ({commonSites.length})</h3>
                                    {commonSites.map(id => <div key={id} style={{ fontSize: '0.85rem', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>{id}</div>)}
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '20px', overflowY: 'auto' }}>
                                    <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#f87171', marginBottom: '15px' }}>Unique to A ({onlyA.length})</h3>
                                    {onlyA.map(id => <div key={id} style={{ fontSize: '0.85rem', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>{id}</div>)}
                                </div>
                                <div style={{ background: 'var(--bg)', padding: '20px', overflowY: 'auto' }}>
                                    <h3 style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#10b981', marginBottom: '15px' }}>Unique to B ({onlyB.length})</h3>
                                    {onlyB.map(id => <div key={id} style={{ fontSize: '0.85rem', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>{id}</div>)}
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}

                {summary && (
                    <>
                        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-panel" style={{ padding: '30px', marginBottom: '20px', borderLeft: '4px solid var(--primary)' }}>
                            <div className="invoice-summary-content" style={{ color: '#e2e8f0' }} dangerouslySetInnerHTML={{ __html: summary }} />
                            <style>{`
                              .invoice-summary-content h3 { margin: 16px 0 10px; }
                              .invoice-summary-content p { margin: 8px 0; line-height: 1.55; }
                              .invoice-summary-content ul, .invoice-summary-content ol { margin: 8px 0 12px; padding-left: 20px; }
                              .invoice-summary-content li { margin: 4px 0; line-height: 1.45; }
                              .invoice-summary-content div { line-height: 1.55; }
                            `}</style>
                        </motion.div>
                        <SummaryQnA
                            title="Invoice Summary Q&A"
                            summaryHtml={summary}
                            contextType="compare"
                            contextPayload={compareSummaryContext}
                        />
                    </>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const SummaryQnA = ({ title, summaryHtml, contextType = 'single', contextPayload = null, invoiceData = null, invoiceKey = null }) => {
    const [messages, setMessages] = useState([]);
    const [question, setQuestion] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const speechSupported = !!getSpeechRecognition();
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = React.useRef(null);
    const [speakOnReply, setSpeakOnReply] = useState(() => localStorage.getItem('IBILL_SPEAK_ON_REPLY') !== '0');
    const [ragHint, setRagHint] = useState('');

    const startListening = () => {
        if (!speechSupported) return;
        if (isListening) return;

        // Stop any ongoing speech while the user speaks.
        stopSpeaking();

        const SR = getSpeechRecognition();
        if (!SR) return;

        const recognition = new SR();
        recognitionRef.current = recognition;

        recognition.lang = 'en-US';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        setIsListening(true);

        recognition.onresult = (event) => {
            try {
                const last = event.results?.[event.results.length - 1];
                const transcript = last?.[0]?.transcript || '';
                const normalized = normalizeSpeechTranscript(transcript);
                if (normalized) setQuestion(normalized);
            } catch (_) {}
        };

        recognition.onerror = () => {
            setIsListening(false);
        };

        recognition.onend = () => {
            setIsListening(false);
            recognitionRef.current = null;
        };

        try {
            recognition.start();
        } catch (_) {
            setIsListening(false);
        }
    };

    const stopListening = () => {
        try {
            recognitionRef.current?.stop?.();
        } catch (_) {}
        setIsListening(false);
        recognitionRef.current = null;
    };

    const shouldSendFilteredRows = (q) => {
        const s = (q || '').trim();
        if (!s) return false;
        const upper = s.toUpperCase();
        const siteCodeRegex = /\b[A-Z]{2,8}\d{3,10}\b/; // e.g. GHGR0440
        return /\bSITES?\b|\bSITE ID\b|IDENTITY|SITE CODE/i.test(s) || siteCodeRegex.test(upper);
    };

    const askQuestion = async () => {
        if (!question.trim() || isLoading) return;

        const userQuestion = question.trim();
        const summaryText = stripHtml(summaryHtml || '').slice(0, 2500);
        const existingHistory = messages
            .filter((m) => m.role === 'user' || m.role === 'ai')
            .slice(-6)
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .join('\n');

        setMessages((prev) => [...prev, { role: 'user', text: userQuestion }]);
        setQuestion('');
        setIsLoading(true);

        try {
            let ragChunks = [];
            if (contextType === 'single' && invoiceData && invoiceKey) {
                try {
                    // Kick off indexing in background; do not block first answers.
                    const status = getInvoiceRagStatus(invoiceKey);
                    if (!status.ready && !status.indexing) {
                        setRagHint('Indexing invoice for faster answers…');
                        ensureInvoiceRagIndexed(invoiceKey, invoiceData).then(() => setRagHint('')).catch(() => setRagHint(''));
                    }
                    const rag = await retrieveInvoiceRagContext({ invoiceKey, question: userQuestion, topK: 6 });
                    ragChunks = rag?.chunks || [];
                    if (!ragChunks.length) {
                        const st2 = getInvoiceRagStatus(invoiceKey);
                        if (!st2.ready) setRagHint('Indexing invoice for faster answers…');
                    } else {
                        setRagHint('');
                    }
                } catch (_) {
                    // If indexing fails, we silently fall back to non-RAG filtering.
                    ragChunks = [];
                }
            }

            const ragLayer = ragChunks.length
                ? `\n\nRAG_CONTEXT_CHUNKS (top matches):\n${ragChunks.map((c) => `---\n${c.text}`).join('\n')}`
                : '';

            const summaryLayerJson = JSON.stringify(contextPayload || {}, null, 0);
            const filteredRows =
                contextType === 'single' && invoiceData && shouldSendFilteredRows(userQuestion)
                    ? filterRows(invoiceData, userQuestion)
                    : [];

            const rowsLayer = filteredRows.length
                ? `\n\nRELEVANT ROWS (projected, limited):\n${JSON.stringify(filteredRows)}`
                : '';

            const prompt = `
You are a telecom invoice audit assistant.
Use SUMMARY_CONTEXT_JSON as the primary source of truth for general questions.
Use RAG_CONTEXT_CHUNKS when included for site-level questions and retrieval.
Only use RELEVANT ROWS when they are included; otherwise answer using summary/RAG only.

Rules:
- Answer using only the provided context (no guessing).
- If the answer is not available from summary/context, clearly say what additional data is needed.
- Keep answers concise but directly actionable for audit decisions.
- Return plain text. Do NOT use Markdown formatting (no leading '*' bullets, no '**bold**').

SUMMARY_CONTEXT_JSON:
${summaryLayerJson}
${rowsLayer}
${ragLayer}

SUMMARY_NARRATIVE_TEXT (optional human-readable context; still must not contradict JSON):
${summaryText}

Conversation so far:
${existingHistory || '(none)'}

User question:
${userQuestion}
`.trim();

            const result = await fetchOpenAIChatCompletion({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                maxTokens: 650,
                temperature: 0.25,
                topP: 0.9
            });

            const answer = sanitizeAiText(result?.choices?.[0]?.message?.content || '');
            setMessages((prev) => [...prev, { role: 'ai', text: answer }]);
            if (speakOnReply) speakEnglish(answer);
        } catch (err) {
            setMessages((prev) => [...prev, { role: 'error', text: `Cross-question failed: ${err.message}` }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div
            className="glass-panel"
            style={{
                padding: '20px',
                marginTop: '0',
                marginBottom: '24px',
                border: '1px solid rgba(99,102,241,0.35)',
                boxShadow: '0 0 0 1px rgba(99,102,241,0.15), 0 18px 45px rgba(0,0,0,0.35)',
                background: 'linear-gradient(135deg, rgba(99,102,241,0.10) 0%, rgba(15,23,42,0.85) 40%, rgba(15,23,42,0.85) 100%)'
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ fontSize: '0.95rem', fontWeight: '900', color: 'white' }}>{title}</h3>
                <div style={{ fontSize: '0.7rem', color: 'rgba(203,213,225,0.85)', fontWeight: 800, letterSpacing: '1px', textTransform: 'uppercase' }}>
                    Voice enabled
                </div>
            </div>

            <div style={{ maxHeight: '220px', overflowY: 'auto', marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {messages.length === 0 && (
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>
                        Ask anything about this summary (variance reason, leakage risk, region trend, what to verify next).
                    </div>
                )}
                {!!ragHint && (
                    <div style={{ fontSize: '0.75rem', color: 'rgba(203,213,225,0.85)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', padding: '8px 10px', borderRadius: '10px' }}>
                        {ragHint}
                    </div>
                )}
                {messages.map((m, idx) => (
                    <div key={idx} style={{
                        alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                        background: m.role === 'user' ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: m.role === 'error' ? '#f87171' : '#e2e8f0',
                        borderRadius: '12px',
                        padding: '10px 12px',
                        maxWidth: '90%',
                        fontSize: '0.86rem',
                        lineHeight: 1.5
                    }}>
                        {m.text}
                    </div>
                ))}
                {isLoading && <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>Analyzing...</div>}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && askQuestion()}
                    placeholder="Ask a question on this summary..."
                    style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '10px 12px', color: 'white', outline: 'none' }}
                />
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={isListening ? stopListening : startListening}
                    disabled={!speechSupported || isLoading}
                    title={speechSupported ? (isListening ? 'Stop voice input' : 'Speak (English)') : 'Speech recognition not supported in this browser'}
                    style={{
                        background: isListening ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'white',
                        width: '42px',
                        height: '42px',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: speechSupported ? 'pointer' : 'not-allowed',
                        opacity: speechSupported ? 1 : 0.5
                    }}
                >
                    <Mic size={18} />
                </motion.button>
                <button className="btn-primary" onClick={askQuestion} disabled={isLoading} style={{ padding: '10px 14px' }}>
                    Ask
                </button>
                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => {
                        const next = !speakOnReply;
                        setSpeakOnReply(next);
                        localStorage.setItem('IBILL_SPEAK_ON_REPLY', next ? '1' : '0');
                        if (!next) stopSpeaking();
                    }}
                    disabled={isLoading}
                    title="Read AI replies aloud (English)"
                    style={{
                        background: speakOnReply ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'white',
                        width: '42px',
                        height: '42px',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                    }}
                >
                    <Volume2 size={18} />
                </motion.button>
            </div>
        </div>
    );
};

const DetailedComparison = ({ invoiceA, invoiceB, onBack }) => {
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState('siteId');
    const [sortOrder, setSortOrder] = useState('asc');
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 50;

    const CORE_CONFIG = [
        { id: 'ne', label: 'Non-Energy Charge', color: '#94a3b8' },
        { id: 'energy', label: 'Energy Charge', color: '#94a3b8' },
        { id: 'amd', label: 'Amendment Charge', color: '#94a3b8' },
        { id: 'total', label: 'Total Charge', color: '#e2e8f0', isBold: true, bg: 'rgba(99, 102, 241, 0.05)' }
    ];

    const allAvailableKeys = React.useMemo(() => {
        const keys = new Set();
        [...invoiceA.data, ...invoiceB.data].forEach(row => {
            Object.keys(row).forEach(k => keys.add(k));
        });
        
        return Array.from(keys).sort();
    }, [invoiceA, invoiceB]);

    const [activeCore, setActiveCore] = useState(['ne', 'energy', 'amd', 'total']);
    const [extraFields, setExtraFields] = useState([]); 

    const unifiedData = React.useMemo(() => {
        const getVal = (val) => {
            if (val === null || val === undefined) return 0;
            if (typeof val === 'string') val = val.replace(/,/g, '');
            let num = parseFloat(val);
            return isNaN(num) ? 0 : num;
        };

        const sites = new Map();
        
        const updateSiteData = (row, target) => {
            const sid = findMetricValue(row, COLUMN_PATTERNS.siteId);
            if (!sid) return;
            const siteKey = sid.toString();
            
            if (!sites.has(siteKey)) sites.set(siteKey, { siteId: siteKey, dataA: null, dataB: null });
            const current = sites.get(siteKey);
            
            if (!current[target]) {
                current[target] = { 
                    ne: 0, eb: 0, dg: 0, energy: 0, amd: 0, total: 0, 
                    region: findMetricValue(row, COLUMN_PATTERNS.region) || '-',
                    extras: {} 
                };
            }
            const data = current[target];
            data.ne += getVal(findMetricValue(row, COLUMN_PATTERNS.nonEnergy));
            data.eb += getVal(findMetricValue(row, COLUMN_PATTERNS.electricity));
            data.dg += getVal(findMetricValue(row, COLUMN_PATTERNS.diesel));
            data.amd += getVal(findMetricValue(row, COLUMN_PATTERNS.amendment));
            data.energy = data.eb + data.dg;
            data.total = data.ne + data.energy + data.amd;

            // Mapping Selected Metadata (Extras)
            extraFields.forEach(fieldKey => {
                // Heuristic: If exact key doesn't exist, look for case-insensitive match in this row
                let actualVal = row[fieldKey];
                if (actualVal === undefined) {
                    const keys = Object.keys(row);
                    const match = keys.find(k => k.toLowerCase() === fieldKey.toLowerCase());
                    if (match) actualVal = row[match];
                }
                
                if (actualVal !== undefined) {
                    data.extras[fieldKey] = actualVal;
                }
            });
        };

        invoiceA.data.forEach(row => updateSiteData(row, 'dataA'));
        invoiceB.data.forEach(row => updateSiteData(row, 'dataB'));

        return Array.from(sites.values()).map(item => {
            const totalA = item.dataA?.total || 0;
            const totalB = item.dataB?.total || 0;
            return {
                ...item,
                variance: totalB - totalA,
                absVariance: Math.abs(totalB - totalA)
            };
        });
    }, [invoiceA, invoiceB, extraFields]);

    const filteredData = React.useMemo(() => {
        let result = unifiedData.filter(item => 
            item.siteId.toLowerCase().includes(search.toLowerCase()) ||
            (item.dataA?.region || '').toLowerCase().includes(search.toLowerCase()) ||
            (item.dataB?.region || '').toLowerCase().includes(search.toLowerCase())
        );

        result.sort((a, b) => {
            let valA, valB;
            if (sortKey === 'siteId') { valA = a.siteId; valB = b.siteId; }
            else if (sortKey === 'variance') { valA = a.variance; valB = b.variance; }
            else if (sortKey === 'totalA') { valA = a.dataA?.total || 0; valB = b.dataA?.total || 0; }
            else if (sortKey === 'totalB') { valA = a.dataB?.total || 0; valB = b.dataB?.total || 0; }

            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        return result;
    }, [unifiedData, search, sortKey, sortOrder]);

    const paginatedData = filteredData.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
    const totalPages = Math.ceil(filteredData.length / rowsPerPage);

    const formatCurr = (val) => {
        let n = parseFloat(val);
        if (isNaN(n)) return '0.00';
        return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const toggleCore = (id) => {
        setActiveCore(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleExtra = (key) => {
        setExtraFields(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
    };

    const periodColSpan = activeCore.length + extraFields.length;

    return (
        <div className="report-container" style={{ maxWidth: '98%', margin: '20px auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                         <Zap className="text-primary" size={16} />
                         <span style={{ fontSize: '0.75rem', fontWeight: '800', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Workplace Ledger Audit</span>
                    </div>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: '900' }}>Unified Drill-Down Audit</h1>
                </div>
                <div style={{ display: 'flex', gap: '15px' }}>
                    <button 
                        onClick={() => exportComparisonToExcel(unifiedData, invoiceA.name, invoiceB.name, extraFields)}
                        className="btn-primary" 
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <FileSpreadsheet size={18} /> Export Variance Excel
                    </button>
                    <button onClick={onBack} className="btn-secondary" style={{ padding: '12px 24px' }}>
                        <ArrowLeft size={18} /> Return to Comparison
                    </button>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '24px', marginBottom: '24px' }}>
                 <div style={{ marginBottom: '24px' }}>
                    <h3 style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '800' }}>Fiscal Dimensions</h3>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {CORE_CONFIG.map(field => (
                            <button
                                key={field.id}
                                onClick={() => toggleCore(field.id)}
                                className={`btn-secondary ${activeCore.includes(field.id) ? 'active' : ''}`}
                                style={{ 
                                    padding: '10px 18px', 
                                    fontSize: '0.75rem',
                                    border: activeCore.includes(field.id) ? '1px solid var(--primary)' : '1px solid rgba(255,255,255,0.05)',
                                    background: activeCore.includes(field.id) ? 'rgba(99, 102, 241, 0.1)' : 'transparent'
                                }}
                            >
                                {activeCore.includes(field.id) ? <Check size={14} style={{ marginRight: '6px' }} /> : <PlusCircle size={14} style={{ marginRight: '6px' }} />}
                                {field.label}
                            </button>
                        ))}
                    </div>
                 </div>

                 <div>
                    <h3 style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: '800' }}>Site Metadata (Discovered)</h3>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', maxHeight: '140px', overflowY: 'auto', padding: '20px', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
                        {allAvailableKeys.map(key => (
                            <button
                                key={key}
                                onClick={() => toggleExtra(key)}
                                className={`btn-secondary ${extraFields.includes(key) ? 'active' : ''}`}
                                style={{ 
                                    padding: '8px 14px', 
                                    fontSize: '0.7rem',
                                    borderColor: extraFields.includes(key) ? '#f59e0b' : 'rgba(255,255,255,0.05)',
                                    color: extraFields.includes(key) ? '#f59e0b' : 'var(--text-dim)'
                                }}
                            >
                                {key}
                            </button>
                        ))}
                    </div>
                 </div>
            </div>

            <div className="glass-panel" style={{ padding: '24px', marginBottom: '32px', display: 'flex', gap: '24px', alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '10px', fontWeight: 'bold' }}>SEARCH SITES / REGIONS</label>
                    <input 
                        type="text" 
                        placeholder="Filter by Site ID, Region..." 
                        value={search} 
                        onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }}
                        style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', padding: '14px', borderRadius: '12px', color: 'white', outline: 'none' }}
                    />
                </div>
                <div>
                     <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '10px', fontWeight: 'bold' }}>SORT BY</label>
                     <div style={{ display: 'flex', gap: '10px' }}>
                        <select 
                            value={sortKey} 
                            onChange={(e) => setSortKey(e.target.value)}
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '14px', borderRadius: '12px', color: 'white', width: '220px' }}
                        >
                            <option value="siteId">Site Identity</option>
                            <option value="totalA">Invoice 1 Total</option>
                            <option value="totalB">Invoice 2 Total</option>
                            <option value="variance">Net Variance</option>
                        </select>
                        <button onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')} className="btn-secondary" style={{ padding: '0 18px' }}>
                            {sortOrder === 'asc' ? '↑' : '↓'}
                        </button>
                     </div>
                </div>
            </div>

            <div className="glass-panel" style={{ overflowX: 'auto', padding: '0', border: '1px solid rgba(255,255,255,0.05)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: `${800 + periodColSpan * 200}px` }}>
                    <thead style={{ backgroundColor: 'rgba(15, 23, 42, 0.98)', position: 'sticky', top: 0, zIndex: 10 }}>
                        <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.1)' }}>
                            <th style={{ padding: '24px', color: 'var(--text-dim)', fontSize: '0.7rem', fontWeight: '900', textTransform: 'uppercase' }}>SITE IDENTITY</th>
                            
                            {periodColSpan > 0 && (
                                <th style={{ padding: '24px', color: 'var(--primary)', fontSize: '0.7rem', fontWeight: '900', textAlign: 'center', backgroundColor: 'rgba(99, 102, 241, 0.05)', textTransform: 'uppercase', borderLeft: '1px solid rgba(255,255,255,0.05)' }} colSpan={periodColSpan}>
                                    PERIOD A: {invoiceA.name}
                                </th>
                            )}
                            {periodColSpan > 0 && (
                                <th style={{ padding: '24px', color: '#10b981', fontSize: '0.7rem', fontWeight: '900', textAlign: 'center', backgroundColor: 'rgba(16, 185, 129, 0.05)', textTransform: 'uppercase', borderLeft: '1px solid rgba(255,255,255,0.05)' }} colSpan={periodColSpan}>
                                    PERIOD B: {invoiceB.name}
                                </th>
                            )}
                            {activeCore.includes('total') && <th style={{ padding: '24px', color: 'white', fontSize: '0.7rem', fontWeight: '900', textAlign: 'right', borderLeft: '1px solid rgba(255,255,255,0.05)' }}>NET VARIANCE</th>}
                        </tr>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', fontSize: '0.6rem', color: 'var(--text-dim)' }}>
                            <th style={{ padding: '12px 24px' }}>IDENTITY_KEY</th>
                            {/* Sub-Headers A */}
                            {extraFields.map(f => <th key={`H1E-${f}`} style={{ padding: '12px 15px', textAlign: 'center', color: '#f59e0b' }}>{f}</th>)}
                            {CORE_CONFIG.filter(c => activeCore.includes(c.id)).map(c => <th key={`H1C-${c.id}`} style={{ padding: '12px 15px', textAlign: 'right' }}>{c.label}</th>)}
                            {/* Sub-Headers B */}
                            {extraFields.map(f => <th key={`H2E-${f}`} style={{ padding: '12px 15px', textAlign: 'center', color: '#f59e0b' }}>{f}</th>)}
                            {CORE_CONFIG.filter(c => activeCore.includes(c.id)).map(c => <th key={`H2C-${c.id}`} style={{ padding: '12px 15px', textAlign: 'right' }}>{c.label}</th>)}
                            {activeCore.includes('total') && <th style={{ padding: '12px 24px', textAlign: 'right' }}>DELTA_PHI</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedData.map((item, idx) => {
                            const diff = item.variance;
                            const diffColor = diff > 0 ? '#f87171' : (diff < 0 ? '#4ade80' : 'var(--text-dim)');
                            return (
                                <tr key={item.siteId} style={{ 
                                     borderBottom: '1px solid rgba(255,255,255,0.05)', 
                                     backgroundColor: item.absVariance > (item.dataA?.total * 0.05) ? 'rgba(239, 68, 68, 0.05)' : (idx % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent'),
                                     transition: 'background 0.2s'
                                 }} className="ledger-row">
                                     <td style={{ padding: '16px 24px', borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                                         <div style={{ fontWeight: '900', color: '#6366f1', fontSize: '0.9rem' }}>{item.siteId}</div>
                                         <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{item.dataA?.region || item.dataB?.region || '-'}</div>
                                     </td>
                                     {/* Period A Values */}
                                     {extraFields.map(f => (
                                         <td key={`C1E-${f}`} style={{ padding: '12px 15px', textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8' }}>
                                             {formatValueWithDates(item.dataA?.extras[f], f)}
                                         </td>
                                     ))}
                                     {CORE_CONFIG.filter(c => activeCore.includes(c.id)).map(c => (
                                         <td key={`C1C-${c.id}`} style={{ padding: '12px 15px', textAlign: 'right', fontSize: '0.8rem', color: c.color, fontWeight: c.isBold ? '800' : 'normal' }}>
                                             {item.dataA ? formatCurr(item.dataA[c.id]) : '0.00'}
                                         </td>
                                     ))}
                                     {/* Period B Values */}
                                     {extraFields.map((f, fIdx) => (
                                         <td key={`C2E-${f}`} style={{ padding: '12px 15px', textAlign: 'center', fontSize: '0.75rem', color: '#94a3b8', borderLeft: fIdx === 0 ? '2px solid rgba(255,255,255,0.1)' : '1px solid rgba(255,255,255,0.02)' }}>
                                             {formatValueWithDates(item.dataB?.extras[f], f)}
                                         </td>
                                     ))}
                                     {CORE_CONFIG.filter(c => activeCore.includes(c.id)).map((c, cIdx) => (
                                         <td key={`C2C-${c.id}`} style={{ 
                                            padding: '12px 15px', 
                                            textAlign: 'right', 
                                            fontSize: '0.8rem', 
                                            color: c.color, 
                                            fontWeight: c.isBold ? '800' : 'normal',
                                            borderLeft: (extraFields.length === 0 && cIdx === 0) ? '2px solid rgba(255,255,255,0.1)' : 'none'
                                         }}>
                                             {item.dataB ? formatCurr(item.dataB[c.id]) : '0.00'}
                                         </td>
                                     ))}
                                     {activeCore.includes('total') && (
                                         <td style={{ 
                                            padding: '16px 24px', 
                                            textAlign: 'right', 
                                            color: diffColor, 
                                            fontWeight: '900', 
                                            fontSize: '1rem', 
                                            borderLeft: '2px solid rgba(255,255,255,0.1)',
                                            background: 'rgba(255,255,255,0.02)'
                                         }}>
                                             {diff !== 0 ? (diff < 0 ? '-' : '+') + formatCurr(Math.abs(diff)) : '0.00'}
                                         </td>
                                     )}
                                 </tr>
                            );
                        })}
                    </tbody>
                </table>
                {filteredData.length === 0 && (
                    <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-dim)' }}>
                        <Info size={40} style={{ opacity: 0.2, marginBottom: '16px' }} />
                        <p>No sites found matching your active filter criteria.</p>
                    </div>
                )}
            </div>

            <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    Visualizing <strong>{paginatedData.length}</strong> of <strong>{filteredData.length}</strong> audited records
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button disabled={currentPage === 1} onClick={() => setCurrentPage(prev => prev - 1)} className="btn-secondary" style={{ padding: '8px 16px' }}>Prev</button>
                    {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                        const p = i + 1;
                        return <button key={p} onClick={() => setCurrentPage(p)} className={currentPage === p ? 'btn-primary' : 'btn-secondary'} style={{ padding: '8px 14px' }}>{p}</button>
                    })}
                    <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(prev => prev + 1)} className="btn-secondary" style={{ padding: '8px 16px' }}>Next</button>
                </div>
            </div>
        </div>
    );
};



const ForensicChat = ({ contextData, type = 'single' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    // Uses server-side proxy via Vite dev server (no key UI in client).
    const [kbHint, setKbHint] = useState('');
    const speechSupported = !!getSpeechRecognition();
    const [isListening, setIsListening] = useState(false);
    const recognitionRef = React.useRef(null);
    const [speakOnReply, setSpeakOnReply] = useState(() => localStorage.getItem('IBILL_SPEAK_ON_REPLY') !== '0');

    const startListening = () => {
        if (!speechSupported || isListening) return;
        stopSpeaking();

        const SR = getSpeechRecognition();
        if (!SR) return;

        const recognition = new SR();
        recognitionRef.current = recognition;
        recognition.lang = 'en-US';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        setIsListening(true);

        recognition.onresult = (event) => {
            try {
                const last = event.results?.[event.results.length - 1];
                const transcript = last?.[0]?.transcript || '';
                const normalized = normalizeSpeechTranscript(transcript);
                if (normalized) setInput(normalized);
            } catch (_) {}
        };

        recognition.onerror = () => setIsListening(false);
        recognition.onend = () => {
            setIsListening(false);
            recognitionRef.current = null;
        };

        try {
            recognition.start();
        } catch (_) {
            setIsListening(false);
        }
    };

    const stopListening = () => {
        try {
            recognitionRef.current?.stop?.();
        } catch (_) {}
        setIsListening(false);
        recognitionRef.current = null;
    };

    const handleSend = async () => {
        const userQuestion = input.trim();
        if (!userQuestion) return;
        // Capture history before we append the new user message.
        const existingHistory = messages
            .filter((m) => m.role === 'user' || m.role === 'ai')
            .slice(-6)
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .join('\n');

        setMessages((prev) => [...prev, { role: 'user', text: userQuestion }]);
        setInput('');
        setIsLoading(true);

        try {
            // Global telecom help mode (no invoice required)
            if (type === 'general' || !contextData) {
                const kbStatus = getKnowledgeRagStatus();
                if (!kbStatus.ready && !kbStatus.indexing) {
                    setKbHint('Indexing telecom knowledge base…');
                    ensureKnowledgeIndexed().then(() => setKbHint('')).catch(() => setKbHint(''));
                }
                if (kbStatus.ready && kbStatus.embedEnabled === false) {
                    setKbHint('Knowledge base ready (lexical mode).');
                }
                const kb = await retrieveKnowledgeContext({ question: userQuestion, topK: 6 });
                const kbChunks = kb?.chunks || [];
                const kbLayer = kbChunks.length
                    ? `\n\nKNOWLEDGE_BASE_CHUNKS:\n${kbChunks.map((c) => `---\n${c.text}`).join('\n')}`
                    : '\n\nKNOWLEDGE_BASE_CHUNKS: (not ready yet)';

                const prompt = `
You are iBill Co-Pilot, an expert AI assistant specializing in telecom billing,
network operations, and telecommunications industry knowledge.


Your expertise covers:
- Infozech products: iBill, iROC, iMaintain, iETS, iAsset, iAnalytics, iRecon (iTower suites)
- Telecom billing systems (CDRs, rating, invoicing, mediation, interconnect billing)
- Network technologies (4G LTE, 5G NR, VoIP, MPLS, SD-WAN, fiber optics)
- Telecom protocols (SIP, Diameter, RADIUS, SS7, GTP, SIGTRAN)
- Revenue assurance and fraud management
- Regulatory compliance (TRAI, FCC, GDPR for telecom, TCPA)
- OSS/BSS systems, Roaming and interconnect settlement
- Tower billing, energy billing, IP billing, and MSA management

IMPORTANT INSTRUCTIONS:
- When answering questions about Infozech, its products, solutions, team, or history —
  ALWAYS use the KNOWLEDGE BASE as your primary source of truth.
- Prefer information from the KNOWLEDGE BASE over your general training data.
- If the KNOWLEDGE BASE does not contain the answer, use your general telecom knowledge.
- Always give clear, accurate, and practical answers.
- If a question is NOT telecom, politely redirect the user say "Not available in the knowledge base" and suggest what to look up.

KNOWLEDGE BASE: You have deep expertise in telecom tower billing terminology
including: AMOUNT_NONENERGY (rent), AMOUNT_ELECTRICITY (grid energy),
AMOUNT_DIESEL (generator fuel), AMENDMENT_AMOUNT (billing corrections),
BACK_BILL (retroactive charges), RENT_FREE_PERIOD, FX_RATE,
CUMULATIVE_ESCALATION, GRID_STATUS, SITE_TYPE, MULTI_TENANCY_STATUS,
SITERRA_SITE_ID, and REGION_NAME etc.


Conversation so far:
${existingHistory || '(none)'}

User question:
${userQuestion}
${kbLayer}
`.trim();

                const result = await fetchOpenAIChatCompletion({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'user', content: prompt }],
                    maxTokens: 700,
                    temperature: 0.2,
                    topP: 0.9
                });
                const answer = sanitizeAiText(result?.choices?.[0]?.message?.content || '');
                setMessages((prev) => [...prev, { role: 'ai', text: answer }]);
                if (speakOnReply) speakEnglish(answer);
                setIsLoading(false);
                return;
            }

            const looksSiteSpecific = () => {
                const s = userQuestion;
                const upper = s.toUpperCase();
                const siteCodeRegex = /\b[A-Z]{2,8}\d{3,10}\b/;
                return /\bSITES?\b|\bSITE ID\b|IDENTITY|SITE CODE/i.test(s) || siteCodeRegex.test(upper);
            };

            const shouldFilterRows = looksSiteSpecific();

            const buildSingleSummary = (inv) => {
                const rows = inv?.data || [];
                const m = calculateDetailedMetrics(rows);
                const totalEnergy = m.totalEnergy || (m.totalElectricity + m.totalDiesel);
                const gridSharePct = totalEnergy ? (m.totalElectricity / totalEnergy) * 100 : 0;
                const dieselSharePct = totalEnergy ? (m.totalDiesel / totalEnergy) * 100 : 0;
                return {
                    module: 'single-invoice-chat',
                    invoiceName: inv?.name || '',
                    currency: m.currency,
                    totals: {
                        grandTotal: m.grandTotal,
                        totalNonEnergy: m.totalNonEnergy,
                        totalElectricity: m.totalElectricity,
                        totalDiesel: m.totalDiesel,
                        totalAmendment: m.totalAmendment,
                        totalRecords: m.totalRecords,
                        uniqueSitesCount: m.uniqueSites?.size || 0
                    },
                    energyMix: { gridSharePct, dieselSharePct },
                    topRegions: topEntries(m.regionCounts, 5).map(([region, count]) => ({ region, count })),
                    topAmendments: topAbsEntries(m.amendmentBreakdown, 5).map(([item, amount]) => ({ item, amount })),
                    topLeaseComponents: topAbsEntries(m.leaseComponentBreakdown, 5).map(([component, amount]) => ({ component, amount })),
                    topTenants: topEntries(m.tenantMix, 5).map(([tenant, count]) => ({ tenant, count }))
                };
            };

            const buildCompareSummary = (cmp) => {
                const a = cmp?.a;
                const b = cmp?.b;
                const rowsA = a?.data || [];
                const rowsB = b?.data || [];
                const mA = calculateDetailedMetrics(rowsA);
                const mB = calculateDetailedMetrics(rowsB);

                const sitesA = mA.uniqueSites || new Set();
                const sitesB = mB.uniqueSites || new Set();
                const commonSites = [...sitesA].filter((id) => sitesB.has(id));
                const onlyA = [...sitesA].filter((id) => !sitesB.has(id));
                const onlyB = [...sitesB].filter((id) => !sitesA.has(id));

                return {
                    module: 'invoice-comparison-chat',
                    invoiceA: { name: a?.name || '', currency: mA.currency, grandTotal: mA.grandTotal, uniqueSitesCount: sitesA.size },
                    invoiceB: { name: b?.name || '', currency: mB.currency, grandTotal: mB.grandTotal, uniqueSitesCount: sitesB.size },
                    reconciliation: { common: commonSites.length, onlyA: onlyA.length, onlyB: onlyB.length },
                    topRegionsDelta: topDeltaAbsEntries(mA.regionCounts, mB.regionCounts, 5).map(([region, delta]) => ({ region, delta })),
                    topAmendmentDeltas: topDeltaAbsEntries(mA.amendmentBreakdown, mB.amendmentBreakdown, 5).map(([item, delta]) => ({ item, delta }))
                };
            };

            const summaryLayer =
                type === 'compare'
                    ? buildCompareSummary(contextData)
                    : buildSingleSummary(contextData);

            let filteredRows = [];
            if (shouldFilterRows) {
                if (type === 'compare') {
                    const rowsA = contextData?.a?.data || [];
                    const rowsB = contextData?.b?.data || [];
                    const filteredA = filterRows(rowsA, userQuestion).map((r) => ({ ...r, __source: 'A' }));
                    const filteredB = filterRows(rowsB, userQuestion).map((r) => ({ ...r, __source: 'B' }));
                    filteredRows = [...filteredA, ...filteredB].slice(0, 8);
                } else {
                    const rows = contextData?.data || [];
                    filteredRows = filterRows(rows, userQuestion).slice(0, 8);
                }
            }

            const rowsLayer = filteredRows.length
                ? `\n\nRELEVANT ROWS (projected, limited):\n${JSON.stringify(filteredRows)}`
                : '';

            const prompt = `
You are the iBill forensic audit assistant.
Use SUMMARY_CONTEXT_JSON as the primary source of truth for all general and summary-level questions.
Only use RELEVANT ROWS when they are included (do not assume missing numbers).

Rules:
- Do not guess. If the answer isn't supported by the provided summary/rows, say what additional data is needed.
- Keep the response concise but audit-actionable.
- Return plain text. Do NOT use Markdown formatting (no leading '*' bullets, no '**bold**').

SUMMARY_CONTEXT_JSON:
${JSON.stringify(summaryLayer)}
${rowsLayer}

Conversation so far:
${existingHistory || '(none)'}

User question:
${userQuestion}
`.trim();

            const result = await fetchOpenAIChatCompletion({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                maxTokens: 900,
                temperature: 0.25,
                topP: 0.9
            });

            const answer = sanitizeAiText(result?.choices?.[0]?.message?.content || '');
            setMessages((prev) => [...prev, { role: 'ai', text: answer }]);
            if (speakOnReply) speakEnglish(answer);
        } catch (err) {
            setMessages((prev) => [...prev, { role: 'error', text: 'Forensic Module Error: ' + err.message }]);
        } finally {
            setIsLoading(false);
        }
    };

    // (No API key UI)

    return (
        <div style={{ position: 'relative', zIndex: 9999 }}>
            <motion.button 
                whileHover={{ scale: 1.1, rotate: 5 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setIsOpen(!isOpen)}
                style={{ 
                    position: 'fixed', bottom: 'max(28px, env(safe-area-inset-bottom, 0px))', right: 'max(24px, env(safe-area-inset-right, 0px))', 
                    width: '72px', height: '72px', borderRadius: '24px', 
                    background: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)', 
                    border: 'none', color: 'white', display: 'flex', 
                    alignItems: 'center', justifyContent: 'center', 
                    boxShadow: '0 15px 35px rgba(99, 102, 241, 0.4)', zIndex: 1000, cursor: 'pointer' 
                }}
            >
                {isOpen ? <X size={34} /> : <MessageSquare size={34} />}
            </motion.button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div 
                        initial={{ opacity: 0, y: 30, scale: 0.9, filter: 'blur(10px)' }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, y: 30, scale: 0.9, filter: 'blur(10px)' }}
                        className="glass-panel"
                style={{ 
                    position: 'fixed', bottom: '112px', right: 'max(24px, env(safe-area-inset-right, 0px))', 
                            width: 'min(560px, calc(100vw - 32px))',
                            height: 'min(700px, calc(100vh - 220px))',
                            maxHeight: 'calc(100vh - 220px)',
                            zIndex: 1000, 
                            display: 'flex', flexDirection: 'column', 
                            border: '1px solid rgba(255,255,255,0.1)', overflow: 'hidden', 
                            boxShadow: '0 30px 60px rgba(0,0,0,0.6)', borderRadius: '24px',
                            background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(20px)'
                        }}
                    >
                        <div style={{ padding: '20px 26px', background: 'rgba(99, 102, 241, 0.1)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <h3 style={{ fontSize: '1.28rem', fontWeight: '900', color: 'white', letterSpacing: '-0.5px' }}>
                                    Telecom Help
                                </h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                    <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }}></span>
                                    <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                        {type === 'general' ? 'Knowledge Base' : 'System Active'}
                                    </span>
                                </div>
                            </div>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '1px' }}>
                                Voice enabled
                            </div>
                        </div>

                        {/* Key UI removed */}

                        <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: '18px' }} className="chat-scroll">
                            {messages.length === 0 && (
                                <div style={{ textAlign: 'center', marginTop: '80px', padding: '0 40px' }}>
                                    <div style={{ width: '80px', height: '80px', borderRadius: '24px', background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
                                        <Radio className="text-primary" size={40} />
                                    </div>
                                    <h4 style={{ color: 'white', marginBottom: '12px', fontWeight: '800' }}>
                                        {type === 'general' ? 'Telecom Q&A' : 'Analysis Cross-Verification'}
                                    </h4>
                                    <p style={{ fontSize: '0.98rem', color: '#64748b', lineHeight: '1.65' }}>
                                        {type === 'general'
                                            ? 'Ask telecom/tower questions (iBill, iTower modules, energy billing, revenue assurance). No invoice upload required.'
                                            : 'Ask deep-layer questions about regional anomalies, site variances, or energy mix shifts. I have the full context of the current audit data.'}
                                    </p>
                                </div>
                            )}
                            {!!kbHint && (
                                <div style={{ fontSize: '0.78rem', color: 'rgba(203,213,225,0.85)', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', borderRadius: '12px' }}>
                                    {kbHint}
                                </div>
                            )}
                            {messages.map((m, i) => (
                                <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: m.role === 'user' ? '88%' : '96%' }}>
                                    <div style={{ 
                                        background: m.role === 'user' ? 'var(--primary)' : 'rgba(255,255,255,0.03)', 
                                        padding: '16px 22px', 
                                        borderRadius: m.role === 'user' ? '24px 24px 4px 24px' : '24px 24px 24px 4px', 
                                        fontSize: '1.02rem', 
                                        color: m.role === 'error' ? '#f87171' : 'white', 
                                        border: m.role === 'ai' || m.role === 'error' ? '1px solid rgba(255,255,255,0.05)' : 'none',
                                        lineHeight: '1.65',
                                        boxShadow: m.role === 'user' ? '0 10px 20px rgba(99, 102, 241, 0.2)' : 'none'
                                    }}>
                                        {m.text}
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div style={{ alignSelf: 'flex-start', background: 'rgba(255,255,255,0.02)', padding: '16px 24px', borderRadius: '24px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                    <RefreshCw className="animate-spin text-primary" size={20} />
                                </div>
                            )}
                        </div>

                        <div style={{ padding: '20px 22px 22px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.2)' }}>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                <input 
                                    type="text" 
                                    placeholder="Question the audit..."
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                    style={{ flex: 1, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '17px 22px', color: 'white', fontSize: '1.02rem', outline: 'none', transition: 'border 0.3s ease' }}
                                    onFocus={(e) => e.target.style.borderColor = 'var(--primary)'}
                                    onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
                                />
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={isListening ? stopListening : startListening}
                                    disabled={!speechSupported || isLoading}
                                    title={speechSupported ? (isListening ? 'Stop voice input' : 'Speak (English)') : 'Speech recognition not supported in this browser'}
                                    style={{
                                        background: isListening ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        color: 'white',
                                        width: '56px',
                                        height: '56px',
                                        borderRadius: '16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: speechSupported ? 'pointer' : 'not-allowed',
                                        opacity: speechSupported ? 1 : 0.5
                                    }}
                                >
                                    <Mic size={22} />
                                </motion.button>
                                <motion.button 
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={handleSend} 
                                    disabled={isLoading} 
                                    style={{ background: 'var(--primary)', border: 'none', color: 'white', width: '60px', height: '60px', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 10px 20px rgba(99, 102, 241, 0.3)' }}
                                >
                                    <Send size={24} />
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={() => {
                                        const next = !speakOnReply;
                                        setSpeakOnReply(next);
                                        localStorage.setItem('IBILL_SPEAK_ON_REPLY', next ? '1' : '0');
                                        if (!next) stopSpeaking();
                                    }}
                                    disabled={isLoading}
                                    title="Read AI replies aloud (English)"
                                    style={{
                                        background: speakOnReply ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.05)',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        color: 'white',
                                        width: '56px',
                                        height: '56px',
                                        borderRadius: '16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <Volume2 size={22} />
                                </motion.button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const ChargeBuilder = ({ onBack, currentUser }) => {
    const [chargeName, setChargeName] = useState('');
    const [expression, setExpression] = useState('');
    const DEFAULT_LOCATION_1_REGION_ID = "618d0e4fb827de2795bf7294";
    const COUNTRIES = [
        { code: 'TZ', label: 'Tanzania', id: '618d0d9fb827de2795bf6f3e' },
        { code: 'MW', label: 'Malawi', id: '62581c48f3102aa41f59ff42' },
        { code: 'DRC', label: 'DRC', id: '66a9d436f4ca795a27c6dbf5' },
        { code: 'CB', label: 'Congo B', id: '66aa11b9f4ca795a27cb3433' },
        { code: 'MG', label: 'Madagascar', id: '66e12bc6f8c6b918992c2b28' },
        { code: 'GH', label: 'Ghana', id: '66e12be0f8c6b918992c2ccb' },
        { code: 'SN', label: 'Senegal', id: '66f12910f8c6b9189922da7c' },
        { code: 'OM', label: 'Oman', id: '66f2b865f8c6b91899952960' },
        { code: 'ZA', label: 'South Africa', id: '6717314ef8c6b91899e17154' }
    ];
    const [countryCode, setCountryCode] = useState('OM');
    const [startDateInput, setStartDateInput] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    });
    const [status, setStatus] = useState('Approve');
    const [noOfDecimalPlaces, setNoOfDecimalPlaces] = useState('4');
    const [error, setError] = useState(null);
    const [bulkFile, setBulkFile] = useState(null);
    const [bulkRows, setBulkRows] = useState([]);
    const [bulkError, setBulkError] = useState(null);

    const createdBy = (currentUser?.email || 'System').split('@')[0] || 'System';
    const toDDMonFromDateInput = (yyyyMmDd) => {
        if (!yyyyMmDd) return formatDateDDMonYYYY(new Date());
        const d = new Date(`${yyyyMmDd}T00:00:00`);
        if (isNaN(d.getTime())) return formatDateDDMonYYYY(new Date());
        return formatDateDDMonYYYY(d);
    };
    const sanitizeSingleDigit = (value, fallback = '4') => {
        const match = (value ?? '').toString().match(/[0-9]/);
        return match ? match[0] : fallback;
    };
    const normalizeBulkStartDate = (rawValue, fallbackInputDate) => {
        if (rawValue === null || rawValue === undefined || rawValue === '') {
            return toDDMonFromDateInput(fallbackInputDate);
        }
        if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
            return formatDateDDMonYYYY(rawValue);
        }
        if (typeof rawValue === 'number' && isFinite(rawValue) && rawValue > 0) {
            const parts = XLSX.SSF.parse_date_code(rawValue);
            if (parts?.y && parts?.m && parts?.d) {
                return formatDateDDMonYYYY(new Date(parts.y, parts.m - 1, parts.d));
            }
        }
        const text = rawValue.toString().trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
            return toDDMonFromDateInput(text);
        }
        return text;
    };
    const downloadSampleExcel = () => {
        const sampleRows = [{
            chargeName: "Adjusted base Allowances OM",
            expression: "IF([GRANDFATHERING_ALLOWANCE]<>0,[GRANDFATHERING_ALLOWANCE],[CONTRACTUAL_ALLOWANCES])",
            countryCode: "OM",
            startDate: startDateInput,
            status: "Approve",
            noOfDecimalPlaces: "4"
        }];
        const ws = XLSX.utils.json_to_sheet(sampleRows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "charges");
        XLSX.writeFile(wb, "ChargeBuilder_Sample.xlsx");
    };

    const parseBulkFile = (file) => {
        setBulkError(null);
        setBulkRows([]);
        setBulkFile(file || null);
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                if (!wsname) throw new Error("The file appears to be empty or invalid.");
                const ws = wb.Sheets[wsname];
                const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

                if (!rows || rows.length === 0) throw new Error("No readable rows found in this sheet.");

                const required = ['chargeName', 'expression'];
                const headerKeys = new Set(Object.keys(rows[0] || {}));
                const missing = required.filter(k => !headerKeys.has(k));
                if (missing.length > 0) {
                    throw new Error(`Missing required column(s): ${missing.join(', ')}. Please follow the naming convention exactly.`);
                }

                setBulkRows(rows);
            } catch (e) {
                setBulkError(e?.message || "Failed to parse the Excel file.");
            }
        };
        reader.onerror = () => setBulkError("File reader error. The file might be corrupted.");
        reader.readAsBinaryString(file);
    };

    const bulkDocs = React.useMemo(() => {
        const selectedCountryDefault = COUNTRIES.find(c => c.code === countryCode) || COUNTRIES[0];
        const currentCountryDefault = selectedCountryDefault?.id || null;
        const location2Default = selectedCountryDefault?.id || null;
        const location1 = DEFAULT_LOCATION_1_REGION_ID;

        const nowIso = new Date().toISOString();

        const charges = [];
        const chargeAtts = [];

        const pushError = (msg) => ({ rowError: msg });

        const cleaned = (v) => (v ?? '').toString().trim();

        for (let i = 0; i < (bulkRows || []).length; i++) {
            const row = bulkRows[i] || {};
            const rowChargeName = cleaned(row.chargeName);
            const rowExpression = cleaned(row.expression);
            const rowStatus = cleaned(row.status) || (status || '').trim() || 'Approve';
            const rowNoDp = sanitizeSingleDigit(cleaned(row.noOfDecimalPlaces), sanitizeSingleDigit(noOfDecimalPlaces, '4'));
            const rowStartDate = normalizeBulkStartDate(row.startDate, startDateInput);

            const rowCountryCode = cleaned(row.countryCode) || countryCode;
            const selectedCountry = COUNTRIES.find(c => c.code === rowCountryCode) || selectedCountryDefault;
            const currentCountry = selectedCountry?.id || currentCountryDefault;
            const location2 = selectedCountry?.id || location2Default;

            if (!rowChargeName || !rowExpression) {
                charges.push(pushError(`Row ${i + 2}: chargeName and expression are required.`));
                chargeAtts.push(pushError(`Row ${i + 2}: chargeName and expression are required.`));
                continue;
            }
            if (!currentCountry || !location1 || !location2) {
                charges.push(pushError(`Row ${i + 2}: invalid countryCode (supported: ${COUNTRIES.map(c => c.code).join(', ')}).`));
                chargeAtts.push(pushError(`Row ${i + 2}: invalid countryCode (supported: ${COUNTRIES.map(c => c.code).join(', ')}).`));
                continue;
            }

            const idHex = randomObjectIdHex();

            const chargeDoc = {
                _id: idHex,
                name: rowChargeName,
                startDate: rowStartDate,
                billingType: "1",
                prorate: "1",
                billingEntity: "1",
                createdDate: nowIso,
                createdBy,
                modifiedDate: nowIso,
                currency: "0",
                Location_1: location1,
                Location_2: location2,
                escalation: "1",
                modifiedBy: createdBy,
                currentCountry: currentCountry,
                isChargeBasis: null,
                chargeBasis: null,
                Location_3: null,
                Location_4: null,
                endDate: null,
                eventValue: null,
                isEventCharge: null,
                country: null,
                Location_5: null,
                Location_6: null,
                remark: null,
                status: rowStatus
            };

            const chargeAttDoc = {
                _id: randomObjectIdHex(),
                parentId: idHex,
                attributeType: "expression",
                amount: null,
                dataType: "Number",
                expression: rowExpression,
                modifiedDate: nowIso,
                modifiedBy: createdBy,
                createdby: createdBy,
                createdDate: nowIso,
                currentCountry: currentCountry,
                matrixId: null,
                conditionName: null,
                condition: null,
                conditionText: null,
                additionalCondition: null,
                conditionExpression: null,
                noOfDecimalPlaces: rowNoDp,
                expressionName: rowChargeName,
                aggregatedfield: null,
                aggregatedOperation: null
            };

            charges.push(chargeDoc);
            chargeAtts.push(chargeAttDoc);
        }

        const hasRowErrors =
            charges.some(x => x && typeof x === 'object' && 'rowError' in x) ||
            chargeAtts.some(x => x && typeof x === 'object' && 'rowError' in x);

        const isValid = (bulkRows || []).length > 0 && !hasRowErrors;

        return {
            isValid,
            chargesText: toMongoBulkDocString(charges),
            chargeAttsText: toMongoBulkDocString(chargeAtts),
            rowCount: (bulkRows || []).length,
            hasRowErrors
        };
    }, [bulkRows, countryCode, startDateInput, status, noOfDecimalPlaces, createdBy]);

    const buildDocs = React.useMemo(() => {
        const selectedCountry = COUNTRIES.find(c => c.code === countryCode) || COUNTRIES[0];
        const currentCountry = selectedCountry?.id || null;
        const location2 = selectedCountry?.id || null; // Location_2 == currentCountry
        const location1 = DEFAULT_LOCATION_1_REGION_ID; // Fixed region

        const nowIso = new Date().toISOString();
        const idHex = randomObjectIdHex();

        const chargeDoc = {
            _id: idHex,
            name: chargeName?.trim() || '',
            startDate: toDDMonFromDateInput(startDateInput),
            billingType: "1",
            prorate: "1",
            billingEntity: "1",
            createdDate: nowIso,
            createdBy,
            modifiedDate: nowIso,
            currency: "0",
            Location_1: location1,
            Location_2: location2,
            escalation: "1",
            modifiedBy: createdBy,
            currentCountry: currentCountry,
            isChargeBasis: null,
            chargeBasis: null,
            Location_3: null,
            Location_4: null,
            endDate: null,
            eventValue: null,
            isEventCharge: null,
            country: null,
            Location_5: null,
            Location_6: null,
            remark: null,
            status: (status || '').trim() || "Approve"
        };

        const chargeAttDoc = {
            _id: randomObjectIdHex(),
            parentId: idHex,
            attributeType: "expression",
            amount: null,
            dataType: "Number",
            expression: expression || '',
            modifiedDate: nowIso,
            modifiedBy: createdBy,
            createdby: createdBy,
            createdDate: nowIso,
            currentCountry: currentCountry,
            matrixId: null,
            conditionName: null,
            condition: null,
            conditionText: null,
            additionalCondition: null,
            conditionExpression: null,
            noOfDecimalPlaces: sanitizeSingleDigit(noOfDecimalPlaces, '4'),
            expressionName: chargeName?.trim() || '',
            aggregatedfield: null,
            aggregatedOperation: null
        };

        const isValid =
            (chargeName || '').trim().length > 0 &&
            (expression || '').trim().length > 0 &&
            !!currentCountry &&
            !!location1 &&
            !!location2;

        return {
            isValid,
            idHex,
            chargeDocText: toMongoDocString(chargeDoc),
            chargeAttDocText: toMongoDocString(chargeAttDoc)
        };
    }, [chargeName, expression, countryCode, startDateInput, status, noOfDecimalPlaces, createdBy]);

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
        } catch (_e) {
            setError("Copy failed (clipboard blocked). Select the text and copy manually.");
        }
    };

    const downloadText = (filename, text) => {
        const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const handleGenerate = () => {
        setError(null);
        if (!buildDocs.isValid) {
            setError("Fill charge name and expression.");
        }
    };

    return (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="report-container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <PlusCircle className="text-primary" size={18} />
                        <span style={{ fontSize: '0.75rem', fontWeight: '800', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Mongo Charge Composer</span>
                    </div>
                    <h1 style={{ fontSize: '2rem', fontWeight: '900', letterSpacing: '-0.5px' }}>Create Charge</h1>
                    <p style={{ color: 'var(--text-dim)', marginTop: '8px' }}>
                        Generates both documents for `Charges` and `ChargeAtt` with linked IDs. Country sets both `currentCountry` and `Location_2`. Region (`Location_1`) is handled internally.
                    </p>
                </div>
                <button onClick={onBack} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <ArrowLeft size={18} /> Back
                </button>
            </div>

            {error && (
                <div className="glass-panel" style={{ padding: '16px 18px', marginBottom: '18px', borderLeft: '4px solid #ef4444' }}>
                    <div style={{ color: '#f87171', fontWeight: 800 }}>{error}</div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="glass-panel" style={{ padding: '20px' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '900', marginBottom: '14px' }}>Inputs</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 'bold' }}>Charge Name</label>
                            <input value={chargeName} onChange={(e) => setChargeName(e.target.value)} placeholder="e.g., Adjusted base Allowances OM"
                                style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px', borderRadius: '12px', color: 'white', outline: 'none' }} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 'bold' }}>Charge Expression</label>
                            <textarea value={expression} onChange={(e) => setExpression(e.target.value)}
                                placeholder='e.g., IF([GRANDFATHERING_ALLOWANCE]<>0,[GRANDFATHERING_ALLOWANCE],[CONTRACTUAL_ALLOWANCES])'
                                rows={4}
                                style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px', borderRadius: '12px', color: 'white', outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 'bold' }}>Country</label>
                                <select
                                    value={countryCode}
                                    onChange={(e) => setCountryCode(e.target.value)}
                                    style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px', borderRadius: '12px', color: 'white', outline: 'none' }}
                                >
                                    {COUNTRIES.map(c => (
                                        <option key={c.code} value={c.code}>{c.label}</option>
                                    ))}
                                </select>
                                <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                                    currentCountry / Location_2: {COUNTRIES.find(c => c.code === countryCode)?.id}
                                </div>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 'bold' }}>Start Date</label>
                                <input type="date" value={startDateInput} onChange={(e) => setStartDateInput(e.target.value)}
                                    style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px', borderRadius: '12px', color: 'white', outline: 'none' }} />
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 'bold' }}>Status</label>
                                <select value={status} onChange={(e) => setStatus(e.target.value)}
                                    style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px', borderRadius: '12px', color: 'white', outline: 'none' }}>
                                    <option value="Approve">Approve</option>
                                    <option value="Draft">Draft</option>
                                    <option value="Pending">Pending</option>
                                    <option value="Reject">Reject</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 'bold' }}>noOfDecimalPlaces</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="9"
                                    step="1"
                                    inputMode="numeric"
                                    value={noOfDecimalPlaces}
                                    onChange={(e) => setNoOfDecimalPlaces(sanitizeSingleDigit(e.target.value, ''))}
                                    placeholder="4"
                                    style={{ width: '100%', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', padding: '12px 14px', borderRadius: '12px', color: 'white', outline: 'none', fontFamily: 'monospace' }} />
                            </div>
                        </div>

                        <button onClick={handleGenerate} className="btn-primary" style={{ justifyContent: 'center', padding: '14px' }}>
                            Generate JSON
                        </button>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                            Linked parentId: <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{buildDocs.idHex}</span>
                        </div>
                    </div>
                </div>

                <div className="glass-panel" style={{ padding: '20px' }}>
                    <h3 style={{ fontSize: '0.9rem', fontWeight: '900', marginBottom: '14px' }}>Outputs</h3>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
                        <button className="btn-secondary" onClick={() => copyToClipboard(buildDocs.chargeDocText)} disabled={!buildDocs.isValid}>Copy `Charges.json`</button>
                        <button className="btn-secondary" onClick={() => copyToClipboard(buildDocs.chargeAttDocText)} disabled={!buildDocs.isValid}>Copy `ChargeAtt.json`</button>
                        <button className="btn-secondary" onClick={() => downloadText('Charges.json', buildDocs.chargeDocText)} disabled={!buildDocs.isValid}>Download `Charges.json`</button>
                        <button className="btn-secondary" onClick={() => downloadText('ChargeAtt.json', buildDocs.chargeAttDocText)} disabled={!buildDocs.isValid}>Download `ChargeAtt.json`</button>
                    </div>

                    <div style={{ marginBottom: '14px' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Charges.json</div>
                        <textarea readOnly value={buildDocs.chargeDocText}
                            style={{ width: '100%', height: '240px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '12px 14px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.5, outline: 'none', resize: 'vertical' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>ChargeAtt.json</div>
                        <textarea readOnly value={buildDocs.chargeAttDocText}
                            style={{ width: '100%', height: '240px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '12px 14px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.5, outline: 'none', resize: 'vertical' }} />
                    </div>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '20px', marginTop: '20px' }}>
                <h3 style={{ fontSize: '0.9rem', fontWeight: '900', marginBottom: '10px' }}>Bulk Upload (Excel → JSON)</h3>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: '14px' }}>
                    <div style={{ fontWeight: 900, color: 'white', marginBottom: '6px' }}>Excel naming convention (exact headers)</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: '#e2e8f0' }}>
                        chargeName, expression
                    </div>
                    <div style={{ marginTop: '6px' }}>
                        Optional: <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>countryCode</span>, <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>startDate</span>, <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>status</span>, <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>noOfDecimalPlaces</span>
                    </div>
                    <div style={{ marginTop: '6px' }}>
                        <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>startDate</span>: use Excel date cell or <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>YYYY-MM-DD</span>. <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>noOfDecimalPlaces</span>: single digit 0-9.
                    </div>
                    <div style={{ marginTop: '6px' }}>
                        Note: <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>Location_1</span> is added internally (not shown to users).
                    </div>
                </div>

                {bulkError && (
                    <div className="glass-panel" style={{ padding: '14px 16px', marginBottom: '14px', borderLeft: '4px solid #ef4444' }}>
                        <div style={{ color: '#f87171', fontWeight: 800 }}>{bulkError}</div>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
                    <button className="btn-secondary" onClick={downloadSampleExcel}>
                        Download Sample Excel
                    </button>
                    <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={(e) => parseBulkFile(e.target.files?.[0])}
                        style={{ color: 'var(--text-dim)' }}
                    />
                    {bulkFile?.name && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                            Loaded: <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{bulkFile.name}</span> ({bulkDocs.rowCount} row{bulkDocs.rowCount === 1 ? '' : 's'})
                        </div>
                    )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    <div>
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                            <button className="btn-secondary" onClick={() => copyToClipboard(bulkDocs.chargesText)} disabled={!bulkDocs.isValid}>Copy `Charges.bulk.json`</button>
                            <button className="btn-secondary" onClick={() => downloadText('Charges.bulk.json', bulkDocs.chargesText)} disabled={!bulkDocs.isValid}>Download `Charges.bulk.json`</button>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Charges (documents)</div>
                        <textarea
                            readOnly
                            value={bulkDocs.chargesText}
                            style={{ width: '100%', height: '260px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '12px 14px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.5, outline: 'none', resize: 'vertical' }}
                        />
                    </div>
                    <div>
                        <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                            <button className="btn-secondary" onClick={() => copyToClipboard(bulkDocs.chargeAttsText)} disabled={!bulkDocs.isValid}>Copy `ChargeAtt.bulk.json`</button>
                            <button className="btn-secondary" onClick={() => downloadText('ChargeAtt.bulk.json', bulkDocs.chargeAttsText)} disabled={!bulkDocs.isValid}>Download `ChargeAtt.bulk.json`</button>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>ChargeAtt (documents)</div>
                        <textarea
                            readOnly
                            value={bulkDocs.chargeAttsText}
                            style={{ width: '100%', height: '260px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '12px 14px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.5, outline: 'none', resize: 'vertical' }}
                        />
                    </div>
                </div>

                {bulkDocs.hasRowErrors && (
                    <div style={{ marginTop: '12px', fontSize: '0.85rem', color: '#f87171', fontWeight: 800 }}>
                        Bulk validation failed. Fix the row errors (they are embedded as objects with <span style={{ fontFamily: 'monospace' }}>rowError</span>) and re-upload.
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export default function App() {
    const [view, setView] = useState('landing');
    const [currentInvoice, setCurrentInvoice] = useState(null);
    const [compareFiles, setCompareFiles] = useState({ a: null, b: null });
    const { currentUser, logout } = useAuth();

    const handleSelect = (invoice) => {
        setCurrentInvoice(invoice);
        setView('analysis');
        if (currentUser) {
            logActivity(currentUser.uid, `Analyzed Invoice: ${invoice.name}`, 'Success');
        }
    };

    const handleLogout = async () => {
        try {
            await logout();
        } catch (err) {
            console.error("Failed to log out", err);
        }
    };

    if (!currentUser) {
        return <Login />;
    }

    return (
        <div className="app-container">
            <nav className="glass-header">
                <div className="nav-content" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div className="logo" onClick={() => setView('landing')} style={{ cursor: 'pointer' }}>
                        <Radio className="text-primary" size={32} />
                        <span className="logo-text">iBill <span className="text-primary">Co-Pilot</span></span>
                    </div>
                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button 
                                onClick={() => setView('landing')} 
                                style={{ background: (view === 'landing' || view === 'analysis') ? 'rgba(99, 102, 241, 0.2)' : 'transparent', border: 'none', color: (view === 'landing' || view === 'analysis') ? 'var(--primary)' : '#94a3b8', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', transition: 'all 0.3s ease' }}
                            >
                                <FileSpreadsheet size={18} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'middle' }} /> Single Invoice Mode
                            </button>
                            <button 
                                onClick={() => setView('compare')} 
                                style={{ background: view === 'compare' || view === 'deep-compare' ? 'rgba(99, 102, 241, 0.2)' : 'transparent', border: 'none', color: view === 'compare' || view === 'deep-compare' ? 'var(--primary)' : '#94a3b8', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', transition: 'all 0.3s ease' }}
                            >
                                <span style={{ display: 'inline-block', transform: 'rotate(90deg)', marginRight: '8px', verticalAlign: 'middle' }}>&#8646;</span> Compare Mode
                            </button>
                            <button 
                                onClick={() => setView('charges')} 
                                style={{ background: view === 'charges' ? 'rgba(99, 102, 241, 0.2)' : 'transparent', border: 'none', color: view === 'charges' ? 'var(--primary)' : '#94a3b8', padding: '10px 20px', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', transition: 'all 0.3s ease' }}
                            >
                                <PlusCircle size={18} style={{ display: 'inline', marginRight: '8px', verticalAlign: 'middle' }} /> Charge Builder
                            </button>
                        </div>

                        <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)' }}></div>

                        <div className="user-profile" 
                            onClick={() => setView('profile')}
                            style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '10px', cursor: 'pointer' }}
                        >
                            <div className="user-info" style={{ textAlign: 'right', display: 'none', sm: 'block' }}>
                                <div style={{ fontSize: '0.8rem', fontWeight: 800, color: 'white' }}>{currentUser.email?.split('@')[0]}</div>
                                <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Forensic Auditor</div>
                            </div>
                            <div style={{ background: view === 'profile' ? 'var(--primary)' : 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)', padding: '8px', borderRadius: '10px', color: view === 'profile' ? 'white' : 'var(--primary)', transition: 'all 0.3s' }}>
                                <User size={18} />
                            </div>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleLogout();
                                }}
                                className="logout-btn"
                                title="Sign Out"
                                style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '8px', borderRadius: '10px', color: '#f87171', cursor: 'pointer', transition: 'all 0.2s' }}
                            >
                                <LogOut size={18} />
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            <main>
                <AnimatePresence mode="wait">
                    {view === 'landing' && <InvoiceSelector key="hero" onSelect={handleSelect} />}

                    {view === 'analysis' && (
                        <>
                            <ReportView
                                key="analysis"
                                invoice={currentInvoice}
                                onBack={() => setView('landing')}
                            />
                        </>
                    )}

                    {view === 'compare' && (
                        <>
                            <CompareInvoices
                                key="compare"
                                onBack={() => setView('landing')}
                                onDeepCompare={(a, b) => {
                                    setCompareFiles({ a, b });
                                    setView('deep-compare');
                                    if (currentUser) {
                                        logActivity(currentUser.uid, `Reconciled: ${a.name} vs ${b.name}`, 'Completed');
                                    }
                                }}
                            />
                        </>
                    )}

                    {view === 'deep-compare' && (
                        <DetailedComparison 
                            key="deep"
                            invoiceA={compareFiles.a}
                            invoiceB={compareFiles.b}
                            onBack={() => setView('compare')}
                        />
                    )}

                    {view === 'charges' && (
                        <ChargeBuilder
                            key="charges"
                            currentUser={currentUser}
                            onBack={() => setView('landing')}
                        />
                    )}

                    {view === 'profile' && (
                        <Profile 
                            key="profile"
                            onBack={() => setView('landing')}
                        />
                    )}
                </AnimatePresence>
            </main>

            <ForensicChat
                contextData={view === 'analysis' ? currentInvoice : (view === 'compare' ? compareFiles : null)}
                type={view === 'analysis' ? 'single' : (view === 'compare' ? 'compare' : 'general')}
            />

            <style>{`
                .btn-primary { background: var(--primary); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; }
                .btn-secondary { background: rgba(255,255,255,0.05); color: white; border: 1px solid rgba(255,255,255,0.1); padding: 10px 20px; border-radius: 8px; cursor: pointer; }
                .animate-spin { animation: spin 1s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes ibillDlSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                
                select option { background: #0f172a; color: white; }
                .table-row-hover:hover { background-color: rgba(99, 102, 241, 0.05) !important; }
                
                .chat-scroll::-webkit-scrollbar { width: 6px; }
                .chat-scroll::-webkit-scrollbar-track { background: transparent; }
                .chat-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); borderRadius: 10px; }
            `}</style>
        </div>
    );
}
