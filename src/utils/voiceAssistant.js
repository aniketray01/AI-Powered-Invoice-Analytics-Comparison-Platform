// Lightweight Web Speech API helpers (browser only).
// SpeechRecognition is optional; we guard all calls.

export const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

export const isSpeechSynthesisSupported = () => {
  if (typeof window === 'undefined') return false;
  return !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance !== 'undefined';
};

export const stopSpeaking = () => {
  if (!isSpeechSynthesisSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch (_) {}
};

export const speakEnglish = (text, { rate = 1, pitch = 1, volume = 1 } = {}) => {
  if (!text || typeof text !== 'string') return;
  if (!isSpeechSynthesisSupported()) return;

  stopSpeaking();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = rate;
  utter.pitch = pitch;
  utter.volume = volume;

  // Best effort; if user agent blocks, we silently fail.
  try {
    window.speechSynthesis.speak(utter);
  } catch (_) {}
};

// Normalize common telecom brand/product mishears from speech-to-text.
export const normalizeSpeechTranscript = (text) => {
  if (!text || typeof text !== 'string') return '';
  let out = text.trim();
  if (!out) return '';

  const replacements = [
    [/\beye\s*bill\b/gi, 'iBill'],
    [/\bi\s*bill\b/gi, 'iBill'],
    [/\bai\s*bill\b/gi, 'iBill'],
    [/\beye\s*rocks?\b/gi, 'iROC'],
    [/\bi\s*rock\b/gi, 'iROC'],
    [/\beye\s*tower\b/gi, 'iTower'],
    [/\bi\s*tower\b/gi, 'iTower'],
    [/\beye\s*maintain\b/gi, 'iMaintain'],
    [/\bi\s*maintain\b/gi, 'iMaintain'],
    [/\beye\s*asset\b/gi, 'iAsset'],
    [/\bi\s*asset\b/gi, 'iAsset'],
    [/\beye\s*analytics\b/gi, 'iAnalytics'],
    [/\bi\s*analytics\b/gi, 'iAnalytics'],
    [/\beye\s*recon\b/gi, 'iRecon'],
    [/\bi\s*recon\b/gi, 'iRecon']
  ];

  replacements.forEach(([pattern, value]) => {
    out = out.replace(pattern, value);
  });

  return out;
};

