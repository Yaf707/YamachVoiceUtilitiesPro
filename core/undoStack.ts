// Made by Yamach - Undo stack for voice operations

import { showToast, Toasts } from "@webpack/common";

import { t } from "../i18n";
import { PatchJob } from "../types";

export type UndoEntry = {
    id: string;
    label: string;
    timestamp: number;
    guildId: string;
    reverseJobs: PatchJob[];
};

const MAX_UNDO_ENTRIES = 20;
const undoStack: UndoEntry[] = [];
const listeners = new Set<() => void>();

export function subscribeUndo(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function notify() {
    listeners.forEach(listener => listener());
}

export function pushUndoEntry(entry: Omit<UndoEntry, "id" | "timestamp">) {
    if (!entry.reverseJobs.length) return;

    const undoEntry: UndoEntry = {
        ...entry,
        id: `undo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        timestamp: Date.now(),
    };

    undoStack.push(undoEntry);
    if (undoStack.length > MAX_UNDO_ENTRIES) undoStack.shift();
    notify();
}

export function getUndoStack(): readonly UndoEntry[] {
    return undoStack;
}

export function getLastUndoEntry(guildId?: string) {
    if (guildId) {
        for (let i = undoStack.length - 1; i >= 0; i--) {
            if (undoStack[i].guildId === guildId) return undoStack[i];
        }
        return null;
    }
    return undoStack[undoStack.length - 1] ?? null;
}

export function popUndoEntry(entryId?: string) {
    if (!entryId) {
        const entry = undoStack.pop();
        notify();
        return entry ?? null;
    }

    const index = undoStack.findIndex(entry => entry.id === entryId);
    if (index === -1) return null;
    const [entry] = undoStack.splice(index, 1);
    notify();
    return entry;
}

export function clearUndoStack() {
    undoStack.length = 0;
    notify();
    showToast(t("undoCleared"), Toasts.Type.SUCCESS);
}

export function canUndo(guildId?: string) {
    if (guildId) return undoStack.some(entry => entry.guildId === guildId);
    return undoStack.length > 0;
}
