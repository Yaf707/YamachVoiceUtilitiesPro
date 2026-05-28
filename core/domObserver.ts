// Made by Yamach - Optimized scoped DOM observer

type DomCallback = () => void;

type ScopedObserverOptions = {
    onChange: DomCallback;
    debounceMs?: number;
    relevantSelectors?: string[];
    ignoreClassPrefixes?: string[];
};

export class ScopedDomObserver {
    private observer: MutationObserver | null = null;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private lastFiredAt = 0;
    private readonly debounceMs: number;
    private readonly relevantSelectors: string[];
    private readonly ignorePrefixes: string[];
    private readonly callback: DomCallback;

    constructor(options: ScopedObserverOptions) {
        this.callback = options.onChange;
        this.debounceMs = options.debounceMs ?? 140;
        this.relevantSelectors = options.relevantSelectors ?? [];
        this.ignorePrefixes = options.ignoreClassPrefixes ?? [];
    }

    start(root: Node = document.body) {
        this.stop();
        this.observer = new MutationObserver(mutations => {
            if (this.shouldIgnore(mutations)) return;
            this.queue();
        });
        this.observer.observe(root, { childList: true, subtree: true });
        this.queue();
    }

    stop() {
        this.observer?.disconnect();
        this.observer = null;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    private queue() {
        if (this.debounceTimer) return;
        const elapsed = Date.now() - this.lastFiredAt;
        const wait = Math.max(this.debounceMs - elapsed, 40);

        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.lastFiredAt = Date.now();
            this.callback();
        }, wait);
    }

    private isIgnorable(node: Node) {
        if (!(node instanceof HTMLElement)) return false;
        if (this.ignorePrefixes.some(prefix => node.classList.contains(prefix) || Boolean(node.closest?.(`.${prefix}`)))) return true;
        return false;
    }

    private shouldIgnore(mutations: MutationRecord[]) {
        if (!mutations.length) return true;

        return mutations.every(mutation => {
            if (this.isIgnorable(mutation.target)) return true;

            const allNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
            if (allNodes.length === 0) return false;

            return allNodes.every(node => this.isIgnorable(node));
        });
    }

    forceRefresh() {
        this.callback();
    }
}

export class RouteWatcher {
    private lastPath = "";
    private lastSearch = "";
    private lastHash = "";
    private listeners = new Set<() => void>();
    private interval: ReturnType<typeof setInterval> | null = null;

    start() {
        this.lastPath = location.pathname;
        this.lastSearch = location.search;
        this.lastHash = location.hash;

        window.addEventListener("popstate", this.check);
        window.addEventListener("hashchange", this.check);

        // Discord uses SPA routing - poll to catch pushState
        this.interval = setInterval(this.check, 600);
    }

    stop() {
        window.removeEventListener("popstate", this.check);
        window.removeEventListener("hashchange", this.check);
        if (this.interval) clearInterval(this.interval);
        this.interval = null;
        this.listeners.clear();
    }

    onRouteChange(listener: () => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private check = () => {
        const samePath = location.pathname === this.lastPath;
        const sameSearch = location.search === this.lastSearch;
        const sameHash = location.hash === this.lastHash;
        if (samePath && sameSearch && sameHash) return;

        this.lastPath = location.pathname;
        this.lastSearch = location.search;
        this.lastHash = location.hash;

        for (const listener of this.listeners) listener();
    };
}
