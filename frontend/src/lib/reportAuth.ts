const REPORT_HISTORY_KEY = "quakelens_damage_report_history_v1";

interface LocalReportAuth {
  id: string;
  passcode: string;
}

export function readLocalReportAuth(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(REPORT_HISTORY_KEY);
    if (!raw) return {};
    const arr = JSON.parse(raw) as LocalReportAuth[];
    if (!Array.isArray(arr)) return {};
    const out: Record<string, string> = {};
    for (const item of arr) {
      if (item?.id && item?.passcode) out[item.id] = item.passcode;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveLocalReportAuth(id: string, passcode: string) {
  if (typeof window === "undefined" || !passcode) return;
  try {
    const prev = readLocalReportAuth();
    prev[id] = passcode;
    const list: LocalReportAuth[] = Object.entries(prev)
      .slice(-30)
      .map(([k, v]) => ({ id: k, passcode: v }));
    window.localStorage.setItem(REPORT_HISTORY_KEY, JSON.stringify(list));
  } catch {
    // ignore storage errors
  }
}
