// Made by Yamach

import { settings } from "./settings";

type ShortcutAction = "openPanel" | "pullToMe" | "clearSelection" | "undo";

type ParsedShortcut = {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
    key: string;
};

function parseShortcut(value: string | undefined): ParsedShortcut | null {
    if (!value) return null;
    const parts = value.toLowerCase().split(/[\s+]+/).filter(Boolean);
    if (!parts.length) return null;

    let ctrl = false, shift = false, alt = false, meta = false;
    let key = "";

    for (const part of parts) {
        if (part === "ctrl" || part === "control") ctrl = true;
        else if (part === "shift") shift = true;
        else if (part === "alt" || part === "option") alt = true;
        else if (part === "meta" || part === "cmd" || part === "win" || part === "super") meta = true;
        else key = part;
    }

    if (!key) return null;
    return { ctrl, shift, alt, meta, key };
}

function matchesShortcut(event: KeyboardEvent, shortcut: ParsedShortcut | null) {
    if (!shortcut) return false;
    if (shortcut.ctrl !== event.ctrlKey) return false;
    if (shortcut.shift !== event.shiftKey) return false;
    if (shortcut.alt !== event.altKey) return false;
    if (shortcut.meta !== event.metaKey) return false;
    return shortcut.key === event.key.toLowerCase();
}

type ShortcutHandlers = Partial<Record<ShortcutAction, () => void>>;

let activeHandlers: ShortcutHandlers | null = null;
let activeListener: ((event: KeyboardEvent) => void) | null = null;

function shouldIgnoreEvent(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    const tag = target.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (target.isContentEditable) return true;
    return false;
}

export function startShortcuts(handlers: ShortcutHandlers) {
    stopShortcuts();
    activeHandlers = handlers;
    activeListener = (event: KeyboardEvent) => {
        if (!settings.store.enableKeyboardShortcuts) return;
        if (shouldIgnoreEvent(event)) return;

        const config: Array<[ShortcutAction, string | undefined]> = [
            ["openPanel", settings.store.shortcutOpenPanel],
            ["pullToMe", settings.store.shortcutPullToMe],
            ["clearSelection", settings.store.shortcutClearSelection],
            ["undo", (settings.store as any).shortcutUndo],
        ];

        for (const [action, value] of config) {
            const parsed = parseShortcut(value);
            if (parsed && matchesShortcut(event, parsed)) {
                const handler = handlers[action];
                if (handler) {
                    event.preventDefault();
                    event.stopPropagation();
                    handler();
                }
                return;
            }
        }
    };

    window.addEventListener("keydown", activeListener, true);
}

export function stopShortcuts() {
    if (activeListener) {
        window.removeEventListener("keydown", activeListener, true);
        activeListener = null;
    }
    activeHandlers = null;
}
