// Made by Yamach - Global keyboard shortcuts

type ShortcutHandler = (event: KeyboardEvent) => void;

type ShortcutConfig = {
    id: string;
    keys: string;
    handler: ShortcutHandler;
    description?: string;
};

const shortcuts = new Map<string, ShortcutConfig>();
let listenerAttached = false;

function normalizeKeys(keys: string) {
    return keys
        .toLowerCase()
        .split("+")
        .map(part => part.trim())
        .sort()
        .join("+");
}

function eventToKeys(event: KeyboardEvent) {
    const parts: string[] = [];
    if (event.ctrlKey) parts.push("ctrl");
    if (event.metaKey) parts.push("meta");
    if (event.altKey) parts.push("alt");
    if (event.shiftKey) parts.push("shift");
    const key = event.key.toLowerCase();
    if (key !== "control" && key !== "meta" && key !== "alt" && key !== "shift") parts.push(key);
    return parts.sort().join("+");
}

function isInsideInput(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if (target.isContentEditable) return true;
    return false;
}

function onKeyDown(event: KeyboardEvent) {
    if (isInsideInput(event.target)) return;
    const pressed = eventToKeys(event);

    for (const shortcut of shortcuts.values()) {
        if (normalizeKeys(shortcut.keys) === pressed) {
            event.preventDefault();
            event.stopPropagation();
            shortcut.handler(event);
            return;
        }
    }
}

export function registerShortcut(config: ShortcutConfig) {
    shortcuts.set(config.id, config);
    if (!listenerAttached) {
        window.addEventListener("keydown", onKeyDown, { capture: true });
        listenerAttached = true;
    }
    return () => unregisterShortcut(config.id);
}

export function unregisterShortcut(id: string) {
    shortcuts.delete(id);
    if (shortcuts.size === 0 && listenerAttached) {
        window.removeEventListener("keydown", onKeyDown, { capture: true } as any);
        listenerAttached = false;
    }
}

export function unregisterAllShortcuts() {
    shortcuts.clear();
    if (listenerAttached) {
        window.removeEventListener("keydown", onKeyDown, { capture: true } as any);
        listenerAttached = false;
    }
}

export function listShortcuts(): ShortcutConfig[] {
    return [...shortcuts.values()];
}
