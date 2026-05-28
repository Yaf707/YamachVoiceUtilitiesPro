// Made by Yamach - Shared helpers for Yamach Command Center

import { React, UserStore } from "@webpack/common";

import { settings, UiLanguage } from "../settings";
import type { Person, VoiceStatus } from "./yamachTypes";

export function getLang() {
    return settings.store.language === "ar" ? "ar" : "en";
}

export function isArabic() {
    return getLang() === "ar";
}

export function text(en: string, ar: string) {
    return isArabic() ? ar : en;
}

export function isolateText(value: string | number) {
    return `⁨${value}⁩`;
}

export function pad2(value: number) {
    return String(value).padStart(2, "0");
}

export function formatTime(timestamp: number) {
    const date = new Date(timestamp);
    const rawHour = date.getHours();
    const suffix = rawHour >= 12 ? "PM" : "AM";
    const hour12 = rawHour % 12 || 12;
    const value = `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} - ${pad2(hour12)}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${suffix}`;
    return isolateText(value);
}

export function formatDuration(ms: number) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const value = h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
    return isolateText(value);
}

export function formatDay(timestamp: number) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function bidi(value: React.ReactNode, className = "") {
    return React.createElement("bdi", { className, dir: "auto" }, value);
}

export function avatarUrl(userId: string, guildId?: string | null, size = 40) {
    const user = UserStore.getUser(userId) as any;
    return user?.getAvatarURL?.(guildId ?? undefined, size)
        ?? user?.getAvatarURL?.(undefined, size)
        ?? user?.avatarURL
        ?? "";
}

export function person(userId: string, guildId?: string | null, status?: VoiceStatus): Person {
    const user = UserStore.getUser(userId) as any;
    return {
        id: userId,
        name: user?.globalName ?? user?.displayName ?? user?.username ?? userId,
        avatar: avatarUrl(userId, guildId),
        status,
    };
}

export function userName(userId: string) {
    return person(userId).name;
}

export function isSnowflake(value?: string | null) {
    return Boolean(value && /^\d{15,25}$/.test(value));
}

export function maskName(name: string) {
    if (!settings.store.privacyMode || !name) return name;
    const trimmed = String(name).trim();
    if (trimmed.length <= 2) return "**";
    return `${trimmed[0]}${"*".repeat(Math.max(2, trimmed.length - 2))}${trimmed[trimmed.length - 1]}`;
}

export function displayUserName(userId: string) {
    return maskName(userName(userId));
}

export function weekdayLabels() {
    return isArabic()
        ? ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
        : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
}

export function hourLabels() {
    const hours: string[] = [];
    for (let h = 0; h < 24; h++) {
        hours.push(h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);
    }
    return hours;
}
