// Settings and assessment history, kept only in this browser (localStorage).

const SETTINGS_KEY = 'gaitcam.settings';
const HISTORY_KEY = 'gaitcam.history';
const MAX_HISTORY = 50;

export const DEFAULT_SETTINGS = { units: 'metric', model: 'full', fovDeg: 67, scaleAdj: 100, mirrored: false };

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable */ }
}

export function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveSession(session) {
  const list = loadHistory().filter((s) => s.id !== session.id);
  list.unshift(session);
  list.length = Math.min(list.length, MAX_HISTORY);
  // Drop the oldest entries if storage is full.
  while (list.length) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
      return true;
    } catch {
      list.pop();
    }
  }
  return false;
}

export function deleteSession(id) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(loadHistory().filter((s) => s.id !== id)));
  } catch { /* storage unavailable */ }
}
