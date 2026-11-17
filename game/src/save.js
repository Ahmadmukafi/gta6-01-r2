// save.js — localStorage save: cash, health, armor, ammo, mission progress,
// golden palms, player position and time of day. Autosaves on mission complete.
const KEY = 'neon-shore-save-v1';

export function saveGame(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}
export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export function hasSave() {
  try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
}
export function clearSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
