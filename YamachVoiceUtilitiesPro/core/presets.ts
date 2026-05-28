// Made by Yamach - Member group presets (Bookmarks)

import * as DataStore from "@api/DataStore";

const PRESETS_KEY = "YamachVoiceUtilitiesPro_presets_v1";

export type MemberPreset = {
    id: string;
    name: string;
    color: string;
    guildId?: string | null;
    userIds: string[];
    createdAt: number;
    updatedAt: number;
};

let presets = new Map<string, MemberPreset>();
let loaded = false;
const listeners = new Set<() => void>();

export function subscribePresets(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function notify() {
    void persist();
    listeners.forEach(listener => listener());
}

export async function loadPresets() {
    if (loaded) return;
    const stored = await DataStore.get<Record<string, MemberPreset>>(PRESETS_KEY);
    presets = new Map(Object.entries(stored ?? {}));
    loaded = true;
}

async function persist() {
    const out: Record<string, MemberPreset> = {};
    for (const [id, preset] of presets) out[id] = preset;
    await DataStore.set(PRESETS_KEY, out);
}

export function listPresets(guildId?: string | null): MemberPreset[] {
    const all = [...presets.values()];
    const filtered = guildId ? all.filter(preset => !preset.guildId || preset.guildId === guildId) : all;
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getPreset(id: string) {
    return presets.get(id) ?? null;
}

export function createPreset(input: { name: string; color?: string; guildId?: string | null; userIds: string[]; }) {
    const id = `preset-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const now = Date.now();
    const preset: MemberPreset = {
        id,
        name: input.name.trim() || `Preset ${presets.size + 1}`,
        color: input.color || "#f0b232",
        guildId: input.guildId ?? null,
        userIds: [...new Set(input.userIds)],
        createdAt: now,
        updatedAt: now,
    };
    presets.set(id, preset);
    notify();
    return preset;
}

export function updatePreset(id: string, patch: Partial<Omit<MemberPreset, "id" | "createdAt">>) {
    const preset = presets.get(id);
    if (!preset) return null;
    const updated: MemberPreset = { ...preset, ...patch, updatedAt: Date.now() };
    if (patch.userIds) updated.userIds = [...new Set(patch.userIds)];
    presets.set(id, updated);
    notify();
    return updated;
}

export function deletePreset(id: string) {
    const existed = presets.delete(id);
    if (existed) notify();
    return existed;
}

export function clearAllPresets() {
    presets.clear();
    notify();
}

export function importPresets(data: Record<string, MemberPreset>) {
    let imported = 0;
    for (const [id, preset] of Object.entries(data ?? {})) {
        if (!preset?.userIds || !Array.isArray(preset.userIds)) continue;
        presets.set(id, { ...preset, id });
        imported++;
    }
    if (imported) notify();
    return imported;
}

export function exportPresets() {
    const out: Record<string, MemberPreset> = {};
    for (const [id, preset] of presets) out[id] = preset;
    return out;
}
