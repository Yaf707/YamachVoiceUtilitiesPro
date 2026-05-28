// Made by Yamach - Shared types for the Yamach Command Center

import type { VoiceState } from "@vencord/discord-types";

export type RawVoiceState = VoiceState & {
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

export type VoiceStatus = {
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

export type Location = {
    userId: string;
    channelId: string;
    guildId: string | null;
    channel: any;
    guild: any;
    state: RawVoiceState;
    status: VoiceStatus;
    companions: Person[];
};

export type Person = {
    id: string;
    name: string;
    avatar?: string;
    status?: VoiceStatus;
};

export type TrackedUser = {
    userId: string;
    name: string;
    addedAt: number;
    favorite?: boolean;
    alerts?: boolean;
    tag?: string;
    color?: string;
};

export type ThemeName =
    | "yamach"
    | "native"
    | "midnight"
    | "neon"
    | "emerald"
    | "crimson"
    | "royal"
    | "minimal"
    | "ocean"
    | "sunset"
    | "cyber"
    | "sakura"
    | "amber"
    | "ice"
    | "matrix"
    | "obsidian"
    | "steel"
    | "lavender"
    | "gold"
    | "ruby"
    | "custom";

export type CustomTheme = {
    accent: string;
    accent2: string;
    surface: string;
    surface2: string;
    radius: number;
    glow: boolean;
    density: "comfortable" | "compact";
};

export type PersistedData = {
    trackedUsers?: Record<string, TrackedUser>;
    trackedGuildId?: string | null;
    trackedRooms?: Record<string, boolean>;
    pinned?: Record<string, boolean>;
    theme?: ThemeName;
    customTheme?: CustomTheme;
    alertsEnabled?: boolean;
    cooldownMs?: number;
};

export type LogType =
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

export type VoiceLog = {
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

export type SessionCard = {
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

export type StoredState = {
    userId: string;
    channelId?: string | null;
    guildId?: string | null;
    status: VoiceStatus;
};

export type YamachTab =
    | "live"
    | "watch"
    | "logs"
    | "reports"
    | "heatmap"
    | "stats"
    | "alerts"
    | "data"
    | "theme";
