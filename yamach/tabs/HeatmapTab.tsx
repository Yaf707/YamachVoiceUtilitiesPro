// Made by Yamach - Voice activity heatmap (day of week × hour of day)

import { React } from "@webpack/common";

import { hourLabels, isArabic, text, weekdayLabels } from "../helpers";
import type { VoiceLog } from "../yamachTypes";

type HeatmapMatrix = number[][]; // [day 0-6][hour 0-23]
type HeatmapData = {
    matrix: HeatmapMatrix;
    max: number;
    total: number;
    peakDay: number;
    peakHour: number;
};

const HEATMAP_RELEVANT_TYPES: ReadonlyArray<VoiceLog["type"]> = [
    "join",
    "move",
    "stream_on",
    "video_on",
    "companion_join",
];

function buildMatrix(logs: readonly VoiceLog[], userId?: string, days = 0): HeatmapData {
    const matrix: HeatmapMatrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let total = 0;
    let max = 0;
    let peakDay = 0;
    let peakHour = 0;

    const cutoff = days > 0 ? Date.now() - days * 86400_000 : 0;

    for (const log of logs) {
        if (userId && log.userId !== userId) continue;
        if (cutoff && log.timestamp < cutoff) continue;
        if (!HEATMAP_RELEVANT_TYPES.includes(log.type)) continue;

        const date = new Date(log.timestamp);
        const day = date.getDay();
        const hour = date.getHours();
        matrix[day][hour]++;
        total++;
        if (matrix[day][hour] > max) {
            max = matrix[day][hour];
            peakDay = day;
            peakHour = hour;
        }
    }

    return { matrix, max, total, peakDay, peakHour };
}

function intensityColor(value: number, max: number) {
    if (!value || !max) return "transparent";
    const ratio = Math.min(1, value / max);
    const alpha = 0.15 + ratio * 0.75;
    return `color-mix(in srgb, var(--yvu-accent, #f0b232) ${Math.round(alpha * 100)}%, transparent)`;
}

export function HeatmapTab({ logs, focusUserId }: { logs: readonly VoiceLog[]; focusUserId?: string; }) {
    const [range, setRange] = React.useState<number>(30);
    const [userOnly, setUserOnly] = React.useState<boolean>(Boolean(focusUserId));

    const data = React.useMemo(
        () => buildMatrix(logs, userOnly ? focusUserId : undefined, range),
        [logs, range, userOnly, focusUserId]
    );

    const days = weekdayLabels();
    const hours = hourLabels();
    const peakLabel = data.total
        ? `${days[data.peakDay]} · ${hours[data.peakHour]}`
        : text("No activity yet", "لا يوجد نشاط بعد");

    return <div className="vc-yvu-tab vc-yvu-heatmap-tab">
        <div className="vc-yvu-card vc-yvu-heatmap-card">
            <div className="vc-yvu-heatmap-head">
                <div>
                    <h3>{text("Voice Activity Heatmap", "خريطة النشاط الصوتي")}</h3>
                    <p className="vc-yvu-muted">{text("Activity intensity by day of week and hour of day.", "كثافة النشاط حسب يوم الأسبوع وساعة اليوم.")}</p>
                </div>
                <div className="vc-yvu-heatmap-kpis">
                    <div><strong>{data.total}</strong><span>{text("Events", "الأحداث")}</span></div>
                    <div><strong>{data.max}</strong><span>{text("Peak / hour", "ذروة الساعة")}</span></div>
                    <div><strong dir="auto">{peakLabel}</strong><span>{text("Peak time", "وقت الذروة")}</span></div>
                </div>
            </div>

            <div className="vc-yvu-heatmap-toolbar">
                {focusUserId ? (
                    <label className="vc-yvu-switch">
                        <input type="checkbox" checked={userOnly} onChange={() => setUserOnly(value => !value)} />
                        <span>{text("Show this user only", "هذا الشخص فقط")}</span>
                    </label>
                ) : null}
                {[7, 14, 30, 60, 90, 0].map(value => (
                    <button
                        key={value}
                        className={range === value ? "vc-yvu-active" : ""}
                        onClick={() => setRange(value)}
                    >
                        {value === 0 ? text("All time", "كل الوقت") : `${value}d`}
                    </button>
                ))}
            </div>

            <div className="vc-yvu-heatmap-grid" dir="ltr" style={{ direction: "ltr" }}>
                <div className="vc-yvu-heatmap-corner" />
                {hours.map((label, hour) => (
                    <div key={`hour-${hour}`} className="vc-yvu-heatmap-hour-label" title={label}>
                        {hour % 3 === 0 ? label : ""}
                    </div>
                ))}
                {days.map((day, dayIndex) => (
                    <React.Fragment key={day}>
                        <div className="vc-yvu-heatmap-day-label">{day}</div>
                        {hours.map((_, hour) => {
                            const value = data.matrix[dayIndex][hour];
                            return <div
                                key={`${dayIndex}-${hour}`}
                                className={`vc-yvu-heatmap-cell ${value === data.max && data.max > 0 ? "vc-yvu-heatmap-peak" : ""}`}
                                style={{ background: intensityColor(value, data.max) }}
                                title={`${day} · ${hours[hour]}\n${value} ${isArabic() ? "حدث" : "events"}`}
                            >
                                {value > 0 ? <span className="vc-yvu-heatmap-value">{value}</span> : null}
                            </div>;
                        })}
                    </React.Fragment>
                ))}
            </div>

            <div className="vc-yvu-heatmap-legend">
                <span className="vc-yvu-muted">{text("Less", "أقل")}</span>
                <span className="vc-yvu-heatmap-legend-cell" style={{ background: intensityColor(1, 4) }} />
                <span className="vc-yvu-heatmap-legend-cell" style={{ background: intensityColor(2, 4) }} />
                <span className="vc-yvu-heatmap-legend-cell" style={{ background: intensityColor(3, 4) }} />
                <span className="vc-yvu-heatmap-legend-cell" style={{ background: intensityColor(4, 4) }} />
                <span className="vc-yvu-muted">{text("More", "أكثر")}</span>
            </div>
        </div>
    </div>;
}
