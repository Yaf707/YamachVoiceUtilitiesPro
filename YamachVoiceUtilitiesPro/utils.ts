// Made by Yamach

import { findStoreLazy } from "@webpack";
import { Alerts, GuildChannelStore, RestAPI, showToast, Toasts, UserStore } from "@webpack/common";
import type { Channel } from "@vencord/discord-types";

import { t } from "./i18n";
import { ExecutionMode, settings } from "./settings";
import { MemberPatchBody, PatchJob, VoiceChannelGroup, VoiceMember, VoiceState } from "./types";

export const VoiceStateStore = findStoreLazy("VoiceStateStore");

const sleep = (seconds: number) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

export function isVoiceLikeChannel(channel?: Channel | null) {
    return Boolean(channel && (channel.type === 2 || channel.type === 13));
}

export function getVoiceStatesForChannel(channelId: string): Record<string, VoiceState> {
    return VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
}

type VoiceChannelEntry = {
    channel: Channel;
    parentId?: string | null;
    position?: number;
};

function snowflakeOf(value: any): string | null {
    const match = String(value ?? "").match(/\d{15,25}/);
    return match?.[0] ?? null;
}

function getChannelId(value: any): string | null {
    return snowflakeOf(value?.id ?? value?.channel_id ?? value?.channelId);
}

function getChannelType(value: any): number | null {
    const raw = value?.type ?? value?.channel?.type ?? value?.channelType ?? value?.rawType;
    const numberValue = Number(raw);
    return Number.isFinite(numberValue) ? numberValue : null;
}

function getChannelName(value: any): string {
    return String(value?.name ?? value?.rawName ?? value?.displayName ?? value?.title ?? value?.channel?.name ?? "").trim();
}

function isCategoryLike(value: any) {
    return getChannelType(value) === 4;
}

function isVoiceLikeAny(value: any) {
    const type = getChannelType(value);
    return type === 2 || type === 13;
}

type CategoryFallbackInfo = {
    parentByChannel: Map<string, string>;
    nameByCategory: Map<string, string>;
    positionByCategory: Map<string, number>;
};

function getRecursiveCategoryFallback(guildId: string): CategoryFallbackInfo {
    const guildChannels = GuildChannelStore.getChannels(guildId);
    const parentByChannel = new Map<string, string>();
    const nameByCategory = new Map<string, string>();
    const positionByCategory = new Map<string, number>();
    const seen = new Set<any>();
    let order = 0;

    function rememberCategory(categoryId: string, categoryName?: string | null, position?: number | null) {
        if (categoryName && !nameByCategory.has(categoryId)) nameByCategory.set(categoryId, categoryName);
        if (!positionByCategory.has(categoryId)) {
            const numericPosition = Number(position);
            positionByCategory.set(categoryId, Number.isFinite(numericPosition) ? numericPosition : order++);
        }
    }

    function walk(value: any, activeCategoryId: string | null = null, activeCategoryName: string | null = null, depth = 0, keyHint: string | null = null) {
        if (!value || depth > 9) return;
        if ((typeof value === "object" || typeof value === "function") && seen.has(value)) return;
        if (typeof value === "object" || typeof value === "function") seen.add(value);

        const storedKeyCategory = keyHint ? getStoreChannel(keyHint) as any : null;
        let categoryId = activeCategoryId;
        let categoryName = activeCategoryName;

        if (storedKeyCategory && isCategoryLike(storedKeyCategory)) {
            categoryId = keyHint;
            categoryName = getChannelName(storedKeyCategory) || categoryName;
            rememberCategory(categoryId, categoryName, channelPosition(storedKeyCategory as Channel, order));
        }

        const entryChannel = value?.channel ?? value;
        const channelId = getChannelId(entryChannel);
        const channelType = getChannelType(entryChannel);

        if (channelId && channelType === 4) {
            categoryId = channelId;
            categoryName = getChannelName(entryChannel) || categoryName;
            rememberCategory(categoryId, categoryName, channelPosition(entryChannel as Channel, order));
        } else if (channelId && (channelType === 2 || channelType === 13)) {
            const directParent = getParentId(entryChannel as Channel, value);
            const parentId = directParent ?? categoryId;
            if (parentId) {
                parentByChannel.set(channelId, parentId);
                if (categoryName) rememberCategory(parentId, categoryName, null);
            }
        } else if (channelId && categoryId && channelType !== 4) {
            parentByChannel.set(channelId, categoryId);
            if (categoryName) rememberCategory(categoryId, categoryName, null);
        }

        if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, categoryId, categoryName, depth + 1, String(index)));
            return;
        }

        if (value instanceof Map) {
            for (const [key, item] of value.entries()) walk(item, categoryId, categoryName, depth + 1, snowflakeOf(key));
            return;
        }

        if (typeof value?.values === "function" && !(value instanceof Map)) {
            try {
                for (const item of value.values()) walk(item, categoryId, categoryName, depth + 1, null);
                return;
            } catch {
                // continue to object traversal
            }
        }

        if (typeof value === "object") {
            for (const [key, item] of Object.entries(value)) {
                if (typeof item === "function") continue;
                const nextKeyHint = snowflakeOf(key);
                walk(item, categoryId, categoryName, depth + 1, nextKeyHint);
            }
        }
    }

    walk(guildChannels);
    return { parentByChannel, nameByCategory, positionByCategory };
}

function toArray(value: any): any[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return [];

    if (value instanceof Map) return Array.from(value.values());

    if (typeof value?.values === "function") {
        try {
            return Array.from(value.values());
        } catch {
            // Some Discord stores expose non-standard collection-like objects. Fall through to Object.values.
        }
    }

    if (typeof value === "object") return Object.values(value);

    return [];
}

function unwrapChannelEntry(entry: any): VoiceChannelEntry | null {
    const channel = entry?.channel ?? entry;
    if (!isVoiceLikeChannel(channel)) return null;

    return {
        channel,
        parentId: getParentId(channel, entry),
        position: Number(entry?.position ?? entry?.channel?.position ?? entry?.channel?.rawPosition ?? entry?.channel?.sortingPosition ?? 0),
    };
}

function getGuildVoiceChannelEntries(guildId: string): VoiceChannelEntry[] {
    const guildChannels = GuildChannelStore.getChannels(guildId);
    const vocalChannels = toArray(guildChannels?.VOCAL);

    return vocalChannels
        .map(unwrapChannelEntry)
        .filter(Boolean) as VoiceChannelEntry[];
}

export function getGuildVoiceChannels(guildId: string): Channel[] {
    return getGuildVoiceChannelEntries(guildId).map(entry => entry.channel);
}

function getStoreChannel(channelId?: string | null) {
    if (!channelId) return null;
    return GuildChannelStore.getChannel?.(channelId) ?? null;
}

function getParentChannelName(parentId?: string | null) {
    if (!parentId) return t("noCategory");

    const parent = getStoreChannel(parentId);
    return parent?.name ?? t("noCategory");
}

function channelPosition(channel: Channel | null | undefined, fallback = 0) {
    const anyChannel = channel as any;
    return Number(anyChannel?.position ?? anyChannel?.rawPosition ?? anyChannel?.sortingPosition ?? fallback);
}

function getValueFromKeys(source: any, keys: string[]) {
    for (const key of keys) {
        const value = source?.[key];
        if (typeof value === "string" && value) return value;
        if (value && typeof value === "object" && typeof value.id === "string") return value.id;
    }

    return null;
}

function getParentId(channel?: Channel | null, entry?: any): string | null {
    const anyChannel = channel as any;
    const stored = getStoreChannel(anyChannel?.id) as any;

    return getValueFromKeys(anyChannel, [
        "parent_id",
        "parentId",
        "parentID",
        "parentChannelId",
        "parentChannelID",
        "categoryId",
        "category_id",
        "categoryID",
        "parent",
        "category",
    ])
        ?? getValueFromKeys(stored, [
            "parent_id",
            "parentId",
            "parentID",
            "parentChannelId",
            "parentChannelID",
            "categoryId",
            "category_id",
            "categoryID",
            "parent",
            "category",
        ])
        ?? getValueFromKeys(entry, [
            "parent_id",
            "parentId",
            "parentID",
            "parentChannelId",
            "parentChannelID",
            "categoryId",
            "category_id",
            "categoryID",
            "parent",
            "category",
        ]);
}

function getCategoryFallbackMap(guildId: string) {
    const guildChannels = GuildChannelStore.getChannels(guildId);
    const map = new Map<string, string>();

    for (const group of Object.values(guildChannels ?? {}) as any[]) {
        for (const entry of toArray(group)) {
            const channel = entry?.channel ?? entry;
            const parentId = getParentId(channel, entry);
            if (channel?.id && parentId) map.set(channel.id, parentId);

            const children = entry?.channels ?? entry?.children ?? entry?.voiceChannels ?? channel?.channels ?? channel?.children;
            for (const childEntry of toArray(children)) {
                const child = childEntry?.channel ?? childEntry;
                if (child?.id && channel?.id) map.set(child.id, channel.id);
            }
        }
    }

    return map;
}

function cleanDomChannelText(value?: string | null) {
    return (value ?? "")
        .replace(/\s+/g, " ")
        .replace(/,\s*$/, "")
        .trim();
}

function getDomCategoryFallback(guildId: string, voiceChannels: Channel[]) {
    const voiceIds = new Set(voiceChannels.map(channel => channel.id));
    const parentByChannel = new Map<string, string>();
    const nameByCategory = new Map<string, string>();
    const positionByCategory = new Map<string, number>();

    if (typeof document === "undefined") return { parentByChannel, nameByCategory, positionByCategory };

    let currentCategoryId: string | null = null;
    let currentCategoryName: string | null = null;
    let order = 0;

    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-list-item-id^="channels___"]'));

    for (const row of rows) {
        const id = row.getAttribute("data-list-item-id")?.match(/\d{15,25}/)?.[0];
        if (!id) continue;

        const rawText = cleanDomChannelText(row.innerText || row.textContent);
        const text = rawText.replace(/\b(Invite to Channel|Edit Channel|Open Chat|Set a channel status)\b/gi, "").replace(/\s+/g, " ").trim();
        const looksLikeCategory = !voiceIds.has(id) && (
            row.matches('[class*="mainContent__"], [class*="mainContent_"]')
            || Boolean(row.querySelector('[class*="mainContent__"], [class*="mainContent_"]'))
        );

        if (looksLikeCategory && text) {
            currentCategoryId = id;
            currentCategoryName = text;
            if (!nameByCategory.has(id)) nameByCategory.set(id, text);
            if (!positionByCategory.has(id)) positionByCategory.set(id, order++);
            continue;
        }

        if (voiceIds.has(id) && currentCategoryId && currentCategoryName) {
            parentByChannel.set(id, currentCategoryId);
            nameByCategory.set(currentCategoryId, currentCategoryName);
            if (!positionByCategory.has(currentCategoryId)) positionByCategory.set(currentCategoryId, order++);
        }
    }

    return { parentByChannel, nameByCategory, positionByCategory };
}

export function getGuildVoiceChannelGroups(guildId: string): VoiceChannelGroup[] {
    const voiceEntries = getGuildVoiceChannelEntries(guildId);
    const voiceChannels = voiceEntries.map(entry => entry.channel);
    const fallbackParents = getCategoryFallbackMap(guildId);
    const recursiveFallback = getRecursiveCategoryFallback(guildId);
    const domFallback = getDomCategoryFallback(guildId, voiceChannels);
    const groups = new Map<string, VoiceChannelGroup & { position: number; }>();

    for (const entry of voiceEntries) {
        const channel = entry.channel;
        const parentId = entry.parentId
            ?? fallbackParents.get(channel.id)
            ?? recursiveFallback.parentByChannel.get(channel.id)
            ?? domFallback.parentByChannel.get(channel.id)
            ?? null;
        const groupId = parentId ?? "__no_category__";
        const parent = parentId ? getStoreChannel(parentId) : null;
        const storeName = parentId ? recursiveFallback.nameByCategory.get(parentId) : null;
        const domName = parentId ? domFallback.nameByCategory.get(parentId) : null;
        const groupName = parent?.name ?? storeName ?? domName ?? getParentChannelName(parentId);
        const parentPosition = parent
            ? channelPosition(parent as Channel, Number.MAX_SAFE_INTEGER)
            : parentId
                ? recursiveFallback.positionByCategory.get(parentId) ?? domFallback.positionByCategory.get(parentId) ?? Number.MAX_SAFE_INTEGER - 1
                : Number.MAX_SAFE_INTEGER;

        if (!groups.has(groupId)) {
            groups.set(groupId, {
                id: groupId,
                name: groupName,
                channels: [],
                position: parentPosition,
            });
        }

        groups.get(groupId)!.channels.push(channel);
    }

    return Array.from(groups.values())
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map(group => ({
            id: group.id,
            name: group.name,
            channels: group.channels.sort((a, b) => channelPosition(a) - channelPosition(b) || a.name.localeCompare(b.name)),
        }));
}

export function getUserLabel(userId: string) {
    const user = UserStore.getUser(userId);
    return user?.globalName || user?.username || user?.tag || userId;
}

export function getAllVoiceMembers(guildId: string): VoiceMember[] {
    const seen = new Set<string>();
    const myId = UserStore.getCurrentUser()?.id;

    return getGuildVoiceChannels(guildId).flatMap(channel => {
        const voiceStates = Object.entries(getVoiceStatesForChannel(channel.id));

        return voiceStates.flatMap(([fallbackUserId, voiceState]) => {
            const userId = voiceState?.userId ?? fallbackUserId;
            if (!userId || seen.has(userId)) return [];

            seen.add(userId);
            const user = UserStore.getUser(userId);

            return [{
                userId,
                label: getUserLabel(userId),
                channelId: channel.id,
                channelName: channel.name,
                isSelf: userId === myId,
                isBot: Boolean(user?.bot),
                muted: Boolean(voiceState?.mute || voiceState?.selfMute),
                deafened: Boolean(voiceState?.deaf || voiceState?.selfDeaf),
                inVoice: true,
            }];
        });
    }).sort((a, b) => a.channelName.localeCompare(b.channelName) || a.label.localeCompare(b.label));
}


export function getCurrentUserVoiceChannel(guildId: string): Channel | null {
    const myId = UserStore.getCurrentUser()?.id;
    if (!myId) return null;

    const directState = VoiceStateStore.getVoiceState?.(guildId, myId);
    const directChannelId = directState?.channelId ?? directState?.channel_id;
    if (directChannelId) {
        return getGuildVoiceChannels(guildId).find(channel => channel.id === directChannelId) ?? null;
    }

    const selfMember = getAllVoiceMembers(guildId).find(member => member.isSelf);
    if (!selfMember?.channelId) return null;

    return getGuildVoiceChannels(guildId).find(channel => channel.id === selfMember.channelId) ?? null;
}

export function getSelectedVoiceMembers(guildId: string, selectedUserIds: string[]) {
    const selected = new Set(selectedUserIds);
    return getAllVoiceMembers(guildId).filter(member => selected.has(member.userId));
}

export function getChannelUserIds(channel: Channel, includeSelf = settings.store.includeSelfByDefault, includeBots = settings.store.includeBotsByDefault) {
    const myId = UserStore.getCurrentUser()?.id;

    return Object.entries(getVoiceStatesForChannel(channel.id))
        .map(([fallbackUserId, voiceState]) => voiceState?.userId ?? fallbackUserId)
        .filter(Boolean)
        .filter(userId => includeSelf || userId !== myId)
        .filter(userId => {
            if (includeBots) return true;
            return !UserStore.getUser(userId)?.bot;
        });
}

function getRetryAfterSeconds(error: any): number | null {
    const body = error?.body ?? error?.response?.body ?? error;
    const headers = error?.headers ?? error?.response?.headers ?? {};
    const retryAfter = body?.retry_after
        ?? headers?.["retry-after"]
        ?? headers?.["Retry-After"]
        ?? headers?.["x-ratelimit-reset-after"]
        ?? null;
    if (retryAfter == null) return null;
    const seconds = Number(retryAfter);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function isRateLimitError(error: any): boolean {
    const status = error?.status ?? error?.response?.status;
    return status === 429 || getRetryAfterSeconds(error) != null;
}

function getMaxRetryAttempts() {
    return Math.max(0, Number(settings.store.maxRetries ?? 3)) + 1;
}

export async function runSequential<T>(tasks: Array<() => Promise<T>>) {
    const results: T[] = new Array(tasks.length);
    const failures: Array<{ index: number; error: unknown; }> = [];

    const requestedBatch = Math.max(1, Number(settings.store.waitAfter ?? 25));
    const waitSeconds = Number(settings.store.waitSeconds ?? 0);
    const perActionDelay = Number(settings.store.delayBetweenActionsMs ?? 0);
    const mode = settings.store.executionMode ?? ExecutionMode.FastBatched;
    const fastBatched = mode === ExecutionMode.FastBatched;

    // Worker-pool concurrent execution with adaptive 429 backoff.
    // Fast: respects requestedBatch, optional wait between pool runs.
    // Safe: serial with explicit per-action delay.
    const concurrency = fastBatched
        ? Math.max(1, Math.min(requestedBatch, 50))
        : 1;

    let nextIndex = 0;
    let globalCooldownUntil = 0;

    async function waitForCooldown() {
        const remaining = globalCooldownUntil - Date.now();
        if (remaining > 0) await sleep(remaining / 1000);
    }

    const maxAttempts = getMaxRetryAttempts();

    async function runOne(index: number) {
        let attempt = 0;
        while (attempt < maxAttempts) {
            await waitForCooldown();
            try {
                results[index] = await tasks[index]();
                return;
            } catch (error: any) {
                if (isRateLimitError(error) && attempt < maxAttempts - 1) {
                    const retryAfter = getRetryAfterSeconds(error) ?? Math.min(5, 0.5 * Math.pow(2, attempt));
                    const waitMs = Math.max(250, retryAfter * 1000);
                    globalCooldownUntil = Math.max(globalCooldownUntil, Date.now() + waitMs);
                    attempt++;
                    continue;
                }
                failures.push({ index, error });
                return;
            }
        }
    }

    async function worker() {
        while (true) {
            const index = nextIndex++;
            if (index >= tasks.length) return;
            await runOne(index);

            if (!fastBatched) {
                if (perActionDelay > 0 && nextIndex < tasks.length) await sleep(perActionDelay / 1000);
                if (waitSeconds > 0 && nextIndex % requestedBatch === 0 && nextIndex < tasks.length) await sleep(waitSeconds);
            } else if (waitSeconds > 0 && nextIndex % Math.max(requestedBatch, concurrency) === 0 && nextIndex < tasks.length) {
                await sleep(waitSeconds);
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const cleanResults = results.filter((_, i) => !failures.some(failure => failure.index === i));
    return { results: cleanResults, failures };
}

export async function executePatchJobs(guildId: string, jobs: PatchJob[], actionLabel: string) {
    if (!jobs.length) {
        showToast(t("noSelectionToast"), Toasts.Type.FAILURE);
        return false;
    }

    const startedAt = performance.now();
    showToast(`${t("runningToast")} ${actionLabel} (${jobs.length})...`, Toasts.Type.MESSAGE);

    const tasks = jobs.map(job => () => RestAPI.patch({
        url: `/guilds/${guildId}/members/${job.userId}`,
        body: job.body,
    }));

    const { failures } = await runSequential(tasks);
    const successCount = jobs.length - failures.length;
    const elapsed = ((performance.now() - startedAt) / 1000).toFixed(1);

    if (failures.length) {
        console.error("YamachVoiceUtilitiesPro failed requests", failures);
        showToast(`${t("failedToast")} ${successCount}/${jobs.length} · ${elapsed}s`, Toasts.Type.FAILURE);
        return false;
    }

    showToast(`${t("successToast")} ${actionLabel} (${successCount}) · ${elapsed}s`, Toasts.Type.SUCCESS);
    return true;
}

export function confirmAction(actionLabel: string, count: number, onConfirm: () => void) {
    if (!settings.store.confirmActions) {
        onConfirm();
        return;
    }

    Alerts.show({
        title: t("confirmTitle"),
        body: `${actionLabel} (${count})?`,
        confirmText: t("confirmButton"),
        cancelText: t("close"),
        onConfirm,
    });
}

export function buildPatchJobs(userIds: string[], bodyFactory: (userId: string, index: number) => MemberPatchBody): PatchJob[] {
    return userIds.map((userId, index) => ({
        userId,
        body: bodyFactory(userId, index),
    }));
}

export function runBulkChannelAction(channel: Channel, body: MemberPatchBody, actionLabel: string) {
    const userIds = getChannelUserIds(channel, settings.store.includeSelfByDefault, settings.store.includeBotsByDefault);

    confirmAction(actionLabel, userIds.length, () => {
        executePatchJobs(channel.guild_id, buildPatchJobs(userIds, () => body), actionLabel);
    });
}
