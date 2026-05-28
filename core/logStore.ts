// Made by Yamach - Log storage with auto-pruning

import * as DataStore from "@api/DataStore";

import type { VoiceLog } from "../yamach/yamachTypes";

const LOG_KEY = "YamachVoiceUtilitiesPro_logs_v1";

let logs: VoiceLog[] = [];
let maxLogEntries = 10000;
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export function subscribeLogs(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function notify() {
    listeners.forEach(listener => listener());
}

function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        void DataStore.set(LOG_KEY, { logs });
    }, 800);
}

export async function loadLogs() {
    if (loaded) return;
    const stored = await DataStore.get<{ logs?: VoiceLog[]; }>(LOG_KEY);
    logs = stored?.logs ?? [];
    pruneIfNeeded();
    loaded = true;
}

export function setMaxLogEntries(limit: number) {
    const safe = Math.max(500, Math.min(100_000, Math.floor(limit)));
    if (safe === maxLogEntries) return;
    maxLogEntries = safe;
    pruneIfNeeded();
}

export function getMaxLogEntries() {
    return maxLogEntries;
}

function pruneIfNeeded() {
    if (logs.length <= maxLogEntries) return 0;
    const removeCount = logs.length - maxLogEntries;
    logs.splice(0, removeCount);
    schedulePersist();
    return removeCount;
}

export function pushLog(log: VoiceLog) {
    logs.push(log);
    pruneIfNeeded();
    schedulePersist();
    notify();
}

export function getLogs(): readonly VoiceLog[] {
    return logs;
}

export function setLogs(next: VoiceLog[]) {
    logs = next.slice(-maxLogEntries);
    schedulePersist();
    notify();
}

export function deleteLogById(id: string): boolean {
    const before = logs.length;
    logs = logs.filter(log => log.id !== id);
    const removed = logs.length !== before;
    if (removed) {
        schedulePersist();
        notify();
    }
    return removed;
}

export function deleteLogsByIds(ids: Set<string>) {
    const before = logs.length;
    logs = logs.filter(log => !ids.has(log.id));
    const removed = before - logs.length;
    if (removed) {
        schedulePersist();
        notify();
    }
    return removed;
}

export function pruneOlderThan(timestampMs: number) {
    const before = logs.length;
    logs = logs.filter(log => log.timestamp >= timestampMs);
    const removed = before - logs.length;
    if (removed) {
        schedulePersist();
        notify();
    }
    return removed;
}

export function clearAllLogs() {
    logs = [];
    schedulePersist();
    notify();
}

export function getLogsByUserId(userId: string, limit = 0) {
    const filtered = logs.filter(log => log.userId === userId);
    return limit > 0 ? filtered.slice(-limit) : filtered;
}

export function getLogStats() {
    const bytes = new Blob([JSON.stringify(logs)]).size;
    return {
        count: logs.length,
        maxCount: maxLogEntries,
        bytes,
        oldestTimestamp: logs[0]?.timestamp ?? 0,
        newestTimestamp: logs[logs.length - 1]?.timestamp ?? 0,
    };
}

export function flushPersist() {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    return DataStore.set(LOG_KEY, { logs });
}
