// Made by Yamach

import * as DataStore from "@api/DataStore";
import { isPluginEnabled } from "@api/PluginManager";
import ShowHiddenChannelsPlugin from "@plugins/showHiddenChannels";
import { copyToClipboard } from "@utils/clipboard";
import type { Channel, User, VoiceState } from "@vencord/discord-types";
import { findByPropsLazy, findStoreLazy } from "@webpack";
import { ChannelRouter, IconUtils, NavigationRouter, Popout, React, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

import { canUndo, getLastUndoEntry, popUndoEntry, subscribeUndo } from "../core/undoStack";
import { createPreset, deletePreset as removePreset, listPresets, loadPresets, subscribePresets } from "../core/presets";
import { settings } from "../settings";
import { HeatmapTab } from "./tabs/HeatmapTab";
import { StatsTab as DashboardStatsTab } from "./tabs/StatsTab";

const VoiceStateStore = findStoreLazy("VoiceStateStore") as any;
const ChannelStore = findStoreLazy("ChannelStore") as any;
const GuildStore = findStoreLazy("GuildStore") as any;
const RelationshipStore = findStoreLazy("RelationshipStore") as any;
const SelectedGuildStore = findStoreLazy("SelectedGuildStore") as any;
const PermissionStore = findStoreLazy("PermissionStore") as any;
const { selectVoiceChannel } = findByPropsLazy("selectVoiceChannel", "selectChannel") as any;

const DATA_KEY = "YamachVoiceUtilitiesPro_data_v1";
const LOG_KEY = "YamachVoiceUtilitiesPro_logs_v1";

const VIEW_CHANNEL = 1n << 10n;
const CONNECT = 1n << 20n;

// UserVoiceShow compatibility: this Command Center is a companion to UserVoiceShow.
// Keep the same visibility behavior: normal permission OR ShowHiddenChannels if the user has enabled it.

type RawVoiceState = VoiceState & {
    user_id?: string;
    userId?: string;
    channel_id?: string | null;
    channelId?: string | null;
    guild_id?: string | null;
    guildId?: string | null;
    self_mute?: boolean;
    self_deaf?: boolean;
    self_stream?: boolean;
    self_video?: boolean;
    mute?: boolean;
    deaf?: boolean;
    suppress?: boolean;
    request_to_speak_timestamp?: string | null;
};

type VoiceStatus = {
    selfMute: boolean;
    serverMute: boolean;
    muted: boolean;
    selfDeaf: boolean;
    serverDeaf: boolean;
    deafened: boolean;
    streaming: boolean;
    video: boolean;
    suppressed: boolean;
};

type Location = {
    userId: string;
    channelId: string;
    guildId: string | null;
    channel: any;
    guild: any;
    state: RawVoiceState;
    status: VoiceStatus;
    companions: Person[];
};

type Person = {
    id: string;
    name: string;
    avatar?: string;
    status?: VoiceStatus;
};

type TrackedUser = {
    userId: string;
    name: string;
    addedAt: number;
    favorite?: boolean;
    alerts?: boolean;
};

type ThemeName = "yamach" | "native" | "midnight" | "neon" | "emerald" | "crimson" | "royal" | "minimal" | "ocean" | "sunset" | "cyber" | "sakura" | "amber" | "ice" | "matrix" | "obsidian" | "steel" | "lavender" | "gold" | "ruby" | "custom";

type CustomTheme = {
    accent: string;
    surface: string;
    surface2: string;
    radius: number;
    glow: boolean;
    density: "comfortable" | "compact";
};

type PersistedData = {
    trackedUsers?: Record<string, TrackedUser>;
    trackedGuildId?: string | null;
    trackedRooms?: Record<string, boolean>;
    pinned?: Record<string, boolean>;
    theme?: ThemeName;
    customTheme?: CustomTheme;
    alertsEnabled?: boolean;
    cooldownMs?: number;
};

type LogType =
    | "track"
    | "untrack"
    | "join"
    | "leave"
    | "disconnect"
    | "move"
    | "self_mute_on"
    | "self_mute_off"
    | "server_mute_on"
    | "server_mute_off"
    | "self_deaf_on"
    | "self_deaf_off"
    | "server_deaf_on"
    | "server_deaf_off"
    | "stream_on"
    | "stream_off"
    | "video_on"
    | "video_off"
    | "companion_join"
    | "companion_leave"
    | "snapshot";

type VoiceLog = {
    id: string;
    userId: string;
    userName: string;
    type: LogType;
    timestamp: number;
    guildId?: string | null;
    guildName?: string;
    channelId?: string | null;
    channelName?: string;
    fromChannelId?: string | null;
    fromChannelName?: string;
    toChannelId?: string | null;
    toChannelName?: string;
    status?: VoiceStatus;
    previousStatus?: VoiceStatus;
    companions?: Person[];
    actor?: Person;
    durationMs?: number;
};

type SessionCard = {
    key: string;
    userId: string;
    userName: string;
    guildId?: string | null;
    guildName: string;
    channelId?: string | null;
    channelName: string;
    startedAt: number;
    endedAt?: number;
    durationMs: number;
    events: VoiceLog[];
    companions: Person[];
};

type StoredState = {
    userId: string;
    channelId?: string | null;
    guildId?: string | null;
    status: VoiceStatus;
};

let dataLoaded = false;
let trackedUsers = new Map<string, TrackedUser>();
let trackedGuildId: string | null = null;
let trackedRooms = new Set<string>();
let pinned = new Set<string>();
let currentTheme: ThemeName = "yamach";
let alertsEnabled = true;
let cooldownMs = 5 * 60 * 1000;
let customTheme: CustomTheme = {
    accent: "#f0b232",
    surface: "#0b0d16",
    surface2: "#111827",
    radius: 18,
    glow: true,
    density: "comfortable",
};
let logs: VoiceLog[] = [];
let lastStatesByUser = new Map<string, Map<string, StoredState>>();
let activeSessions = new Map<string, { startedAt: number; channelId: string; guildId?: string | null; companions: Person[]; }>();
let companionMemory = new Map<string, Set<string>>();
let listeners = new Set<() => void>();
let alertLastFired = new Map<string, number>();
let pendingFocusUserId: string | undefined;
let pendingMainTab: "control" | "yamach" | undefined;
let pendingYamachTab: YamachTab | undefined;

type YamachTab = "live" | "watch" | "logs" | "reports" | "heatmap" | "stats" | "presets" | "alerts" | "data" | "theme";

function emit() {
    for (const listener of listeners) listener();
}

export function subscribeYamach(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function setYamachPending(userId?: string, tab?: YamachTab) {
    pendingFocusUserId = userId;
    pendingMainTab = "yamach";
    pendingYamachTab = tab ?? "watch";
}

export function consumeYamachMainTab() {
    const tab = pendingMainTab ?? "control";
    pendingMainTab = undefined;
    return tab;
}

export function consumeYamachFocusUser() {
    const id = pendingFocusUserId;
    pendingFocusUserId = undefined;
    return id;
}

export function consumeYamachTab() {
    const tab = pendingYamachTab ?? "live";
    pendingYamachTab = undefined;
    return tab;
}

function getLang() {
    return settings.store.language === "ar" ? "ar" : "en";
}

function isArabic() {
    return getLang() === "ar";
}

function text(en: string, ar: string) {
    return isArabic() ? ar : en;
}

function isolateText(value: string | number) {
    return `\u2068${value}\u2069`;
}

function pad2(value: number) {
    return String(value).padStart(2, "0");
}

function formatTime(timestamp: number) {
    const date = new Date(timestamp);
    // Always Gregorian and LTR to avoid Hijri output and Arabic/English number flipping.
    // Use 12-hour AM/PM because it is easier to read inside mixed Arabic/English UI.
    const rawHour = date.getHours();
    const suffix = rawHour >= 12 ? "PM" : "AM";
    const hour12 = rawHour % 12 || 12;
    const value = `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} - ${pad2(hour12)}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${suffix}`;
    return isolateText(value);
}

function formatDuration(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    const value = h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
    return isolateText(value);
}

function bidi(value: React.ReactNode, className = "") {
    return <bdi className={className} dir="auto">{value}</bdi>;
}

function getRawUserId(state?: RawVoiceState | null, fallback?: string) {
    return state?.user_id ?? state?.userId ?? (state as any)?.user?.id ?? fallback;
}

function getRawChannelId(state?: RawVoiceState | null) {
    return state?.channel_id ?? state?.channelId ?? null;
}

function getRawGuildId(state?: RawVoiceState | null, fallbackChannelId?: string | null) {
    return state?.guild_id ?? state?.guildId ?? (fallbackChannelId ? ChannelStore.getChannel?.(fallbackChannelId)?.guild_id : null) ?? null;
}

function getStatus(state?: RawVoiceState | null): VoiceStatus {
    const selfMute = Boolean(state?.self_mute ?? (state as any)?.selfMute);
    const serverMute = Boolean(state?.mute ?? (state as any)?.serverMute);
    const selfDeaf = Boolean(state?.self_deaf ?? (state as any)?.selfDeaf);
    const serverDeaf = Boolean(state?.deaf ?? (state as any)?.serverDeaf);
    return {
        selfMute,
        serverMute,
        muted: selfMute || serverMute,
        selfDeaf,
        serverDeaf,
        deafened: selfDeaf || serverDeaf,
        streaming: Boolean(state?.self_stream ?? (state as any)?.selfStream),
        video: Boolean(state?.self_video ?? (state as any)?.selfVideo),
        suppressed: Boolean(state?.suppress ?? (state as any)?.suppressed),
    };
}

// Discord may expose both selfMute and server mute as true in some client-side states.
// For UI/logging clarity, server mute/deaf takes visual priority so the normal
// self mute/deaf icon does not light up at the same time.
function normalizeStatusForDisplay(status?: VoiceStatus | null): VoiceStatus | undefined {
    if (!status) return undefined;
    const selfMute = Boolean(status.selfMute && !status.serverMute);
    const selfDeaf = Boolean(status.selfDeaf && !status.serverDeaf);
    const serverMute = Boolean(status.serverMute);
    const serverDeaf = Boolean(status.serverDeaf);
    return {
        ...status,
        selfMute,
        selfDeaf,
        serverMute,
        serverDeaf,
        muted: selfMute || serverMute,
        deafened: selfDeaf || serverDeaf,
    };
}

function sameStatus(a?: VoiceStatus, b?: VoiceStatus) {
    const left = normalizeStatusForDisplay(a);
    const right = normalizeStatusForDisplay(b);
    if (!left || !right) return false;
    return left.selfMute === right.selfMute
        && left.serverMute === right.serverMute
        && left.selfDeaf === right.selfDeaf
        && left.serverDeaf === right.serverDeaf
        && left.streaming === right.streaming
        && left.video === right.video
        && left.suppressed === right.suppressed;
}

function avatarUrl(userId: string, guildId?: string | null, size = 40) {
    const user = UserStore.getUser(userId) as any;
    return user?.getAvatarURL?.(guildId ?? undefined, size)
        ?? user?.getAvatarURL?.(undefined, size)
        ?? user?.avatarURL
        ?? "";
}

function person(userId: string, guildId?: string | null, status?: VoiceStatus): Person {
    const user = UserStore.getUser(userId) as any;
    return {
        id: userId,
        name: user?.globalName ?? user?.displayName ?? user?.username ?? userId,
        avatar: avatarUrl(userId, guildId),
        status,
    };
}

function userName(userId: string) {
    return person(userId).name;
}

function channelName(channelId?: string | null) {
    if (!channelId) return text("Not in voice", "ليس في روم صوتي");
    return ChannelStore.getChannel?.(channelId)?.name ?? channelId;
}

function channelGuildId(channelId?: string | null) {
    return channelId ? ChannelStore.getChannel?.(channelId)?.guild_id ?? null : null;
}

function guildName(guildId?: string | null) {
    if (!guildId) return text("DM / Group", "خاص / قروب");
    return GuildStore.getGuild?.(guildId)?.name ?? guildId;
}

function guildIconUrl(guildId?: string | null, size = 40) {
    if (!guildId) return "";
    const guild = GuildStore.getGuild?.(guildId) as any;
    const icon = guild?.icon;

    // Use Discord's own icon resolver first. This is more reliable than handmade CDN URLs,
    // especially on newer Discord builds and animated icons.
    try {
        const viaIconUtils = icon ? IconUtils?.getGuildIconURL?.({ id: guildId, icon, size, canAnimate: true }) : null;
        if (viaIconUtils) return viaIconUtils;
    } catch { }

    try {
        const direct = guild?.getIconURL?.(size, true) ?? guild?.getIconURL?.({ size, canAnimate: true });
        if (direct) return direct;
    } catch { }

    if (!icon) return "";
    const ext = String(icon).startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${ext}?size=${size}`;
}

function guildShortName(guildId?: string | null, overrideName?: string | null) {
    const name = overrideName ?? guildName(guildId);
    if (!name || isSnowflake(String(name))) return guildId ? "G" : "@";
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
    return String(name).trim().slice(0, 2).toUpperCase() || (guildId ? "G" : "@");
}

function GuildAvatar({ guildId, size = 34, name }: { guildId?: string | null; size?: number; name?: string | null; }) {
    const icon = guildIconUrl(guildId, size * 2);
    const displayName = name ?? (guildId ? guildName(guildId) : text("DM / Group", "خاص / قروب"));
    const fallback = guildShortName(guildId, displayName);
    const [failed, setFailed] = React.useState(false);

    React.useEffect(() => setFailed(false), [guildId, icon]);

    const showIcon = Boolean(icon && !failed);
    return <span
        className={`vc-yvu-guild-avatar ${showIcon ? "vc-yvu-guild-avatar-has-icon" : "vc-yvu-guild-avatar-fallback"}`}
        style={{ width: size, height: size, minWidth: size, minHeight: size, fontSize: Math.max(10, Math.floor(size * 0.36)) }}
        title={displayName}
        data-guild-id={guildId ?? "@me"}
    >
        {showIcon
            ? <img src={icon} alt="" draggable={false} onError={() => setFailed(true)} />
            : <span aria-hidden="true">{fallback}</span>}
    </span>;
}

function ChannelMention({ location, compact = false }: { location: Location; compact?: boolean; }) {
    return <button
        type="button"
        className={`vc-yvu-channel-mention ${compact ? "vc-yvu-channel-mention-compact" : ""}`}
        onClick={() => goToChannel(location.channelId)}
        title={text("Open voice channel", "افتح الروم الصوتي")}
    >
        <span className="vc-yvu-channel-mention-icon">#</span>
        <span className="vc-yvu-channel-mention-name">{bidi(location.channel?.name ?? location.channelId)}</span>
    </button>;
}

function canViewChannel(channel: any) {
    if (!channel?.guild_id) return true;
    try {
        return Boolean(PermissionStore.can?.(VIEW_CHANNEL, channel) || isPluginEnabled(ShowHiddenChannelsPlugin.name));
    } catch {
        return true;
    }
}

function canConnectChannel(channel: any) {
    if (!channel?.guild_id) return true;
    try {
        return PermissionStore.can?.(CONNECT, channel) ?? true;
    } catch {
        return true;
    }
}

function isSnowflake(value?: string | null) {
    return Boolean(value && /^\d{15,25}$/.test(value));
}

function looksLikeVoiceState(raw: unknown) {
    if (!raw || typeof raw !== "object") return false;
    const state = raw as RawVoiceState;
    return Boolean(getRawChannelId(state) || getRawUserId(state) || "mute" in state || "self_mute" in state || "selfMute" in (state as any) || "self_deaf" in state || "selfDeaf" in (state as any));
}

function addVoiceState(output: RawVoiceState[], raw: unknown, fallbackUserId?: string, fallbackGuildId?: string) {
    if (!raw || typeof raw !== "object") return;
    const state = raw as RawVoiceState;
    const userId = getRawUserId(state, fallbackUserId);
    const channelId = getRawChannelId(state);
    if (!userId || !channelId) return;
    if (fallbackUserId && isSnowflake(fallbackUserId) && userId !== fallbackUserId && !(state as any).user_id && !(state as any).userId) (state as any).user_id = fallbackUserId;
    const guildId = getRawGuildId(state, channelId) ?? fallbackGuildId;
    if (guildId && !(state.guild_id ?? state.guildId)) (state as any).guild_id = guildId;
    output.push(state);
}

type VoiceScanContext = {
    userId?: string;
    guildId?: string;
    depth?: number;
};

function scanAnyVoiceStates(output: RawVoiceState[], raw: unknown, context: VoiceScanContext = {}) {
    if (!raw || typeof raw !== "object") return;
    if ((context.depth ?? 0) > 8) return;

    const state = raw as RawVoiceState;
    if (getRawChannelId(state)) {
        addVoiceState(output, state, context.userId, context.guildId);
        return;
    }

    for (const [key, child] of Object.entries(raw as Record<string, unknown>)) {
        if (!child || typeof child !== "object") continue;
        const snowflakeKey = isSnowflake(key);
        const childState = child as RawVoiceState;
        const childHasChannel = Boolean(getRawChannelId(childState));
        const nextContext: VoiceScanContext = {
            userId: context.userId,
            guildId: context.guildId,
            depth: (context.depth ?? 0) + 1,
        };

        if (childHasChannel || looksLikeVoiceState(child)) {
            if (snowflakeKey && !getRawUserId(childState)) nextContext.userId = key;
            addVoiceState(output, childState, nextContext.userId, nextContext.guildId);
            if (!childHasChannel) scanAnyVoiceStates(output, child, nextContext);
            continue;
        }

        if (snowflakeKey) {
            // getAllVoiceStates is usually guildId -> userId -> VoiceState, but some builds nest channel/user maps.
            // Keep the first snowflake as guild when there is no guild yet; after that, treat snowflakes as possible user ids.
            if (!nextContext.guildId && ChannelStore.getChannel?.(key) == null) nextContext.guildId = key;
            else if (!nextContext.userId) nextContext.userId = key;
        }

        scanAnyVoiceStates(output, child, nextContext);
    }
}

function addVoiceStateForUser(output: RawVoiceState[], value: unknown, userId: string, guildKey?: string) {
    if (!value || typeof value !== "object") return;
    const state = value as RawVoiceState;
    const channelId = getRawChannelId(state);
    if (!channelId) return;

    output.push({
        ...state,
        userId: getRawUserId(state, userId),
        channelId,
        guildId: getRawGuildId(state, guildKey),
    } as RawVoiceState);
}

function scanUserVoiceStateObject(output: RawVoiceState[], value: unknown, userId: string, parentKey?: string) {
    if (!value || typeof value !== "object") return;

    const objectValue = value as Record<string, unknown>;
    const state = value as RawVoiceState;

    // Direct VoiceState object.
    if (getRawChannelId(state) && getRawUserId(state, parentKey) === userId) {
        addVoiceStateForUser(output, state, userId, parentKey);
        return;
    }

    // Common Discord shape: { [guildIdOrMe]: { [userId]: voiceState } }
    if (objectValue[userId]) {
        addVoiceStateForUser(output, objectValue[userId], userId, parentKey);
    }

    // Defensive support for builds/plugins that expose nested channel maps.
    for (const [key, child] of Object.entries(objectValue)) {
        if (!child || typeof child !== "object") continue;

        const childState = child as RawVoiceState;

        if (key === userId) {
            addVoiceStateForUser(output, childState, userId, parentKey);
            continue;
        }

        if (getRawChannelId(childState) && getRawUserId(childState) === userId) {
            addVoiceStateForUser(output, childState, userId, parentKey);
            continue;
        }

        if ((child as Record<string, unknown>)[userId]) {
            addVoiceStateForUser(output, (child as Record<string, RawVoiceState>)[userId], userId, key);
        }
    }
}

function rawStatesForUser(userId: string) {
    const states: RawVoiceState[] = [];

    // Important: this mirrors the working UserVoiceShow multi-room addon.
    // getVoiceStateForUser returns one location only, so we scan getAllVoiceStates first.
    try {
        const allStates = VoiceStateStore.getAllVoiceStates?.();
        if (allStates) {
            for (const [guildKey, usersOrChannels] of Object.entries(allStates)) {
                scanUserVoiceStateObject(states, usersOrChannels, userId, guildKey);
            }
        }
    } catch { }

    try {
        addVoiceStateForUser(states, VoiceStateStore.getVoiceStateForUser?.(userId), userId);
    } catch { }

    const deduped = new Map<string, RawVoiceState>();
    for (const state of states) {
        const uid = getRawUserId(state, userId);
        const cid = getRawChannelId(state);
        if (!uid || uid !== userId || !cid) continue;
        const previous = deduped.get(cid);
        if (!previous || !getRawGuildId(previous)) deduped.set(cid, state);
    }

    return [...deduped.values()];
}

function collectAllRawStates() {
    const states: RawVoiceState[] = [];
    try {
        const all = VoiceStateStore.getAllVoiceStates?.();
        if (all) scanAnyVoiceStates(states, all);
    } catch { }
    const dedupe = new Map<string, RawVoiceState>();
    for (const state of states) {
        const uid = getRawUserId(state);
        const cid = getRawChannelId(state);
        if (uid && cid) dedupe.set(`${uid}:${cid}`, state);
    }
    return [...dedupe.values()];
}

function stateToLocation(raw: RawVoiceState, fallbackUserId?: string): Location | null {
    const userId = getRawUserId(raw, fallbackUserId);
    const channelId = getRawChannelId(raw);
    if (!userId || !channelId) return null;

    const channel = ChannelStore.getChannel?.(channelId);
    if (!channel) return null;
    if (!canViewChannel(channel)) return null;

    const guildId = channel.guild_id ?? getRawGuildId(raw, channelId);
    return {
        userId,
        channelId: channel.id ?? channelId,
        guildId,
        channel,
        guild: guildId ? GuildStore.getGuild?.(guildId) : null,
        state: raw,
        status: getStatus(raw),
        companions: getChannelPeople(channel.id ?? channelId, userId).slice(0, 50),
    };
}

export function getUserLocations(userId: string) {
    const locations = rawStatesForUser(userId)
        .map(state => stateToLocation(state, userId))
        .filter(Boolean) as Location[];
    const dedupe = new Map<string, Location>();
    for (const loc of locations) dedupe.set(loc.channelId, loc);
    return [...dedupe.values()].sort((a, b) => (a.guild?.name ?? "").localeCompare(b.guild?.name ?? "") || (a.channel?.name ?? "").localeCompare(b.channel?.name ?? ""));
}

function getChannelPeople(channelId: string, exclude?: string) {
    let states: Record<string, RawVoiceState> = {};
    try {
        states = VoiceStateStore.getVoiceStatesForChannel?.(channelId) ?? {};
    } catch { }
    return Object.entries(states)
        .map(([fallbackUserId, raw]) => {
            const userId = getRawUserId(raw, fallbackUserId);
            if (!userId || userId === exclude) return null;
            return person(userId, channelGuildId(channelId), getStatus(raw));
        })
        .filter(Boolean) as Person[];
}

function visibleKnownUserIds(kind: "friends" | "dms" | "tracked" | "current" | "favorites" | "all") {
    const ids = new Set<string>();
    if (kind === "tracked" || kind === "favorites") {
        for (const entry of trackedUsers.values()) if (kind !== "favorites" || entry.favorite) ids.add(entry.userId);
        return [...ids];
    }
    if (kind === "friends" || kind === "all" || kind === "current") {
        for (const id of RelationshipStore.getFriendIDs?.() ?? []) ids.add(id);
    }
    if (kind === "dms" || kind === "all" || kind === "current") {
        for (const id of ChannelStore.getDMUserIds?.() ?? []) ids.add(id);
    }
    if (kind === "all" || kind === "current") {
        for (const entry of trackedUsers.values()) ids.add(entry.userId);
        for (const id of pinned) ids.add(id);
    }
    return [...ids];
}

function locationRows(kind: "friends" | "dms" | "tracked" | "current" | "favorites" | "all", focusUserId?: string) {
    const selectedGuildId = SelectedGuildStore.getGuildId?.() ?? null;
    if (kind === "current" && !selectedGuildId && !focusUserId) return [];
    const ids = focusUserId ? [focusUserId] : visibleKnownUserIds(kind);
    const idSet = new Set(ids);
    const grouped = new Map<string, RawVoiceState[]>();

    if (kind === "friends" || kind === "dms" || kind === "current" || kind === "all") {
        for (const state of collectAllRawStates()) {
            const userId = getRawUserId(state);
            if (!userId || !idSet.has(userId)) continue;
            const loc = stateToLocation(state, userId);
            if (!loc) continue;
            if (kind === "current" && selectedGuildId && loc.guildId !== selectedGuildId) continue;
            if (!grouped.has(userId)) grouped.set(userId, []);
            grouped.get(userId)!.push(state);
        }
    }

    return ids.map(userId => {
        const states = grouped.get(userId) ?? rawStatesForUser(userId);
        const locations = states.map(state => stateToLocation(state, userId)).filter(Boolean) as Location[];
        const dedupe = new Map<string, Location>();
        for (const loc of locations) {
            if (kind === "current" && selectedGuildId && loc.guildId !== selectedGuildId) continue;
            dedupe.set(loc.channelId, loc);
        }
        return { userId, user: UserStore.getUser(userId) as User | undefined, locations: [...dedupe.values()] };
    }).filter(row => row.locations.length || kind === "tracked" || kind === "favorites" || Boolean(focusUserId));
}

function pruneLogsIfNeeded() {
    const maxEntries = Math.max(500, Number(settings.store.maxLogEntries ?? 10000));
    if (logs.length > maxEntries) {
        const removeCount = logs.length - maxEntries;
        logs.splice(0, removeCount);
    }

    const autoExpireDays = Number(settings.store.autoExpireDays ?? 0);
    if (autoExpireDays > 0) {
        const cutoff = Date.now() - autoExpireDays * 86400_000;
        const before = logs.length;
        logs = logs.filter(log => log.timestamp >= cutoff);
        return logs.length !== before;
    }

    return false;
}

function addLog(entry: Omit<VoiceLog, "id" | "timestamp"> & { timestamp?: number; }) {
    const log: VoiceLog = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: entry.timestamp ?? Date.now(),
        ...entry,
    };
    logs.push(log);
    pruneLogsIfNeeded();
    void persistLogs();
    emit();
    maybeAlert(log);
}

function sessionKey(userId: string, channelId: string) {
    return `${userId}:${channelId}`;
}

function normalizeStored(state: RawVoiceState, fallbackUserId?: string): StoredState | null {
    const userId = getRawUserId(state, fallbackUserId);
    const channelId = getRawChannelId(state);
    if (!userId || !channelId) return null;
    const guildId = getRawGuildId(state, channelId);
    return { userId, channelId, guildId, status: getStatus(state) };
}

function isInScope(state: StoredState | null) {
    if (!state?.channelId) return false;
    if (trackedGuildId && state.guildId !== trackedGuildId) return false;
    if (trackedRooms.size && !trackedRooms.has(state.channelId)) return false;
    return true;
}

function shouldTrackUser(userId: string, state?: StoredState | null) {
    if (trackedUsers.has(userId)) return true;
    if (state && trackedGuildId && state.guildId === trackedGuildId) return true;
    if (state?.channelId && trackedRooms.has(state.channelId)) return true;
    return false;
}

function recordSessionStart(state: StoredState) {
    if (!state.channelId) return;
    const key = sessionKey(state.userId, state.channelId);
    if (!activeSessions.has(key)) {
        activeSessions.set(key, {
            startedAt: Date.now(),
            channelId: state.channelId,
            guildId: state.guildId,
            companions: getChannelPeople(state.channelId, state.userId),
        });
    }
}

function closeSession(state: StoredState, now: number) {
    if (!state.channelId) return 0;
    const key = sessionKey(state.userId, state.channelId);
    const active = activeSessions.get(key);
    if (!active) return 0;
    activeSessions.delete(key);
    return now - active.startedAt;
}

function getStoredUserStates(userId: string) {
    let map = lastStatesByUser.get(userId);
    if (!map) {
        map = new Map();
        lastStatesByUser.set(userId, map);
    }
    return map;
}

function processStatusChanges(userId: string, prev: StoredState, next: StoredState) {
    const prevStatus = normalizeStatusForDisplay(prev.status) ?? prev.status;
    const nextStatus = normalizeStatusForDisplay(next.status) ?? next.status;
    const statusPairs: [keyof VoiceStatus, LogType, LogType][] = [
        ["selfMute", "self_mute_on", "self_mute_off"],
        ["serverMute", "server_mute_on", "server_mute_off"],
        ["selfDeaf", "self_deaf_on", "self_deaf_off"],
        ["serverDeaf", "server_deaf_on", "server_deaf_off"],
        ["streaming", "stream_on", "stream_off"],
        ["video", "video_on", "video_off"],
    ];
    for (const [field, onType, offType] of statusPairs) {
        if (prevStatus[field] === nextStatus[field]) continue;
        addLog({
            userId,
            userName: userName(userId),
            type: nextStatus[field] ? onType : offType,
            guildId: next.guildId,
            guildName: guildName(next.guildId),
            channelId: next.channelId,
            channelName: channelName(next.channelId),
            status: nextStatus,
            previousStatus: prevStatus,
            companions: next.channelId ? getChannelPeople(next.channelId, userId) : [],
        });
    }
}

function processCompanionsFor(state: StoredState) {
    if (!state.channelId) return;
    const key = sessionKey(state.userId, state.channelId);
    const previous = companionMemory.get(key) ?? new Set<string>();
    const currentPeople = getChannelPeople(state.channelId, state.userId);
    const current = new Set(currentPeople.map(p => p.id));

    for (const id of current) {
        if (!previous.has(id)) addLog({
            userId: state.userId,
            userName: userName(state.userId),
            type: "companion_join",
            guildId: state.guildId,
            guildName: guildName(state.guildId),
            channelId: state.channelId,
            channelName: channelName(state.channelId),
            actor: person(id, state.guildId),
            companions: currentPeople,
            status: state.status,
        });
    }
    for (const id of previous) {
        if (!current.has(id)) addLog({
            userId: state.userId,
            userName: userName(state.userId),
            type: "companion_leave",
            guildId: state.guildId,
            guildName: guildName(state.guildId),
            channelId: state.channelId,
            channelName: channelName(state.channelId),
            actor: person(id, state.guildId),
            companions: currentPeople,
            status: state.status,
        });
    }
    companionMemory.set(key, current);
}

function processUserStateChange(userId: string, incomingStates: StoredState[]) {
    const now = Date.now();
    const previousMap = getStoredUserStates(userId);
    const nextMap = new Map<string, StoredState>();
    for (const state of incomingStates) {
        if (!state.channelId || !isInScope(state) || !shouldTrackUser(userId, state)) continue;
        nextMap.set(state.channelId, state);
    }

    for (const [channelId, prev] of previousMap.entries()) {
        const next = nextMap.get(channelId);
        if (next) continue;
        const durationMs = closeSession(prev, now);
        addLog({
            userId,
            userName: userName(userId),
            type: nextMap.size ? "move" : "leave",
            guildId: prev.guildId,
            guildName: guildName(prev.guildId),
            channelId: null,
            channelName: text("Not in voice", "ليس في روم صوتي"),
            fromChannelId: prev.channelId,
            fromChannelName: channelName(prev.channelId),
            toChannelId: nextMap.values().next().value?.channelId ?? null,
            toChannelName: nextMap.values().next().value?.channelId ? channelName(nextMap.values().next().value.channelId) : undefined,
            previousStatus: prev.status,
            durationMs,
        });
        companionMemory.delete(sessionKey(userId, channelId));
    }

    for (const [channelId, next] of nextMap.entries()) {
        const prev = previousMap.get(channelId);
        if (!prev) {
            recordSessionStart(next);
            const people = getChannelPeople(channelId, userId);
            companionMemory.set(sessionKey(userId, channelId), new Set(people.map(p => p.id)));
            addLog({
                userId,
                userName: userName(userId),
                type: "join",
                guildId: next.guildId,
                guildName: guildName(next.guildId),
                channelId: next.channelId,
                channelName: channelName(next.channelId),
                status: next.status,
                companions: people,
            });

            // Smart auto-pull: when a tracked user joins voice and we're in voice in
            // the same guild, optionally pull them to our channel automatically.
            void maybeAutoPullTrackedUser(userId, next);
        } else if (!sameStatus(prev.status, next.status)) {
            processStatusChanges(userId, prev, next);
        }
        processCompanionsFor(next);
    }

    lastStatesByUser.set(userId, nextMap);
}

let lastAutoPullByUser = new Map<string, number>();
const AUTO_PULL_COOLDOWN_MS = 30_000;

async function maybeAutoPullTrackedUser(userId: string, state: StoredState) {
    if (!settings.store.enableSmartAutoPull) return;
    if (!trackedUsers.has(userId)) return;
    if (!state.guildId || !state.channelId) return;

    const lastPull = lastAutoPullByUser.get(userId) ?? 0;
    if (Date.now() - lastPull < AUTO_PULL_COOLDOWN_MS) return;

    // Find our voice channel in the same guild.
    const myId = UserStore.getCurrentUser()?.id;
    if (!myId) return;
    const myState = VoiceStateStore.getVoiceStateForUser?.(myId);
    const myChannelId = myState?.channelId ?? myState?.channel_id;
    if (!myChannelId) return;
    const myChannel = ChannelStore.getChannel?.(myChannelId);
    if (!myChannel || myChannel.guild_id !== state.guildId) return;
    if (myChannelId === state.channelId) return; // already in same channel

    lastAutoPullByUser.set(userId, Date.now());

    try {
        await RestAPI.patch({
            url: `/guilds/${state.guildId}/members/${userId}`,
            body: { channel_id: myChannelId },
        });
        showToast(`🎯 ${text("Auto-pulled", "تم سحب تلقائياً")}: ${userName(userId)}`, Toasts.Type.SUCCESS);
    } catch (error) {
        console.warn("YamachVoiceUtilitiesPro auto-pull failed", error);
    }

    // Periodically prune cooldown entries older than 1 hour to avoid memory growth
    if (lastAutoPullByUser.size > 256) {
        const cutoff = Date.now() - 3600_000;
        for (const [id, ts] of lastAutoPullByUser) {
            if (ts < cutoff) lastAutoPullByUser.delete(id);
        }
    }
}

function hydrateTracked() {
    lastStatesByUser.clear();
    activeSessions.clear();
    companionMemory.clear();
    for (const userId of trackedUsers.keys()) {
        const states = rawStatesForUser(userId).map(state => normalizeStored(state, userId)).filter(Boolean) as StoredState[];
        const map = new Map<string, StoredState>();
        for (const state of states) {
            if (!state.channelId || !isInScope(state)) continue;
            map.set(state.channelId, state);
            recordSessionStart(state);
            companionMemory.set(sessionKey(userId, state.channelId), new Set(getChannelPeople(state.channelId, userId).map(p => p.id)));
        }
        lastStatesByUser.set(userId, map);
    }
}

export async function yamachStart() {
    const [data, savedLogs] = await Promise.all([
        DataStore.get<PersistedData>(DATA_KEY),
        DataStore.get<{ logs?: VoiceLog[]; }>(LOG_KEY),
    ]);
    trackedUsers = new Map(Object.entries(data?.trackedUsers ?? {}).map(([id, value]) => [id, value]));
    trackedGuildId = data?.trackedGuildId ?? null;
    trackedRooms = new Set(Object.keys(data?.trackedRooms ?? {}));
    pinned = new Set(Object.keys(data?.pinned ?? {}));
    currentTheme = data?.theme ?? "yamach";
    customTheme = { ...customTheme, ...(data?.customTheme ?? {}) };
    alertsEnabled = data?.alertsEnabled ?? true;
    cooldownMs = data?.cooldownMs ?? 5 * 60 * 1000;
    logs = savedLogs?.logs ?? [];
    dataLoaded = true;
    hydrateTracked();
    emit();
}

export function yamachStop() {
    persistData();
    persistLogs();
    listeners.clear();
}

function persistData() {
    const tracked: Record<string, TrackedUser> = {};
    for (const [id, value] of trackedUsers) tracked[id] = value;
    const rooms: Record<string, boolean> = {};
    for (const room of trackedRooms) rooms[room] = true;
    const pinnedMap: Record<string, boolean> = {};
    for (const id of pinned) pinnedMap[id] = true;
    void DataStore.set(DATA_KEY, {
        trackedUsers: tracked,
        trackedGuildId,
        trackedRooms: rooms,
        pinned: pinnedMap,
        theme: currentTheme,
        customTheme,
        alertsEnabled,
        cooldownMs,
    } satisfies PersistedData);
}

function persistLogs() {
    void DataStore.set(LOG_KEY, { logs });
}

export function yamachHandleVoiceStateUpdates(payload: { voiceStates?: RawVoiceState[]; }) {
    if (!dataLoaded) return;
    const changed = new Set<string>();
    for (const raw of payload.voiceStates ?? []) {
        const userId = getRawUserId(raw);
        if (userId) changed.add(userId);
    }

    // Always re-check tracked users whenever a voice update arrives. This is what lets us catch
    // "who entered / left the room with him", even if the update belonged to another member.
    for (const userId of trackedUsers.keys()) changed.add(userId);

    for (const userId of changed) {
        const states = rawStatesForUser(userId).map(state => normalizeStored(state, userId)).filter(Boolean) as StoredState[];
        if (trackedUsers.has(userId) || states.some(state => shouldTrackUser(userId, state))) processUserStateChange(userId, states);
    }
    emit();
}

export function trackUser(userId: string) {
    if (!trackedUsers.has(userId)) {
        trackedUsers.set(userId, { userId, name: userName(userId), addedAt: Date.now(), alerts: true });
        addLog({ userId, userName: userName(userId), type: "track", companions: [] });
        const liveLocations = getUserLocations(userId).filter(loc => !trackedGuildId || loc.guildId === trackedGuildId);
        for (const loc of liveLocations) {
            addLog({
                userId,
                userName: userName(userId),
                type: "snapshot",
                guildId: loc.guildId,
                guildName: guildName(loc.guildId),
                channelId: loc.channelId,
                channelName: loc.channel?.name ?? loc.channelId,
                status: loc.status,
                companions: loc.companions,
            });
        }
        hydrateTracked();
    }
    persistData();
    emit();
}

export function trackUsers(userIds: string[]) {
    const unique = [...new Set(userIds.filter(Boolean))];
    for (const userId of unique) trackUser(userId);
    if (unique.length) showToast(text("Selected users added to Yamach tracking", "تمت إضافة المحددين لتتبع Yamach"), Toasts.Type.SUCCESS);
}

export function untrackUser(userId: string) {
    if (trackedUsers.delete(userId)) addLog({ userId, userName: userName(userId), type: "untrack" });
    persistData();
    emit();
}

function toggleFavorite(userId: string) {
    const entry = trackedUsers.get(userId) ?? { userId, name: userName(userId), addedAt: Date.now(), alerts: true };
    entry.favorite = !entry.favorite;
    trackedUsers.set(userId, entry);
    persistData();
    emit();
}

function togglePinnedUser(userId: string) {
    pinned.has(userId) ? pinned.delete(userId) : pinned.add(userId);
    persistData();
    emit();
}

export function setTrackedGuild(guildId: string | null) {
    trackedGuildId = guildId;
    persistData();
    hydrateTracked();
    emit();
}

export function toggleTrackedRoom(channelId: string) {
    trackedRooms.has(channelId) ? trackedRooms.delete(channelId) : trackedRooms.add(channelId);
    persistData();
    hydrateTracked();
    emit();
}

export function isTracked(userId: string) {
    return trackedUsers.has(userId);
}

function eventLabel(type: LogType) {
    const map: Record<LogType, [string, string, string]> = {
        track: ["Track started", "بدأ التتبع", "＋"],
        untrack: ["Tracking stopped", "توقف التتبع", "−"],
        join: ["Joined voice", "دخل الروم", "↘"],
        leave: ["Left voice", "طلع من الروم", "↗"],
        disconnect: ["Disconnected", "انقطع", "⏏"],
        move: ["Moved room", "غير الروم", "⇄"],
        self_mute_on: ["Self mute on", "شغل الميوت", "●"],
        self_mute_off: ["Self mute off", "فك الميوت", "○"],
        server_mute_on: ["Server mute on", "ميوت سيرفر", "●"],
        server_mute_off: ["Server mute off", "فك ميوت السيرفر", "○"],
        self_deaf_on: ["Self deaf on", "شغل الدفن", "●"],
        self_deaf_off: ["Self deaf off", "فك الدفن", "○"],
        server_deaf_on: ["Server deaf on", "دفن سيرفر", "●"],
        server_deaf_off: ["Server deaf off", "فك دفن السيرفر", "○"],
        stream_on: ["Stream started", "بدأ ستريم", "📺"],
        stream_off: ["Stream ended", "قفل الستريم", "📺"],
        video_on: ["Camera on", "فتح الكاميرا", "🎥"],
        video_off: ["Camera off", "قفل الكاميرا", "🎥"],
        companion_join: ["Someone joined", "دخل شخص معه", "＋"],
        companion_leave: ["Someone left", "طلع شخص", "−"],
        snapshot: ["Snapshot", "لقطة", "◉"],
    };
    const [en, ar, icon] = map[type] ?? [type, type, "•"];
    return { label: text(en, ar), icon };
}

type StatusGlyphKind = "mic" | "deaf" | "serverMic" | "serverDeaf" | "stream" | "video" | "suppressed";

function StatusGlyph({ kind }: { kind: StatusGlyphKind; }) {
    if (kind === "mic" || kind === "serverMic") {
        return <svg className="vc-yvu-status-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 14.25c1.75 0 3-1.28 3-3.08V5.08C15 3.28 13.75 2 12 2S9 3.28 9 5.08v6.09c0 1.8 1.25 3.08 3 3.08Z" />
            <path d="M7.1 10.2a1 1 0 0 0-2 0c0 3.2 2.23 5.88 5.18 6.56V19H8.65a1 1 0 1 0 0 2h6.7a1 1 0 1 0 0-2h-1.63v-2.24c2.95-.68 5.18-3.36 5.18-6.56a1 1 0 1 0-2 0c0 2.78-2.08 4.9-4.9 4.9s-4.9-2.12-4.9-4.9Z" />
            <path className="vc-yvu-status-slash" d="M4.25 3.25 20.75 19.75" />
        </svg>;
    }
    if (kind === "deaf" || kind === "serverDeaf") {
        return <svg className="vc-yvu-status-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4.7 13.2v3.45c0 1.2.9 2.12 2.02 2.12h1.35c.78 0 1.43-.66 1.43-1.48v-4.72c0-.82-.65-1.48-1.43-1.48H6.72c-.1 0-.18 0-.27.02C6.92 8.1 9.08 6.03 12 6.03s5.08 2.07 5.55 5.08c-.09-.02-.18-.02-.27-.02h-1.35c-.78 0-1.43.66-1.43 1.48v4.72c0 .82.65 1.48 1.43 1.48h1.35c1.12 0 2.02-.92 2.02-2.12V13.2C19.3 8.4 16.22 4 12 4S4.7 8.4 4.7 13.2Z" />
            <path className="vc-yvu-status-slash" d="M4.25 3.25 20.75 19.75" />
        </svg>;
    }
    if (kind === "stream") {
        return <svg className="vc-yvu-status-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16h-11A2.5 2.5 0 0 1 4 13.5v-8Z" />
            <path d="M9.2 21a1 1 0 0 1 0-2h1.8v-2h2v2h1.8a1 1 0 1 1 0 2H9.2Z" />
        </svg>;
    }
    if (kind === "video") {
        return <svg className="vc-yvu-status-svg" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h7A2.5 2.5 0 0 1 16 7.5v9A2.5 2.5 0 0 1 13.5 19h-7A2.5 2.5 0 0 1 4 16.5v-9Z" />
            <path d="M17 9.2 20.5 7.2c.67-.38 1.5.1 1.5.87v7.86c0 .77-.83 1.25-1.5.87L17 14.8V9.2Z" />
        </svg>;
    }
    return <svg className="vc-yvu-status-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm1 13h-2v-2h2v2Zm0-4h-2V7h2v5Z" /></svg>;
}

function statusIcons(status?: VoiceStatus, compact = false, showInactive = !compact) {
    const displayStatus = normalizeStatusForDisplay(status);
    if (!displayStatus) return null;
    const items: Array<[boolean, string, string, StatusGlyphKind]> = [
        [displayStatus.selfMute, "vc-yvu-status-self-mute", text("Self mute", "ميوت شخصي"), "mic"],
        [displayStatus.selfDeaf, "vc-yvu-status-self-deaf", text("Self deaf", "دفن شخصي"), "deaf"],
        [displayStatus.serverMute, "vc-yvu-status-server-mute", text("Server mute", "ميوت سيرفر"), "serverMic"],
        [displayStatus.serverDeaf, "vc-yvu-status-server-deaf", text("Server deaf", "دفن سيرفر"), "serverDeaf"],
        [displayStatus.streaming, "vc-yvu-status-stream", text("Streaming", "ستريم"), "stream"],
        [displayStatus.video, "vc-yvu-status-video", text("Camera", "كاميرا"), "video"],
        [displayStatus.suppressed, "vc-yvu-status-suppressed", text("Suppressed", "مقموع/ستيج"), "suppressed"],
    ];
    const visible = showInactive ? items : items.filter(([enabled]) => enabled);
    if (!visible.length) return null;
    const hasActive = items.some(([enabled]) => enabled);

    return <span className={`vc-yvu-status-icons vc-yvu-discord-status-icons ${compact ? "vc-yvu-status-icons-compact" : ""} ${showInactive ? "vc-yvu-status-icons-full" : ""}`}>
        {visible.map(([enabled, className, title, kind]) => {
            const serverIcon = kind === "serverMic" || kind === "serverDeaf";
            return <span key={className} className={`vc-yvu-status-badge ${className} ${enabled ? "vc-yvu-status-active" : "vc-yvu-status-inactive"}`} title={`${title}${enabled ? "" : ` · ${text("off", "غير مفعل")}`}`} aria-label={title}>
                <span className="vc-yvu-status-symbol" dir="ltr"><StatusGlyph kind={kind} /></span>
                {serverIcon ? <span className="vc-yvu-status-shield" aria-hidden="true">◆</span> : null}
            </span>;
        })}
        {!hasActive && compact ? null : null}
    </span>;
}

function isStatusLog(type: LogType) {
    return type === "self_mute_on" || type === "self_mute_off"
        || type === "server_mute_on" || type === "server_mute_off"
        || type === "self_deaf_on" || type === "self_deaf_off"
        || type === "server_deaf_on" || type === "server_deaf_off"
        || type === "stream_on" || type === "stream_off"
        || type === "video_on" || type === "video_off";
}

function StatusChangeStack({ event }: { event: VoiceLog; }) {
    if (!isStatusLog(event.type) || !event.status || !event.previousStatus) {
        return <div className="vc-yvu-muted vc-yvu-event-meta">
            <span dir="ltr">{formatTime(event.timestamp)}</span> {statusIcons(event.status)}
        </div>;
    }

    return <div className="vc-yvu-status-change-stack" dir="auto">
        <div className="vc-yvu-status-change-row vc-yvu-status-change-new">
            <span className="vc-yvu-status-change-label">{text("New", "الجديدة")}</span>
            {statusIcons(event.status, false, true)}
        </div>
        <div className="vc-yvu-status-change-row vc-yvu-status-change-old">
            <span className="vc-yvu-status-change-label">{text("Old", "القديمة")}</span>
            {statusIcons(event.previousStatus, false, true)}
        </div>
        <div className="vc-yvu-muted vc-yvu-event-meta"><span dir="ltr">{formatTime(event.timestamp)}</span></div>
    </div>;
}

function AvatarStack({ people, limit = 8 }: { people: Person[]; limit?: number; }) {
    const visible = people.slice(0, limit);
    const extra = people.length - visible.length;
    if (!people.length) return <span className="vc-yvu-muted vc-yvu-empty-with">{text("No visible companions", "لا يوجد مرافقين ظاهرين")}</span>;
    return <div className="vc-yvu-avatar-stack vc-yvu-avatar-grid">
        {visible.map(p => <span className="vc-yvu-companion-chip" title={p.name} key={p.id}>
            <span className="vc-yvu-mini-avatar">
                {p.avatar ? <img src={p.avatar} alt="" /> : p.name.slice(0, 1)}
            </span>
            <span className="vc-yvu-companion-name">{bidi(p.name)}</span>
            {p.status ? statusIcons(p.status, true) : null}
        </span>)}
        {extra > 0 && <span className="vc-yvu-companion-chip vc-yvu-extra-chip">+{extra}</span>}
    </div>;
}

function UserAvatar({ userId, size = 48 }: { userId: string; size?: number; }) {
    const p = person(userId);
    return <span className="vc-yvu-avatar" style={{ width: size, height: size }}>{p.avatar ? <img src={p.avatar} alt="" /> : p.name.slice(0, 1)}</span>;
}

function sessionChannelId(log: VoiceLog) {
    return log.channelId ?? log.fromChannelId ?? log.toChannelId ?? null;
}

function sessionChannelName(log: VoiceLog) {
    const cid = sessionChannelId(log);
    if (log.channelName && log.channelName !== text("Not in voice", "ليس في روم صوتي")) return log.channelName;
    if (log.fromChannelName) return log.fromChannelName;
    if (log.toChannelName) return log.toChannelName;
    return cid ? channelName(cid) : text("No room data", "بدون بيانات روم");
}

function isVoiceSessionLog(log: VoiceLog) {
    if (log.type === "track" || log.type === "untrack") return false;
    return Boolean(sessionChannelId(log));
}

function makeSessions(filterUserId?: string) {
    const voiceLogs = logs
        .filter(log => isVoiceSessionLog(log))
        .filter(log => !filterUserId || log.userId === filterUserId)
        .sort((a, b) => a.timestamp - b.timestamp);

    const byRoom = new Map<string, VoiceLog[]>();
    for (const log of voiceLogs) {
        const cid = sessionChannelId(log);
        if (!cid) continue;
        const key = `${log.userId}:${log.guildId ?? channelGuildId(cid) ?? "dm"}:${cid}`;
        if (!byRoom.has(key)) byRoom.set(key, []);
        byRoom.get(key)!.push(log);
    }

    const sessions: SessionCard[] = [];
    for (const [key, entries] of byRoom) {
        const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const cid = sessionChannelId(first) ?? sessionChannelId(last);
        if (!cid) continue;
        const gid = first.guildId ?? last.guildId ?? channelGuildId(cid);
        const companions = new Map<string, Person>();
        for (const entry of sorted) {
            for (const c of entry.companions ?? []) companions.set(c.id, c);
            if (entry.actor) companions.set(entry.actor.id, entry.actor);
        }
        const closedDuration = sorted.reduce((sum, entry) => sum + (entry.durationMs ?? 0), 0);
        const active = activeSessions.get(sessionKey(first.userId, cid));
        const liveDuration = active ? Date.now() - active.startedAt : 0;
        const duration = closedDuration || liveDuration || Math.max(0, last.timestamp - first.timestamp);
        sessions.push({
            key,
            userId: first.userId,
            userName: first.userName,
            guildId: gid,
            guildName: first.guildName ?? last.guildName ?? guildName(gid),
            channelId: cid,
            channelName: sessionChannelName(first),
            startedAt: first.timestamp,
            endedAt: active ? undefined : last.timestamp,
            durationMs: duration,
            events: sorted,
            companions: [...companions.values()],
        });
    }
    return sessions.sort((a, b) => b.startedAt - a.startedAt);
}

function roomReports() {
    const reports = new Map<string, { channelId?: string | null; channelName: string; guildName: string; total: number; events: number; users: Set<string>; streams: number; companions: Map<string, Person>; }>();
    for (const session of makeSessions()) {
        const key = `${session.guildId ?? "dm"}:${session.channelId ?? "none"}`;
        const report = reports.get(key) ?? {
            channelId: session.channelId,
            channelName: session.channelName,
            guildName: session.guildName,
            total: 0,
            events: 0,
            users: new Set<string>(),
            streams: 0,
            companions: new Map<string, Person>(),
        };
        report.total += session.durationMs;
        report.events += session.events.length;
        report.users.add(session.userId);
        report.streams += session.events.filter(e => e.type === "stream_on").length;
        for (const p of session.companions) report.companions.set(p.id, p);
        reports.set(key, report);
    }
    return [...reports.values()].sort((a, b) => b.total - a.total);
}

function copyEvidenceForSession(session: SessionCard) {
    const lines = [
        `User: ${session.userName}`,
        `Server: ${session.guildName}`,
        `Room: ${session.channelName}`,
        `Started: ${formatTime(session.startedAt)}`,
        `Ended: ${session.endedAt ? formatTime(session.endedAt) : "Live"}`,
        `Duration: ${formatDuration(session.durationMs)}`,
        `With: ${session.companions.map(p => p.name).join(", ") || "None"}`,
        "Events:",
        ...session.events.map(e => `- ${formatTime(e.timestamp)} ${eventLabel(e.type).label}${e.actor ? `: ${e.actor.name}` : ""}`),
    ];
    copyToClipboard(lines.join("\n"));
    showToast(text("Evidence copied", "تم نسخ الإثبات"), Toasts.Type.SUCCESS);
}

function deleteLogEvent(logId: string) {
    const before = logs.length;
    logs = logs.filter(log => log.id !== logId);
    if (logs.length === before) return;
    void persistLogs();
    emit();
    showToast(text("Event deleted", "تم حذف الحدث"), Toasts.Type.SUCCESS);
}

function deleteSessionLogs(session: SessionCard) {
    const ids = new Set(session.events.map(event => event.id));
    logs = logs.filter(log => !ids.has(log.id));
    void persistLogs();
    emit();
    showToast(text("Room log card deleted", "تم حذف كارد الروم"), Toasts.Type.SUCCESS);
}

function quickUserEvents(userId: string, limit = 80) {
    return logs
        .filter(log => log.userId === userId)
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
}

function maybeAlert(log: VoiceLog) {
    if (!alertsEnabled) return;
    const tracked = trackedUsers.get(log.userId);
    if (!tracked?.alerts) return;
    const key = `${log.userId}:${log.type}:${log.channelId ?? log.fromChannelId ?? ""}`;
    const now = Date.now();
    if ((alertLastFired.get(key) ?? 0) + cooldownMs > now) return;
    alertLastFired.set(key, now);
    if (["join", "move", "stream_on", "server_mute_on", "server_deaf_on"].includes(log.type)) {
        const item = eventLabel(log.type);
        showToast(`${item.icon} ${log.userName} · ${item.label}`, Toasts.Type.MESSAGE);
    }
}

function goToChannel(channelId?: string | null) {
    if (!channelId) return;
    const guildId = channelGuildId(channelId);
    try {
        if (guildId) {
            NavigationRouter.transitionToGuild(guildId, channelId);
            return;
        }
    } catch { }
    try { ChannelRouter.transitionToChannel(channelId); return; } catch { }
    try { (NavigationRouter as any).transitionTo?.(`/channels/${guildId ?? "@me"}/${channelId}`); } catch { }
}

function joinChannel(channelId?: string | null) {
    if (!channelId) return;
    try { selectVoiceChannel?.(channelId); } catch { }
}

function channelLink(guildId?: string | null, channelId?: string | null) {
    if (!channelId) return "";
    return guildId ? `https://discord.com/channels/${guildId}/${channelId}` : `https://discord.com/channels/@me/${channelId}`;
}

function LiveRoomCard({ location }: { location: Location; }) {
    return <div className="vc-yvu-card vc-yvu-room-card">
        <div className="vc-yvu-card-head vc-yvu-room-card-head">
            <div className="vc-yvu-room-identity">
                <GuildAvatar guildId={location.guildId} size={38} name={location.guild?.name} />
                <div className="vc-yvu-room-title-wrap">
                    <ChannelMention location={location} />
                    <div className="vc-yvu-room-sub">
                        <span className="vc-yvu-server-name">{bidi(location.guild?.name ?? text("DM / Group", "خاص / قروب"))}</span>
                    </div>
                </div>
            </div>
            <span className="vc-yvu-pill vc-yvu-member-count" title={text("Visible people in room", "الأشخاص الظاهرين في الروم")}>{location.companions.length + 1}</span>
        </div>
        <div className="vc-yvu-room-status-row">
            <span className="vc-yvu-muted">{text("User status", "حالة العضو")}</span>
            {statusIcons(location.status) ?? <span className="vc-yvu-status-normal">{text("Normal", "طبيعي")}</span>}
        </div>
        <div className="vc-yvu-room-with">
            <div className="vc-yvu-room-with-head">
                <span className="vc-yvu-muted">{text("With", "معه")}</span>
                <span className="vc-yvu-muted">{location.companions.length}</span>
            </div>
            <AvatarStack people={location.companions} limit={18} />
        </div>
        <div className="vc-yvu-actions">
            <button onClick={() => goToChannel(location.channelId)}>{text("Go", "انتقال")}</button>
            <button disabled={!canConnectChannel(location.channel)} onClick={() => joinChannel(location.channelId)}>{text("Join", "دخول")}</button>
            <button onClick={() => copyToClipboard(channelLink(location.guildId, location.channelId))}>{text("Copy link", "نسخ الرابط")}</button>
            <button onClick={() => toggleTrackedRoom(location.channelId)}>{trackedRooms.has(location.channelId) ? text("Unwatch room", "إلغاء تتبع الروم") : text("Watch room", "تتبع الروم")}</button>
        </div>
    </div>;
}

function MiniLocationCard({ location, index }: { location: Location; index: number; }) {
    return <div className="vc-yvu-mini-location-card">
        <div className="vc-yvu-mini-location-top">
            <div className="vc-yvu-room-identity">
                <GuildAvatar guildId={location.guildId} size={34} name={location.guild?.name} />
                <div className="vc-yvu-room-title-wrap">
                    <ChannelMention location={location} compact />
                    <div className="vc-yvu-mini-server-line">
                        <span className="vc-yvu-server-name">{bidi(location.guild?.name ?? text("DM / Group", "خاص / قروب"))}</span>
                        <span className="vc-yvu-dot-sep">•</span>
                        <span>{text("Visible", "ظاهر")}: {location.companions.length + 1}</span>
                    </div>
                </div>
            </div>
            <span className="vc-yvu-mini-room-index">{index + 1}</span>
        </div>

        <div className="vc-yvu-mini-status-strip">
            <span className="vc-yvu-muted">{text("Status", "الحالة")}</span>
            {statusIcons(location.status) ?? <span className="vc-yvu-status-normal">{text("Normal", "طبيعي")}</span>}
        </div>

        <div className="vc-yvu-mini-with-box">
            <div className="vc-yvu-room-with-head">
                <span className="vc-yvu-muted">{text("With in room", "معه في الروم")}</span>
                <span className="vc-yvu-muted">{location.companions.length}</span>
            </div>
            <AvatarStack people={location.companions} limit={12} />
        </div>

        <div className="vc-yvu-mini-actions">
            <button onClick={() => goToChannel(location.channelId)}>{text("Open", "فتح")}</button>
            <button disabled={!canConnectChannel(location.channel)} onClick={() => joinChannel(location.channelId)}>{text("Join", "دخول")}</button>
            <button onClick={() => copyToClipboard(channelLink(location.guildId, location.channelId))}>{text("Copy", "نسخ")}</button>
            <button onClick={() => toggleTrackedRoom(location.channelId)}>{trackedRooms.has(location.channelId) ? text("Unwatch", "إلغاء") : text("Watch", "تتبع")}</button>
        </div>
    </div>;
}

function WatchRow({ userId }: { userId: string; }) {
    const locations = getUserLocations(userId).filter(loc => !trackedGuildId || loc.guildId === trackedGuildId);
    const tracked = trackedUsers.get(userId);
    const totalLive = locations.reduce((sum, loc) => {
        const active = activeSessions.get(sessionKey(userId, loc.channelId));
        return sum + (active ? Date.now() - active.startedAt : 0);
    }, 0);
    return <div className="vc-yvu-card vc-yvu-watch-row">
        <UserAvatar userId={userId} />
        <div className="vc-yvu-watch-main">
            <div className="vc-yvu-user-title">{bidi(tracked?.name ?? userName(userId))}</div>
            <div className="vc-yvu-muted">{locations.length ? text("Currently in voice", "موجود بالصوت الآن") : text("Not visible in voice", "غير ظاهر بالصوت")}</div>
            <div className="vc-yvu-live-list">
                {locations.map(loc => <LiveRoomCard location={loc} key={loc.channelId} />)}
            </div>
        </div>
        <div className="vc-yvu-watch-side">
            <span className="vc-yvu-pill">{locations.length > 1 ? `${locations.length} rooms` : locations.length ? "1 room" : "0"}</span>
            <span className="vc-yvu-muted">{formatDuration(totalLive)}</span>
            <div className="vc-yvu-actions vc-yvu-actions-vertical">
                <button onClick={() => toggleFavorite(userId)}>{tracked?.favorite ? text("Unfavorite", "إلغاء التثبيت") : text("Favorite", "تثبيت")}</button>
                <button onClick={() => togglePinnedUser(userId)}>{pinned.has(userId) ? text("Unpin", "إلغاء من البوب آوت") : text("Pin", "تثبيت بوب آوت")}</button>
                <button onClick={() => untrackUser(userId)}>{text("Untrack", "إلغاء التتبع")}</button>
            </div>
        </div>
    </div>;
}

function LiveTab({ focusUserId }: { focusUserId?: string; }) {
    const [kind, setKind] = React.useState<"current" | "friends" | "dms" | "all">(() => SelectedGuildStore.getGuildId?.() ? "current" : "all");
    const [query, setQuery] = React.useState("");
    const rows = locationRows(focusUserId ? "all" : kind, focusUserId).filter(row => {
        const name = userName(row.userId).toLowerCase();
        return !query || name.includes(query.toLowerCase()) || row.locations.some(loc => (loc.channel?.name ?? "").toLowerCase().includes(query.toLowerCase()));
    });
    return <div className="vc-yvu-tab">
        <div className="vc-yvu-toolbar">
            {["current", "friends", "dms", "all"].map(item => <button key={item} className={kind === item ? "vc-yvu-active" : ""} onClick={() => setKind(item as any)}>{text(item === "current" ? "Current server" : item === "friends" ? "Friends" : item === "dms" ? "DMs" : "Known", item === "current" ? "السيرفر الحالي" : item === "friends" ? "الأصدقاء" : item === "dms" ? "الخاص" : "المعروفين")}</button>)}
            <input className="vc-yvu-input" placeholder={text("Search user or room", "بحث عن شخص أو روم")} value={query} onChange={e => setQuery(e.currentTarget.value)} />
        </div>
        <div className="vc-yvu-grid2">
            {rows.length ? rows.map(row => <div className="vc-yvu-card" key={row.userId}>
                <div className="vc-yvu-user-head">
                    <UserAvatar userId={row.userId} />
                    <div>
                        <div className="vc-yvu-user-title">{bidi(userName(row.userId))}</div>
                        <div className="vc-yvu-muted">{row.locations.length > 1 ? text("Multiple voice locations", "موجود بأكثر من روم") : text("Voice location", "موقع الصوت")}</div>
                    </div>
                    {row.locations.length > 1 && <span className="vc-yvu-count-badge">{row.locations.length}</span>}
                </div>
                {row.locations.map(loc => <LiveRoomCard key={loc.channelId} location={loc} />)}
                <div className="vc-yvu-actions">
                    <button onClick={() => trackUser(row.userId)}>{trackedUsers.has(row.userId) ? text("Tracked", "متابع") : text("Track", "تتبع")}</button>
                    <button onClick={() => togglePinnedUser(row.userId)}>{pinned.has(row.userId) ? text("Pinned", "مثبت") : text("Pin", "تثبيت")}</button>
                </div>
            </div>) : <Empty />}
        </div>
    </div>;
}

function WatchTab() {
    const users = [...trackedUsers.keys()];
    return <div className="vc-yvu-tab">
        <div className="vc-yvu-kpis">
            <Kpi label={text("Tracked users", "المتابعين")} value={users.length} />
            <Kpi label={text("Tracked server", "نطاق السيرفر")} value={trackedGuildId ? guildName(trackedGuildId) : text("All visible", "كل الظاهر")} />
            <Kpi label={text("Watched rooms", "الرومات المتابعة")} value={trackedRooms.size} />
        </div>
        <div className="vc-yvu-actions">
            <button onClick={() => setTrackedGuild(SelectedGuildStore.getGuildId?.() ?? null)}>{text("Use current server as scope", "اجعل السيرفر الحالي نطاق التتبع")}</button>
            <button onClick={() => setTrackedGuild(null)}>{text("Clear server scope", "إلغاء نطاق السيرفر")}</button>
        </div>
        <div className="vc-yvu-stack">{users.length ? users.map(id => <WatchRow key={id} userId={id} />) : <Empty />}</div>
    </div>;
}

function Kpi({ label, value }: { label: string; value: React.ReactNode; }) {
    return <div className="vc-yvu-kpi"><strong>{bidi(value)}</strong><span>{label}</span></div>;
}

function QuickUserActivity({ userId, onClose }: { userId: string; onClose?: () => void; }) {
    const events = quickUserEvents(userId, 90);
    const totalRooms = new Set(events.map(sessionChannelId).filter(Boolean)).size;
    return <div className="vc-yvu-card vc-yvu-quick-user-events">
        <div className="vc-yvu-quick-user-head">
            <div className="vc-yvu-user-head">
                <UserAvatar userId={userId} size={44} />
                <div>
                    <div className="vc-yvu-user-title">{text("Quick member activity", "أحداث العضو السريعة")}: {bidi(userName(userId))}</div>
                    <div className="vc-yvu-muted">{text("Latest events across all rooms", "آخر الأحداث مجمعة من كل الرومات")} · {events.length} · {text("Rooms", "الرومات")}: {totalRooms}</div>
                </div>
            </div>
            <div className="vc-yvu-actions">
                <button onClick={() => trackUser(userId)}>{trackedUsers.has(userId) ? text("Tracked", "متابع") : text("Track", "تتبع")}</button>
                {onClose ? <button onClick={onClose}>{text("Close", "إغلاق")}</button> : null}
            </div>
        </div>
        <div className="vc-yvu-quick-event-list">
            {events.length ? events.map(event => {
                const item = eventLabel(event.type);
                return <div className="vc-yvu-quick-event" key={event.id}>
                    <span className="vc-yvu-event-dot">{item.icon}</span>
                    <div className="vc-yvu-quick-event-main">
                        <div className="vc-yvu-event-title">{item.label} {event.actor ? <>· {bidi(event.actor.name)}</> : null}</div>
                        <div className="vc-yvu-muted"><span dir="ltr">{formatTime(event.timestamp)}</span> · {bidi(event.guildName ?? guildName(event.guildId))} · {bidi(sessionChannelName(event))}</div>
                        <StatusChangeStack event={event} />
                    </div>
                    <button className="vc-yvu-icon-btn vc-yvu-danger-lite" title={text("Delete event", "حذف الحدث")} onClick={() => deleteLogEvent(event.id)}>×</button>
                </div>;
            }) : <Empty />}
        </div>
    </div>;
}

function LogsTab({ focusUserId }: { focusUserId?: string; }) {
    const [expanded, setExpanded] = React.useState<string | null>(null);
    const [query, setQuery] = React.useState("");
    const [kind, setKind] = React.useState<"all" | "stream" | "status" | "moves" | "companions">("all");
    const [quickUserId, setQuickUserId] = React.useState<string | undefined>(focusUserId);

    React.useEffect(() => setQuickUserId(focusUserId), [focusUserId]);

    const sessions = makeSessions(focusUserId).filter(session => {
        if (query && !`${session.userName} ${session.channelName} ${session.guildName}`.toLowerCase().includes(query.toLowerCase())) return false;
        if (kind === "stream" && !session.events.some(e => e.type === "stream_on" || e.type === "stream_off")) return false;
        if (kind === "status" && !session.events.some(e => e.type.includes("mute") || e.type.includes("deaf"))) return false;
        if (kind === "moves" && !session.events.some(e => e.type === "move" || e.type === "join" || e.type === "leave")) return false;
        if (kind === "companions" && !session.events.some(e => e.type.includes("companion"))) return false;
        return true;
    });
    return <div className="vc-yvu-tab">
        <div className="vc-yvu-toolbar">
            <input className="vc-yvu-input" placeholder={text("Search logs", "بحث في اللوقات")} value={query} onChange={e => setQuery(e.currentTarget.value)} />
            {["all", "stream", "status", "moves", "companions"].map(item => <button key={item} className={kind === item ? "vc-yvu-active" : ""} onClick={() => setKind(item as any)}>{text(item, item === "all" ? "الكل" : item === "stream" ? "الستريم" : item === "status" ? "الحالات" : item === "moves" ? "الحركة" : "المرافقين")}</button>)}
        </div>
        {quickUserId ? <QuickUserActivity userId={quickUserId} onClose={focusUserId ? undefined : () => setQuickUserId(undefined)} /> : null}
        <div className="vc-yvu-stack">
            {sessions.length ? sessions.map(session => {
                const open = expanded === session.key;
                const newestEvent = session.events.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
                const newestTime = newestEvent?.timestamp ?? session.startedAt;
                return <div className={`vc-yvu-card vc-yvu-session ${open ? "vc-yvu-session-open" : ""}`} key={session.key}>
                    <div className="vc-yvu-session-head">
                        <button className="vc-yvu-session-user" onClick={() => setQuickUserId(session.userId)} title={text("Show this member's latest events", "عرض آخر أحداث هذا العضو")}>
                            <UserAvatar userId={session.userId} size={42} />
                            <div>
                                <div className="vc-yvu-user-title">{bidi(session.userName)} · {bidi(session.channelName)}</div>
                                <div className="vc-yvu-muted">{bidi(session.guildName)} · {formatTime(newestTime)} · {formatDuration(session.durationMs)}</div>
                            </div>
                        </button>
                        <AvatarStack people={session.companions} />
                        <span className="vc-yvu-pill">{session.events.length}</span>
                        <button className="vc-yvu-icon-btn" onClick={() => setExpanded(open ? null : session.key)} title={open ? text("Collapse", "إغلاق") : text("Expand", "فتح")}>{open ? "−" : "+"}</button>
                    </div>
                    {open && <div className="vc-yvu-session-body">
                        <div className="vc-yvu-actions">
                            <button onClick={() => copyEvidenceForSession(session)}>{text("Quick Copy Evidence", "نسخ إثبات سريع")}</button>
                            <button className="vc-yvu-danger-lite" onClick={() => deleteSessionLogs(session)}>{text("Delete room card", "حذف كارد الروم")}</button>
                        </div>
                        <div className="vc-yvu-timeline">
                            {session.events.slice().sort((a, b) => b.timestamp - a.timestamp).map(event => {
                                const item = eventLabel(event.type);
                                return <div className="vc-yvu-event" key={event.id}>
                                    <span className="vc-yvu-event-dot">{item.icon}</span>
                                    <div className="vc-yvu-event-content">
                                        <div className="vc-yvu-event-headline">
                                            <div className="vc-yvu-event-title">{item.label} {event.actor ? <>· {bidi(event.actor.name)}</> : null}</div>
                                            <button className="vc-yvu-icon-btn vc-yvu-danger-lite" title={text("Delete event", "حذف الحدث")} onClick={() => deleteLogEvent(event.id)}>×</button>
                                        </div>
                                        <StatusChangeStack event={event} />
                                        {event.companions?.length ? <AvatarStack people={event.companions} limit={10} /> : null}
                                    </div>
                                </div>;
                            })}
                        </div>
                    </div>}
                </div>;
            }) : <Empty />}
        </div>
    </div>;
}

function buildActivityHeatmap() {
    // 7 days x 24 hours grid. Row 0 = Sunday for English locale; we display as is.
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let maxValue = 0;
    for (const session of makeSessions()) {
        const date = new Date(session.startedAt);
        const day = date.getDay();
        const hour = date.getHours();
        const minutes = Math.max(1, Math.floor(session.durationMs / 60000));
        grid[day][hour] += minutes;
        if (grid[day][hour] > maxValue) maxValue = grid[day][hour];
    }
    return { grid, maxValue };
}

function durationBuckets() {
    const buckets = [
        { label: "<5m", max: 5 * 60_000, count: 0 },
        { label: "5–15m", max: 15 * 60_000, count: 0 },
        { label: "15–30m", max: 30 * 60_000, count: 0 },
        { label: "30–60m", max: 60 * 60_000, count: 0 },
        { label: "1–2h", max: 2 * 60 * 60_000, count: 0 },
        { label: "2–4h", max: 4 * 60 * 60_000, count: 0 },
        { label: "4h+", max: Infinity, count: 0 },
    ];
    for (const session of makeSessions()) {
        const bucket = buckets.find(b => session.durationMs < b.max);
        if (bucket) bucket.count++;
    }
    return buckets;
}

function topUsersByVoiceTime(limit = 10) {
    const totals = new Map<string, { userId: string; name: string; ms: number; sessions: number; }>();
    for (const session of makeSessions()) {
        const entry = totals.get(session.userId) ?? { userId: session.userId, name: session.userName, ms: 0, sessions: 0 };
        entry.ms += session.durationMs;
        entry.sessions += 1;
        totals.set(session.userId, entry);
    }
    return [...totals.values()].sort((a, b) => b.ms - a.ms).slice(0, limit);
}

function topRoomsByVoiceTime(limit = 10) {
    const totals = new Map<string, { channelName: string; guildName: string; ms: number; users: Set<string>; }>();
    for (const session of makeSessions()) {
        const key = `${session.guildId ?? "dm"}:${session.channelId ?? "none"}`;
        const entry = totals.get(key) ?? { channelName: session.channelName, guildName: session.guildName, ms: 0, users: new Set<string>() };
        entry.ms += session.durationMs;
        entry.users.add(session.userId);
        totals.set(key, entry);
    }
    return [...totals.values()].sort((a, b) => b.ms - a.ms).slice(0, limit);
}

function StatsTab() {
    const { grid, maxValue } = React.useMemo(buildActivityHeatmap, [logs.length]);
    const buckets = React.useMemo(durationBuckets, [logs.length]);
    const topUsers = React.useMemo(() => topUsersByVoiceTime(10), [logs.length]);
    const topRooms = React.useMemo(() => topRoomsByVoiceTime(10), [logs.length]);
    const sessions = makeSessions();
    const totalMs = sessions.reduce((sum, session) => sum + session.durationMs, 0);
    const avgMs = sessions.length ? Math.round(totalMs / sessions.length) : 0;
    const dayNames = isArabic()
        ? ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
        : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const maxBucketCount = Math.max(1, ...buckets.map(b => b.count));

    return <div className="vc-yvu-tab">
        <div className="vc-yvu-kpis">
            <Kpi label={text("Total voice time", "الإجمالي الصوتي")} value={formatDuration(totalMs)} />
            <Kpi label={text("Sessions", "الجلسات")} value={sessions.length} />
            <Kpi label={text("Avg session", "متوسط الجلسة")} value={formatDuration(avgMs)} />
            <Kpi label={text("Tracked users", "المتابعين")} value={trackedUsers.size} />
        </div>

        <div className="vc-yvu-panel-block">
            <h3>{text("Activity heatmap (7d × 24h)", "خريطة النشاط 7 أيام × 24 ساعة")}</h3>
            <div className="vc-yvu-heatmap" role="grid" aria-label={text("Voice activity heatmap", "خريطة النشاط الصوتي")}>
                <div className="vc-yvu-heatmap-hours">
                    <span className="vc-yvu-heatmap-corner" />
                    {Array.from({ length: 24 }, (_, hour) => (
                        <span key={hour} className="vc-yvu-heatmap-hour" title={`${hour}:00`}>{hour % 3 === 0 ? hour : ""}</span>
                    ))}
                </div>
                {grid.map((row, day) => (
                    <div key={day} className="vc-yvu-heatmap-row">
                        <span className="vc-yvu-heatmap-day">{dayNames[day]}</span>
                        {row.map((value, hour) => {
                            const intensity = maxValue ? value / maxValue : 0;
                            return <span
                                key={hour}
                                className="vc-yvu-heatmap-cell"
                                title={`${dayNames[day]} ${hour}:00 — ${value}m`}
                                style={{ background: value === 0
                                    ? "rgb(255 255 255 / 5%)"
                                    : `color-mix(in srgb, var(--yvu-accent, #f0b232) ${Math.round(intensity * 88)}%, rgb(255 255 255 / 4%))` }}
                            />;
                        })}
                    </div>
                ))}
            </div>
        </div>

        <div className="vc-yvu-grid2">
            <div className="vc-yvu-card vc-yvu-stats-card">
                <h3>{text("Top users by voice time", "الأكثر تواجداً صوتياً")}</h3>
                <div className="vc-yvu-stats-list">
                    {topUsers.length ? topUsers.map((entry, i) => (
                        <div key={entry.userId} className="vc-yvu-stats-row">
                            <span className="vc-yvu-stats-rank">{i + 1}</span>
                            <UserAvatar userId={entry.userId} size={28} />
                            <div className="vc-yvu-stats-main">
                                <div className="vc-yvu-stats-name">{bidi(entry.name)}</div>
                                <div className="vc-yvu-muted">{entry.sessions} {text("sessions", "جلسات")}</div>
                            </div>
                            <strong className="vc-yvu-stats-value">{formatDuration(entry.ms)}</strong>
                        </div>
                    )) : <Empty />}
                </div>
            </div>

            <div className="vc-yvu-card vc-yvu-stats-card">
                <h3>{text("Top rooms by voice time", "الرومات الأكثر نشاطاً")}</h3>
                <div className="vc-yvu-stats-list">
                    {topRooms.length ? topRooms.map((entry, i) => (
                        <div key={`${entry.guildName}:${entry.channelName}`} className="vc-yvu-stats-row">
                            <span className="vc-yvu-stats-rank">{i + 1}</span>
                            <div className="vc-yvu-stats-main">
                                <div className="vc-yvu-stats-name">{bidi(entry.channelName)}</div>
                                <div className="vc-yvu-muted">{bidi(entry.guildName)} · {entry.users.size} {text("users", "أشخاص")}</div>
                            </div>
                            <strong className="vc-yvu-stats-value">{formatDuration(entry.ms)}</strong>
                        </div>
                    )) : <Empty />}
                </div>
            </div>
        </div>

        <div className="vc-yvu-panel-block">
            <h3>{text("Session length distribution", "توزيع طول الجلسات")}</h3>
            <div className="vc-yvu-histogram">
                {buckets.map(bucket => (
                    <div key={bucket.label} className="vc-yvu-histogram-bar">
                        <div className="vc-yvu-histogram-fill" style={{ height: `${(bucket.count / maxBucketCount) * 100}%` }} />
                        <span className="vc-yvu-histogram-label">{bucket.label}</span>
                        <span className="vc-yvu-histogram-count">{bucket.count}</span>
                    </div>
                ))}
            </div>
        </div>
    </div>;
}

function ReportsTab() {
    const [wasWith, setWasWith] = React.useState("");
    const reports = roomReports();
    const lower = wasWith.toLowerCase();
    const matching = lower ? makeSessions().filter(s => s.companions.some(p => p.name.toLowerCase().includes(lower) || p.id.includes(wasWith))) : [];
    const journeys = [...trackedUsers.keys()].map(userId => {
        const sessions = makeSessions(userId).slice(0, 12).reverse();
        return { userId, sessions };
    }).filter(j => j.sessions.length);
    return <div className="vc-yvu-tab">
        <div className="vc-yvu-kpis">
            <Kpi label={text("Total logs", "إجمالي اللوقات")} value={logs.length} />
            <Kpi label={text("Room reports", "تقارير الرومات")} value={reports.length} />
            <Kpi label={text("Total sessions", "الجلسات")} value={makeSessions().length} />
        </div>
        <div className="vc-yvu-panel-block">
            <h3>{text("Was With Search", "بحث: كان مع")}</h3>
            <div className="vc-yvu-toolbar"><input className="vc-yvu-input" placeholder={text("Type username or user ID", "اكتب اسم أو آيدي الشخص")} value={wasWith} onChange={e => setWasWith(e.currentTarget.value)} /></div>
            {matching.map(session => <div className="vc-yvu-card vc-yvu-small-report" key={session.key}>{bidi(session.userName)} · {bidi(session.channelName)} · {formatDuration(session.durationMs)} <AvatarStack people={session.companions} /></div>)}
        </div>
        <div className="vc-yvu-panel-block">
            <h3>{text("Room Report Cards", "كروت تقارير الرومات")}</h3>
            <div className="vc-yvu-grid2">{reports.map(report => <div className="vc-yvu-card" key={`${report.guildName}:${report.channelName}`}>
                <div className="vc-yvu-room-title">{bidi(report.channelName)}</div>
                <div className="vc-yvu-room-sub">{bidi(report.guildName)}</div>
                <div className="vc-yvu-kpis vc-yvu-kpis-mini">
                    <Kpi label={text("Total", "المجموع")} value={formatDuration(report.total)} />
                    <Kpi label={text("Events", "الأحداث")} value={report.events} />
                    <Kpi label={text("Users", "الأشخاص")} value={report.users.size} />
                    <Kpi label={text("Streams", "الستريمات")} value={report.streams} />
                </div>
                <AvatarStack people={[...report.companions.values()]} limit={12} />
            </div>)}</div>
        </div>
        <div className="vc-yvu-panel-block">
            <h3>{text("Room Journey Map", "خريطة تنقل الرومات")}</h3>
            {journeys.map(journey => <div className="vc-yvu-card" key={journey.userId}>
                <div className="vc-yvu-user-head"><UserAvatar userId={journey.userId} /><strong>{bidi(userName(journey.userId))}</strong></div>
                <div className="vc-yvu-journey">{journey.sessions.map((session, index) => <React.Fragment key={session.key}><span>{bidi(session.channelName)}</span>{index < journey.sessions.length - 1 && <em>→</em>}</React.Fragment>)}</div>
            </div>)}
        </div>
    </div>;
}

function AlertsTab() {
    return <div className="vc-yvu-tab">
        <div className="vc-yvu-card">
            <h3>{text("Smart Alerts", "التنبيهات الذكية")}</h3>
            <label className="vc-yvu-switch"><input type="checkbox" checked={alertsEnabled} onChange={() => { alertsEnabled = !alertsEnabled; persistData(); emit(); }} /> <span>{text("Enable local alerts for tracked users", "تفعيل التنبيهات المحلية للمتابعين")}</span></label>
            <div className="vc-yvu-toolbar"><button onClick={() => { cooldownMs = 60_000; persistData(); emit(); }}>1m</button><button onClick={() => { cooldownMs = 5 * 60_000; persistData(); emit(); }}>5m</button><button onClick={() => { cooldownMs = 15 * 60_000; persistData(); emit(); }}>15m</button><span className="vc-yvu-muted">{text("Current cooldown", "الكولداون الحالي")}: {formatDuration(cooldownMs)}</span></div>
        </div>
        <div className="vc-yvu-stack">{[...trackedUsers.values()].map(user => <div className="vc-yvu-card vc-yvu-row" key={user.userId}><UserAvatar userId={user.userId} size={36} /><strong>{bidi(user.name)}</strong><label className="vc-yvu-switch"><input type="checkbox" checked={user.alerts !== false} onChange={() => { user.alerts = user.alerts === false; trackedUsers.set(user.userId, user); persistData(); emit(); }} /> <span>{text("Alerts", "تنبيهات")}</span></label></div>)}</div>
    </div>;
}

function DataTab() {
    const [importText, setImportText] = React.useState("");
    const [showImport, setShowImport] = React.useState(false);
    const size = new Blob([JSON.stringify(logs)]).size;

    function backup() {
        copyToClipboard(JSON.stringify({ logs, trackedUsers: Object.fromEntries(trackedUsers), trackedGuildId, trackedRooms: [...trackedRooms], theme: currentTheme, customTheme }, null, 2));
        showToast(text("Backup copied", "تم نسخ النسخة الاحتياطية"), Toasts.Type.SUCCESS);
    }

    function importBackup() {
        try {
            const data = JSON.parse(importText);
            if (!data || typeof data !== "object") throw new Error("Invalid JSON");

            if (Array.isArray(data.logs)) logs = data.logs;
            if (data.trackedUsers && typeof data.trackedUsers === "object") {
                trackedUsers = new Map(Object.entries(data.trackedUsers as Record<string, any>));
            }
            if (typeof data.trackedGuildId === "string" || data.trackedGuildId === null) trackedGuildId = data.trackedGuildId;
            if (Array.isArray(data.trackedRooms)) trackedRooms = new Set(data.trackedRooms);
            if (typeof data.theme === "string") currentTheme = data.theme as ThemeName;
            if (data.customTheme && typeof data.customTheme === "object") customTheme = { ...customTheme, ...data.customTheme };

            persistData();
            persistLogs();
            emit();
            setImportText("");
            setShowImport(false);
            showToast(text("Backup imported", "تم استيراد النسخة"), Toasts.Type.SUCCESS);
        } catch (error) {
            console.error("YamachVoiceUtilitiesPro import failed", error);
            showToast(text("Invalid JSON", "JSON غير صالح"), Toasts.Type.FAILURE);
        }
    }

    function downloadBackup() {
        const payload = { logs, trackedUsers: Object.fromEntries(trackedUsers), trackedGuildId, trackedRooms: [...trackedRooms], theme: currentTheme, customTheme };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `yamach-voice-utilities-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToast(text("Backup downloaded", "تم تنزيل النسخة"), Toasts.Type.SUCCESS);
    }

    return <div className="vc-yvu-tab">
        <div className="vc-yvu-kpis">
            <Kpi label={text("Logs", "اللوقات")} value={logs.length} />
            <Kpi label={text("Sessions", "الجلسات")} value={makeSessions().length} />
            <Kpi label={text("Storage", "التخزين")} value={`${(size / 1024 / 1024).toFixed(2)} MB`} />
            <Kpi label={text("Tracked", "المتابعين")} value={trackedUsers.size} />
        </div>
        <div className="vc-yvu-card">
            <h3>{text("Backup & Restore", "نسخ احتياطي واستعادة")}</h3>
            <div className="vc-yvu-actions">
                <button onClick={backup}>{text("Copy JSON to clipboard", "نسخ JSON")}</button>
                <button onClick={downloadBackup}>{text("Download .json", "تنزيل .json")}</button>
                <button onClick={() => setShowImport(show => !show)}>{showImport ? text("Cancel import", "إلغاء الاستيراد") : text("Import backup…", "استيراد نسخة…")}</button>
            </div>
            {showImport ? <div className="vc-yvu-import-area">
                <textarea
                    placeholder={text("Paste JSON here…", "الصق JSON هنا…")}
                    value={importText}
                    onChange={event => setImportText(event.currentTarget.value)}
                />
                <div className="vc-yvu-actions">
                    <button onClick={importBackup} disabled={!importText.trim()}>{text("Apply import", "تطبيق الاستيراد")}</button>
                </div>
            </div> : null}
        </div>
        <div className="vc-yvu-card">
            <h3>{text("Cleanup Tools", "أدوات التنظيف")}</h3>
            <div className="vc-yvu-actions">
                <button onClick={() => { logs = []; persistLogs(); emit(); }}>{text("Clear all logs", "مسح كل اللوقات")}</button>
                <button onClick={() => { const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; logs = logs.filter(l => l.timestamp >= cutoff); persistLogs(); emit(); }}>{text("Clear older than 30 days", "مسح أقدم من 30 يوم")}</button>
                <button onClick={() => { const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; logs = logs.filter(l => l.timestamp >= cutoff); persistLogs(); emit(); }}>{text("Clear older than 7 days", "مسح أقدم من 7 أيام")}</button>
                <button onClick={() => { trackedUsers.clear(); pinned.clear(); trackedRooms.clear(); persistData(); emit(); }}>{text("Clear tracking data", "مسح بيانات التتبع")}</button>
            </div>
        </div>
    </div>;
}

function ThemeTab() {
    const themes: Array<[ThemeName, string]> = [
        ["yamach", "Yamach Dark"],
        ["native", "Discord Native"],
        ["midnight", "Midnight Glass"],
        ["neon", "Neon Pro"],
        ["emerald", "Emerald Admin"],
        ["crimson", "Crimson Ops"],
        ["royal", "Royal Purple"],
        ["minimal", "Minimal Admin"],
        ["ocean", "Ocean Depth"],
        ["sunset", "Sunset Ops"],
        ["cyber", "Cyber Lime"],
        ["sakura", "Sakura Night"],
        ["amber", "Amber Control"],
        ["ice", "Ice Blue"],
        ["matrix", "Matrix Green"],
        ["obsidian", "Obsidian Red"],
        ["steel", "Steel Slate"],
        ["lavender", "Lavender Pulse"],
        ["gold", "Yamach Gold"],
        ["ruby", "Ruby Dark"],
        ["custom", "Custom Builder"],
    ];
    return <div className="vc-yvu-tab">
        <div className="vc-yvu-theme-note">{text("Themes now apply to the whole Voice Utilities panel, the room controls, Yamach Command Center, and the multi-room popout.", "الثيمات الآن تطبق على البلوقن كامل: لوحة أدوات الصوت، التحكم بالرومات، مركز Yamach، وبوب آوت تعدد الرومات.")}</div>
        <div className="vc-yvu-grid2 vc-yvu-theme-grid">{themes.map(([theme, label]) => <button key={theme} className={`vc-yvu-theme-card vc-yvu-theme-${theme} ${currentTheme === theme ? "vc-yvu-theme-selected" : ""}`} onClick={() => { currentTheme = theme; persistData(); emit(); }}>
            <strong>{label}</strong>
            <span>{text("Apply to all panels", "تطبيق على كل اللوحات")}</span>
        </button>)}</div>
        <div className="vc-yvu-card vc-yvu-theme-builder">
            <h3>{text("Theme Builder", "بناء الثيم")}</h3>
            <label>{text("Accent", "اللون")}: <input className="vc-yvu-input" value={customTheme.accent} onChange={e => { customTheme.accent = e.currentTarget.value; currentTheme = "custom"; persistData(); emit(); }} /></label>
            <label>{text("Surface", "الخلفية")}: <input className="vc-yvu-input" value={customTheme.surface} onChange={e => { customTheme.surface = e.currentTarget.value; currentTheme = "custom"; persistData(); emit(); }} /></label>
            <label>{text("Cards", "الكروت")}: <input className="vc-yvu-input" value={customTheme.surface2} onChange={e => { customTheme.surface2 = e.currentTarget.value; currentTheme = "custom"; persistData(); emit(); }} /></label>
            <label className="vc-yvu-switch"><input type="checkbox" checked={customTheme.glow} onChange={() => { customTheme.glow = !customTheme.glow; currentTheme = "custom"; persistData(); emit(); }} /> <span>{text("Glow", "توهج")}</span></label>
        </div>
    </div>;
}

function Empty() {
    return <div className="vc-yvu-empty">{text("Nothing to show yet.", "لا يوجد شيء لعرضه الآن.")}</div>;
}

function makeThemeStyle(): React.CSSProperties {
    if (currentTheme === "custom") return {
        ["--yvu-accent" as any]: customTheme.accent,
        ["--yvu-accent-2" as any]: customTheme.accent,
        ["--yvu-bg" as any]: customTheme.surface,
        ["--yvu-card" as any]: customTheme.surface2,
        ["--yvu-card-2" as any]: customTheme.surface2,
        ["--yvu-radius" as any]: `${customTheme.radius}px`,
        ["--yvu-glow" as any]: customTheme.glow ? customTheme.accent : "transparent",
    };
    return {};
}

export function getYamachThemeClass() {
    return `vc-yvu-theme-${currentTheme}`;
}

export function getYamachThemeStyle(): React.CSSProperties {
    return makeThemeStyle();
}

export function YamachCommandCenter({ guildId, channel, focusUserId, initialTab, selectedUserIds = [] }: { guildId: string; channel: Channel; focusUserId?: string; initialTab?: YamachTab; selectedUserIds?: string[]; }) {
    const [, force] = React.useState(0);
    React.useEffect(() => subscribeYamach(() => force(v => v + 1)), []);
    const [tab, setTab] = React.useState<YamachTab>(initialTab ?? "live");
    const focused = focusUserId ? UserStore.getUser(focusUserId) : undefined;
    const panelGuildId = guildId === "__yamach_global__" ? null : guildId;
    const selectedGuildId = SelectedGuildStore.getGuildId?.() ?? panelGuildId;

    return <div className={`vc-yvu-command-center vc-yvu-theme-${currentTheme}`} dir={isArabic() ? "rtl" : "ltr"} style={makeThemeStyle()}>
        <div className="vc-yvu-hero">
            <div>
                <h2>{text("Yamach Command Center", "مركز Yamach للتحكم")}</h2>
                <p>{text("Voice finder, live rooms, watch board, logs, reports and evidence inside the same Voice Utilities panel.", "باحث الصوت، الرومات المباشرة، المتابعة، اللوقات، التقارير والإثباتات داخل نفس لوحة أدوات الصوت.")}</p>
            </div>
            <div className="vc-yvu-credit">Made by Yamach</div>
        </div>
        {focused && <div className="vc-yvu-card vc-yvu-focused"><UserAvatar userId={focusUserId!} /><span>{text("Focused user", "الشخص المحدد")}: {bidi(userName(focusUserId!))}</span><button onClick={() => trackUser(focusUserId!)}>{trackedUsers.has(focusUserId!) ? text("Tracked", "متابع") : text("Track", "تتبع")}</button></div>}
        <div className="vc-yvu-tabs">
            {([
                ["live", text("Live", "مباشر")],
                ["watch", text("Watch Board", "لوحة المتابعة")],
                ["logs", text("Logs", "اللوقات")],
                ["reports", text("Reports", "التقارير")],
                ["heatmap", text("Heatmap", "خريطة النشاط")],
                ["stats", text("Stats", "الإحصائيات")],
                ["presets", text("Presets", "المجموعات")],
                ["alerts", text("Alerts", "التنبيهات")],
                ["data", text("Data", "البيانات")],
                ["theme", text("Themes", "الثيمات")],
            ] as [YamachTab, string][]).map(([id, label]) => <button key={id} className={tab === id ? "vc-yvu-active" : ""} onClick={() => setTab(id)}>{label}</button>)}
        </div>
        <div className="vc-yvu-scope-line">
            <span>{text("Panel server", "سيرفر اللوحة")}: {selectedGuildId ? bidi(guildName(selectedGuildId)) : text("Global", "عام")}</span>
            <span>{text("Tracking scope", "نطاق التتبع")}: {trackedGuildId ? bidi(guildName(trackedGuildId)) : text("All visible", "كل الظاهر")}</span>
            <button disabled={!selectedGuildId} onClick={() => selectedGuildId && setTrackedGuild(selectedGuildId)}>{text("Use this server", "استخدم هذا السيرفر")}</button>
            <button onClick={() => setTrackedGuild(null)}>{text("All visible", "كل الظاهر")}</button>
            <button disabled={channel.id === "__yamach_global__"} onClick={() => channel.id !== "__yamach_global__" && toggleTrackedRoom(channel.id)}>{trackedRooms.has(channel.id) ? text("Unwatch opened room", "إلغاء تتبع الروم المفتوح") : text("Watch opened room", "تتبع الروم المفتوح")}</button>
            {selectedUserIds.length > 0 && <button onClick={() => trackUsers(selectedUserIds)}>{text("Track selected", "تتبع المحددين")} ({selectedUserIds.length})</button>}
        </div>
        {tab === "live" && <LiveTab focusUserId={focusUserId} />}
        {tab === "watch" && <WatchTab />}
        {tab === "logs" && <LogsTab focusUserId={focusUserId} />}
        {tab === "reports" && <ReportsTab />}
        {tab === "heatmap" && <HeatmapTab logs={logs} focusUserId={focusUserId} />}
        {tab === "stats" && <DashboardStatsTab logs={logs} sessions={makeSessions()} focusUserId={focusUserId} />}
        {tab === "presets" && <PresetsTab guildId={panelGuildId} selectedUserIds={selectedUserIds} />}
        {tab === "alerts" && <AlertsTab />}
        {tab === "data" && <DataTab />}
        {tab === "theme" && <ThemeTab />}
    </div>;
}

function PresetsTab({ guildId, selectedUserIds }: { guildId: string | null; selectedUserIds: string[]; }) {
    const [, force] = React.useState(0);
    const [name, setName] = React.useState("");
    React.useEffect(() => subscribePresets(() => force(v => v + 1)), []);
    React.useEffect(() => { void loadPresets().then(() => force(v => v + 1)); }, []);

    const presets = listPresets(guildId);

    function handleCreate() {
        if (!selectedUserIds.length) {
            showToast(text("Select members first", "حدد أعضاء أولاً"), Toasts.Type.FAILURE);
            return;
        }
        if (!name.trim()) {
            showToast(text("Enter a preset name", "اكتب اسماً للمجموعة"), Toasts.Type.FAILURE);
            return;
        }
        createPreset({ name: name.trim(), guildId, userIds: selectedUserIds });
        setName("");
        showToast(text("Preset saved", "تم حفظ المجموعة"), Toasts.Type.SUCCESS);
    }

    function handleApply(preset: { userIds: string[]; name: string; }) {
        // Dispatch a synthetic event so external listeners (modal/Voice panel) can react.
        window.dispatchEvent(new CustomEvent("vc-yvu-preset-apply", { detail: { userIds: preset.userIds, name: preset.name } }));
        showToast(`${text("Preset loaded", "تم تحميل المجموعة")}: ${preset.name}`, Toasts.Type.SUCCESS);
    }

    return <div className="vc-yvu-tab vc-yvu-presets-tab">
        <div className="vc-yvu-card">
            <h3>{text("Save current selection as preset", "احفظ التحديد الحالي كمجموعة")}</h3>
            <div className="vc-yvu-muted">{text("Quickly recall any group of members later.", "تقدر تستعيد المجموعة بسرعة أي وقت.")}</div>
            <div className="vc-yvu-toolbar">
                <input
                    className="vc-yvu-input"
                    placeholder={text("Preset name", "اسم المجموعة")}
                    value={name}
                    onChange={event => setName(event.currentTarget.value)}
                    onKeyDown={event => { if (event.key === "Enter") handleCreate(); }}
                />
                <button onClick={handleCreate}>{text("Save preset", "حفظ المجموعة")} ({selectedUserIds.length})</button>
            </div>
        </div>

        <div className="vc-yvu-stack">
            {presets.length ? presets.map(preset => (
                <div className="vc-yvu-card vc-yvu-preset-row" key={preset.id}>
                    <div className="vc-yvu-preset-main">
                        <strong style={{ color: preset.color }}>{preset.name}</strong>
                        <span className="vc-yvu-muted">{preset.userIds.length} {text("members", "أعضاء")}</span>
                    </div>
                    <div className="vc-yvu-actions">
                        <button onClick={() => handleApply(preset)}>{text("Apply", "تطبيق")}</button>
                        <button className="vc-yvu-danger-lite" onClick={() => { removePreset(preset.id); showToast(text("Preset deleted", "تم حذف المجموعة"), Toasts.Type.SUCCESS); }}>{text("Delete", "حذف")}</button>
                    </div>
                </div>
            )) : <Empty />}
        </div>
    </div>;
}

// Public helper so other modules can show last undo and trigger it
export function getYamachUndoState() {
    return {
        canUndo: canUndo(),
        last: getLastUndoEntry(),
    };
}

export function consumeYamachUndo() {
    return popUndoEntry();
}

export { subscribeUndo };

export function MultiRoomMiniBadge({ userId }: { userId?: string; }) {
    const [, force] = React.useState(0);
    const ref = React.useRef<HTMLSpanElement>(null);
    React.useEffect(() => subscribeYamach(() => force(v => v + 1)), []);
    if (!userId) return null;
    const locations = getUserLocations(userId)
        .slice()
        .sort((a, b) => String(a.guild?.name ?? "").localeCompare(String(b.guild?.name ?? "")) || String(a.channel?.name ?? "").localeCompare(String(b.channel?.name ?? "")));
    if (locations.length <= 1) return null;

    return <Popout
        position="bottom"
        align="center"
        targetElementRef={ref}
        renderPopout={() => <div className={`vc-yvu-mini-popout vc-yvu-theme-${currentTheme}`} dir={isArabic() ? "rtl" : "ltr"} style={makeThemeStyle()}>
            <div className="vc-yvu-mini-popout-head">
                <UserAvatar userId={userId} size={38} />
                <div className="vc-yvu-mini-popout-title">
                    <strong>{bidi(userName(userId))}</strong>
                    <span>{text("Multiple voice locations", "موجود بأكثر من روم صوتي")}</span>
                </div>
                <em>{locations.length}</em>
            </div>
            <div className="vc-yvu-mini-popout-hint">
                {text("Scroll to view every room, server, status, and visible companions.", "حرّك السكرول لعرض كل روم والسيرفر والحالة واللي معه.")}
            </div>
            <div className="vc-yvu-mini-popout-list">
                {locations.map((loc, index) => <MiniLocationCard key={loc.channelId} location={loc} index={index} />)}
            </div>
        </div>}
    >
        {popoutProps => <span
            {...popoutProps}
            ref={ref}
            role="button"
            className="vc-yvu-mini-multibadge"
            title={text("Multiple voice rooms", "أكثر من روم صوتي")}
            onClick={(e: React.MouseEvent<HTMLSpanElement>) => {
                e.preventDefault();
                e.stopPropagation();
                popoutProps.onClick?.(e);
            }}
        >{locations.length > 99 ? "99+" : locations.length}</span>}
    </Popout>;
}
