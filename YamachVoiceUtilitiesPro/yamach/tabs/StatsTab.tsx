// Made by Yamach - Per-user statistics dashboard

import { React } from "@webpack/common";

import { displayUserName, formatDuration, text } from "../helpers";
import type { SessionCard, VoiceLog } from "../yamachTypes";

type UserStats = {
    userId: string;
    name: string;
    totalDurationMs: number;
    sessions: number;
    rooms: Set<string>;
    streams: number;
    cameras: number;
    serverMutes: number;
    companions: Set<string>;
    firstSeen: number;
    lastSeen: number;
};

function aggregate(logs: readonly VoiceLog[], sessions: readonly SessionCard[]) {
    const byUser = new Map<string, UserStats>();

    function getOrCreate(userId: string, name: string): UserStats {
        let stats = byUser.get(userId);
        if (!stats) {
            stats = {
                userId,
                name,
                totalDurationMs: 0,
                sessions: 0,
                rooms: new Set(),
                streams: 0,
                cameras: 0,
                serverMutes: 0,
                companions: new Set(),
                firstSeen: Number.POSITIVE_INFINITY,
                lastSeen: 0,
            };
            byUser.set(userId, stats);
        }
        return stats;
    }

    for (const session of sessions) {
        const stats = getOrCreate(session.userId, session.userName);
        stats.totalDurationMs += session.durationMs;
        stats.sessions += 1;
        if (session.channelId) stats.rooms.add(session.channelId);
        for (const companion of session.companions) stats.companions.add(companion.id);
        if (session.startedAt < stats.firstSeen) stats.firstSeen = session.startedAt;
        if ((session.endedAt ?? session.startedAt) > stats.lastSeen) stats.lastSeen = session.endedAt ?? session.startedAt;
    }

    for (const log of logs) {
        const stats = getOrCreate(log.userId, log.userName);
        if (log.type === "stream_on") stats.streams += 1;
        if (log.type === "video_on") stats.cameras += 1;
        if (log.type === "server_mute_on") stats.serverMutes += 1;
    }

    return [...byUser.values()].sort((a, b) => b.totalDurationMs - a.totalDurationMs);
}

function GlobalKpis({ stats }: { stats: UserStats[]; }) {
    const totals = React.useMemo(() => {
        const total = stats.reduce((acc, s) => acc + s.totalDurationMs, 0);
        const sessions = stats.reduce((acc, s) => acc + s.sessions, 0);
        const streams = stats.reduce((acc, s) => acc + s.streams, 0);
        return { total, sessions, streams, users: stats.length };
    }, [stats]);

    return <div className="vc-yvu-kpis">
        <div className="vc-yvu-kpi"><strong>{totals.users}</strong><span>{text("Users", "الأشخاص")}</span></div>
        <div className="vc-yvu-kpi"><strong>{totals.sessions}</strong><span>{text("Sessions", "الجلسات")}</span></div>
        <div className="vc-yvu-kpi"><strong dir="auto">{formatDuration(totals.total)}</strong><span>{text("Total voice time", "إجمالي الفويس")}</span></div>
        <div className="vc-yvu-kpi"><strong>{totals.streams}</strong><span>{text("Streams", "الستريمات")}</span></div>
    </div>;
}

function StatBar({ value, max, color = "var(--yvu-accent, #f0b232)" }: { value: number; max: number; color?: string; }) {
    const width = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
    return <div className="vc-yvu-stat-bar">
        <div className="vc-yvu-stat-bar-fill" style={{ width: `${width}%`, background: color }} />
    </div>;
}

export function StatsTab({ logs, sessions, focusUserId, onSelectUser }: {
    logs: readonly VoiceLog[];
    sessions: readonly SessionCard[];
    focusUserId?: string;
    onSelectUser?: (userId: string) => void;
}) {
    const [query, setQuery] = React.useState("");
    const [sort, setSort] = React.useState<"time" | "sessions" | "streams" | "companions">("time");

    const stats = React.useMemo(() => aggregate(logs, sessions), [logs, sessions]);
    const maxTime = stats[0]?.totalDurationMs ?? 0;
    const lower = query.trim().toLowerCase();

    const filtered = stats.filter(stat => {
        if (focusUserId && stat.userId !== focusUserId) return false;
        if (!lower) return true;
        return stat.name.toLowerCase().includes(lower) || stat.userId.includes(lower);
    }).sort((a, b) => {
        if (sort === "sessions") return b.sessions - a.sessions;
        if (sort === "streams") return b.streams - a.streams;
        if (sort === "companions") return b.companions.size - a.companions.size;
        return b.totalDurationMs - a.totalDurationMs;
    });

    return <div className="vc-yvu-tab vc-yvu-stats-tab">
        <GlobalKpis stats={stats} />

        <div className="vc-yvu-toolbar">
            <input
                className="vc-yvu-input"
                placeholder={text("Search by name or ID", "بحث بالاسم أو الآيدي")}
                value={query}
                onChange={event => setQuery(event.currentTarget.value)}
            />
            {(["time", "sessions", "streams", "companions"] as const).map(item => (
                <button
                    key={item}
                    className={sort === item ? "vc-yvu-active" : ""}
                    onClick={() => setSort(item)}
                >
                    {text(
                        item === "time" ? "Time" : item === "sessions" ? "Sessions" : item === "streams" ? "Streams" : "Companions",
                        item === "time" ? "الوقت" : item === "sessions" ? "الجلسات" : item === "streams" ? "ستريم" : "المرافقين"
                    )}
                </button>
            ))}
        </div>

        <div className="vc-yvu-stats-list">
            {filtered.length ? filtered.map(stat => (
                <div
                    className="vc-yvu-card vc-yvu-stat-row"
                    key={stat.userId}
                    onClick={() => onSelectUser?.(stat.userId)}
                    role={onSelectUser ? "button" : undefined}
                >
                    <div className="vc-yvu-stat-row-head">
                        <div className="vc-yvu-stat-row-name">
                            <strong dir="auto">{displayUserName(stat.userId) || stat.name}</strong>
                            <span className="vc-yvu-muted vc-yvu-stat-row-id" dir="ltr">{stat.userId}</span>
                        </div>
                        <div className="vc-yvu-stat-row-time" dir="auto">{formatDuration(stat.totalDurationMs)}</div>
                    </div>
                    <StatBar value={stat.totalDurationMs} max={maxTime} />
                    <div className="vc-yvu-stat-row-meta">
                        <span>{stat.sessions} {text("sessions", "جلسات")}</span>
                        <span>·</span>
                        <span>{stat.rooms.size} {text("rooms", "رومات")}</span>
                        <span>·</span>
                        <span>{stat.companions.size} {text("companions", "مرافقين")}</span>
                        <span>·</span>
                        <span>{stat.streams} 📺</span>
                        <span>·</span>
                        <span>{stat.cameras} 🎥</span>
                        <span>·</span>
                        <span>{stat.serverMutes} 🔇</span>
                    </div>
                </div>
            )) : (
                <div className="vc-yvu-empty">{text("No stats yet. Track users or capture logs to populate.", "لا توجد إحصائيات. تتبع أشخاصاً أو سجل لوقات لتظهر البيانات.")}</div>
            )}
        </div>
    </div>;
}
