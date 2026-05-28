// Made by Yamach

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { openModal } from "@utils/modal";
import definePlugin from "@utils/types";
import { findStoreLazy } from "@webpack";
import type { Channel } from "@vencord/discord-types";
import { Menu, React, showToast, Toasts, UserStore } from "@webpack/common";

import { VoiceControlModal } from "./components/VoiceControlModal";
import { popUndoEntry, pushUndoEntry } from "./core/undoStack";
import { isTracked, MultiRoomMiniBadge, setTrackedGuild, setYamachPending, toggleTrackedRoom, trackUser, untrackUser, yamachHandleVoiceStateUpdates, yamachStart, yamachStop } from "./yamach/YamachCommandCenter";
import { t } from "./i18n";
import { addUsersToSelection, clearSelection, getPreviousRoom, getSelectionCount, getSelectionSnapshot, hasSelectedUser, rememberPreviousRooms, removeUsersFromSelection, toggleUserSelection } from "./selection";
import { ChannelPullButtonPosition, DefaultPanelScope, QuickButtonAccent, QuickButtonIconSet, QuickButtonPosition, QuickButtonSelectedStyle, QuickButtonSize, QuickButtonStyle, QuickButtonVisibility, settings, TopPanelButtonStyle, VisualStyle } from "./settings";
import { startShortcuts, stopShortcuts } from "./shortcuts";
import { MemberPatchBody, ScopeMode } from "./types";
import { confirmAction, executePatchJobs, getAllVoiceMembers, getChannelUserIds, getCurrentUserVoiceChannel, getGuildVoiceChannels, getSelectedVoiceMembers, isVoiceLikeChannel, runBulkChannelAction } from "./utils";

import "./styles.css";

function getDefaultScope(): ScopeMode {
    return settings.store.defaultPanelScope === DefaultPanelScope.Current ? "current" : "all";
}

const SelectedGuildStore = findStoreLazy("SelectedGuildStore");
const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const IndexChannelStore = findStoreLazy("ChannelStore");
const GuildMemberStore = findStoreLazy("GuildMemberStore");

type DomVoiceRow = HTMLElement & { dataset: DOMStringMap; };

let voiceButtonObserver: MutationObserver | null = null;
let voiceButtonRenderTimer: ReturnType<typeof setTimeout> | null = null;
let lastVoiceButtonRenderAt = 0;
const VOICE_BUTTON_RENDER_DELAY_MS = 160;

let topPanelButtonObserver: MutationObserver | null = null;
let topPanelButtonRenderTimer: ReturnType<typeof setTimeout> | null = null;
const TOP_PANEL_BUTTON_RENDER_DELAY_MS = 120;

let voiceButtonSafetyTimer: ReturnType<typeof setInterval> | null = null;
let lastDomGuildId: string | null = null;
let lastChannelsElement: Element | null = null;
let lastLocationKey = "";

function isVoiceMemoryNode(node: Node) {
    return node instanceof HTMLElement && Boolean(node.closest?.(".vc-vcu-dom-memory-btn, .vc-vcu-self-pull-btn, .vc-vcu-channel-pull-btn"));
}

function shouldIgnoreVoiceButtonMutations(mutations: MutationRecord[]) {
    return mutations.length > 0 && mutations.every(mutation => {
        if (isVoiceMemoryNode(mutation.target)) return true;

        const added = Array.from(mutation.addedNodes);
        const removed = Array.from(mutation.removedNodes);
        const changedNodes = [...added, ...removed];

        return changedNodes.length > 0 && changedNodes.every(node => {
            if (!(node instanceof HTMLElement)) return true;
            return node.classList.contains("vc-vcu-dom-memory-btn") || node.classList.contains("vc-vcu-self-pull-btn") || node.classList.contains("vc-vcu-channel-pull-btn") || Boolean(node.closest?.(".vc-vcu-dom-memory-btn, .vc-vcu-self-pull-btn, .vc-vcu-channel-pull-btn"));
        });
    });
}

function normalizeDomText(value?: string | null) {
    return (value ?? "")
        .normalize("NFKC")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
}

function getMemberNameCandidates(guildId: string, userId: string) {
    const user = UserStore.getUser(userId);
    const member = GuildMemberStore?.getMember?.(guildId, userId);

    return [
        member?.nick,
        member?.displayName,
        member?.globalName,
        user?.globalName,
        user?.displayName,
        user?.username,
        user?.tag,
    ]
        .filter(Boolean)
        .map(String)
        .map(name => name.trim())
        .filter((name, index, names) => name.length > 0 && names.indexOf(name) === index);
}

function getLikelyVoiceRows() {
    return Array.from(document.querySelectorAll<HTMLElement>('[class*="voiceUser__"], [class*="voiceUser_"]'))
        .filter(row => {
            if (row.classList.contains("vc-vcu-dom-memory-row")) return true;
            if (row.closest(".vc-vcu-root")) return false;

            const rect = row.getBoundingClientRect();
            const text = normalizeDomText(row.innerText || row.textContent);

            return rect.width >= 160 && rect.height >= 20 && rect.height <= 64 && text.length >= 2;
        }) as DomVoiceRow[];
}

function getVoiceRowChannelContainer(row: HTMLElement) {
    return row.closest<HTMLElement>('li[class*="containerDefault"], [class*="containerDefault_"]');
}

function getVoiceRowContent(row: HTMLElement) {
    return row.querySelector<HTMLElement>(':scope > [class*="content__"], :scope > [class*="content_"]');
}

function getVoiceRowIcons(content: HTMLElement | null) {
    return content?.querySelector<HTMLElement>(':scope > [class*="icons__"], :scope > [class*="icons_"]') ?? null;
}

function resolveVoiceRowUserId(row: HTMLElement, guildId: string) {
    const cached = row.dataset.vcVcuUserId;
    if (cached) return cached;

    const rowText = normalizeDomText(row.innerText || row.textContent);
    const channelContainerText = normalizeDomText(getVoiceRowChannelContainer(row)?.innerText || getVoiceRowChannelContainer(row)?.textContent);
    const members = getAllVoiceMembers(guildId);

    const scored = members.flatMap(member => {
        const names = getMemberNameCandidates(guildId, member.userId);
        const bestName = names
            .map(name => ({ raw: name, normalized: normalizeDomText(name) }))
            .filter(({ normalized }) => normalized.length >= 2 && rowText.includes(normalized))
            .sort((a, b) => b.normalized.length - a.normalized.length)[0];

        if (!bestName) return [];

        const channelName = normalizeDomText(member.channelName);
        const sameChannel = Boolean(channelName && channelContainerText.includes(channelName));

        return [{
            userId: member.userId,
            score: bestName.normalized.length + (sameChannel ? 1000 : 0),
        }];
    }).sort((a, b) => b.score - a.score);

    return scored[0]?.userId;
}

function svgIcon(path: string, viewBox = "0 0 24 24") {
    return `<svg viewBox="${viewBox}" width="16" height="16" aria-hidden="true" focusable="false"><path fill="currentColor" d="${path}" /></svg>`;
}

function getQuickButtonIcon(selected: boolean) {
    switch (settings.store.quickButtonIconSet) {
        case QuickButtonIconSet.Bookmark:
            return selected
                ? svgIcon("M8.75 2A2.75 2.75 0 0 0 6 4.75v15.1a.9.9 0 0 0 1.42.74L12 17.38l4.58 3.21a.9.9 0 0 0 1.42-.74V4.75A2.75 2.75 0 0 0 15.25 2h-6.5Z")
                : svgIcon("M8.75 2A2.75 2.75 0 0 0 6 4.75v15.1a.9.9 0 0 0 1.42.74L12 17.38l4.58 3.21a.9.9 0 0 0 1.42-.74V4.75A2.75 2.75 0 0 0 15.25 2h-6.5Zm0 1.8h6.5c.52 0 .95.43.95.95v13.37l-3.68-2.58a.9.9 0 0 0-1.04 0L7.8 18.12V4.75c0-.52.43-.95.95-.95Z");
        case QuickButtonIconSet.User:
            return selected
                ? svgIcon("M12 12.75a4.75 4.75 0 1 0 0-9.5 4.75 4.75 0 0 0 0 9.5Zm-7.5 6.53c0-2.61 3.38-4.73 7.5-4.73s7.5 2.12 7.5 4.73c0 .94-.76 1.72-1.7 1.72H6.2c-.94 0-1.7-.78-1.7-1.72Z")
                : svgIcon("M12 12.75a4.75 4.75 0 1 0 0-9.5 4.75 4.75 0 0 0 0 9.5Zm0 1.8c-4.12 0-7.5 2.12-7.5 4.73 0 .94.76 1.72 1.7 1.72h8.55a6.46 6.46 0 0 1-.7-1.8H6.3c.18-1.36 2.53-2.85 5.7-2.85.75 0 1.46.08 2.1.23.21-.6.5-1.15.86-1.65a11.4 11.4 0 0 0-2.96-.38Zm6 1.2a1 1 0 0 1 1 1V18h1.25a1 1 0 1 1 0 2H19.5v1.25a1 1 0 1 1-2 0V20h-1.25a1 1 0 1 1 0-2h1.25v-1.25a1 1 0 0 1 1-1Z");
        case QuickButtonIconSet.Pin:
            return selected
                ? svgIcon("M14.9 2.6a2 2 0 0 0-2.83 0L8.4 6.27a4 4 0 0 0-5.14.45.9.9 0 0 0 0 1.27l4.95 4.95-5.27 5.27a1 1 0 0 0 1.42 1.42l5.27-5.27 4.95 4.95a.9.9 0 0 0 1.27 0 4 4 0 0 0 .45-5.14l3.67-3.67a2 2 0 0 0 0-2.83L14.9 2.6Z")
                : svgIcon("M14.9 2.6a2 2 0 0 0-2.83 0L8.4 6.27a4 4 0 0 0-5.14.45.9.9 0 0 0 0 1.27l4.95 4.95-5.27 5.27a1 1 0 0 0 1.42 1.42l5.27-5.27 4.95 4.95a.9.9 0 0 0 1.27 0 4 4 0 0 0 .45-5.14l3.67-3.67a2 2 0 0 0 0-2.83L14.9 2.6Zm-1.41 1.41 5.05 5.05-4.58 4.58.54.7c.55.72.55 1.69.03 2.4L5.84 8.05a2.2 2.2 0 0 1 2.4.03l.7.54 4.55-4.61Z");
        case QuickButtonIconSet.Star:
            return selected
                ? svgIcon("M12 2.4a1 1 0 0 1 .92.6l2.4 5.04 5.52.72a1 1 0 0 1 .55 1.72l-4.05 3.84 1.02 5.48a1 1 0 0 1-1.47 1.05L12 18.18l-4.89 2.67a1 1 0 0 1-1.47-1.05l1.02-5.48-4.05-3.84a1 1 0 0 1 .55-1.72l5.52-.72 2.4-5.04a1 1 0 0 1 .92-.6Z")
                : svgIcon("M12 2.4a1 1 0 0 1 .92.6l2.4 5.04 5.52.72a1 1 0 0 1 .55 1.72l-4.05 3.84 1.02 5.48a1 1 0 0 1-1.47 1.05L12 18.18l-4.89 2.67a1 1 0 0 1-1.47-1.05l1.02-5.48-4.05-3.84a1 1 0 0 1 .55-1.72l5.52-.72 2.4-5.04a1 1 0 0 1 .92-.6Zm0 3.33-1.75 3.67a1 1 0 0 1-.77.56l-4.02.53 2.95 2.8a1 1 0 0 1 .29.89l-.74 3.99 3.56-1.95a1 1 0 0 1 .96 0l3.56 1.95-.74-3.99a1 1 0 0 1 .29-.89l2.95-2.8-4.02-.53a1 1 0 0 1-.77-.56L12 5.73Z");
        case QuickButtonIconSet.Crown:
            return selected
                ? svgIcon("M5 17.5h14l1.2-9.2a1 1 0 0 0-1.65-.87l-3.4 2.86-2.26-5.65a1 1 0 0 0-1.86 0l-2.26 5.65-3.4-2.86a1 1 0 0 0-1.65.87L5 17.5Zm.5 2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-.7h-13v.7Z")
                : svgIcon("M5 17.5h14l1.2-9.2a1 1 0 0 0-1.65-.87l-3.4 2.86-2.26-5.65a1 1 0 0 0-1.86 0l-2.26 5.65-3.4-2.86a1 1 0 0 0-1.65.87L5 17.5Zm2-2L5.97 10l2.55 2.14a1 1 0 0 0 1.57-.4L12 6.97l1.91 4.77a1 1 0 0 0 1.57.4L18.03 10 17 15.5H7Zm-1.5 3.8h13v.2a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-.2Z");
        case QuickButtonIconSet.Sparkle:
            return selected
                ? svgIcon("M12 2a1 1 0 0 1 .93.64l1.55 4.04 4.04 1.55a1 1 0 0 1 0 1.86l-4.04 1.55-1.55 4.04a1 1 0 0 1-1.86 0l-1.55-4.04-4.04-1.55a1 1 0 0 1 0-1.86l4.04-1.55 1.55-4.04A1 1 0 0 1 12 2Zm6 12a1 1 0 0 1 .93.64l.45 1.18 1.18.45a1 1 0 0 1 0 1.86l-1.18.45-.45 1.18a1 1 0 0 1-1.86 0l-.45-1.18-1.18-.45a1 1 0 0 1 0-1.86l1.18-.45.45-1.18A1 1 0 0 1 18 14Z")
                : svgIcon("M12 2a1 1 0 0 1 .93.64l1.55 4.04 4.04 1.55a1 1 0 0 1 0 1.86l-4.04 1.55-1.55 4.04a1 1 0 0 1-1.86 0l-1.55-4.04-4.04-1.55a1 1 0 0 1 0-1.86l4.04-1.55 1.55-4.04A1 1 0 0 1 12 2Zm0 3.78-.82 2.14a1 1 0 0 1-.57.57L8.47 9.3l2.14.82a1 1 0 0 1 .57.57l.82 2.14.82-2.14a1 1 0 0 1 .57-.57l2.14-.82-2.14-.82a1 1 0 0 1-.57-.57L12 5.78Z");
        case QuickButtonIconSet.Target:
            return selected
                ? svgIcon("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm0 3.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z")
                : svgIcon("M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z");
        case QuickButtonIconSet.Shield:
            return selected
                ? svgIcon("M12 2.2a1 1 0 0 1 .42.09l6 2.75a1 1 0 0 1 .58.91v4.23c0 4.78-2.77 8.98-6.63 10.92a1 1 0 0 1-.74 0C7.77 19.16 5 14.96 5 10.18V5.95a1 1 0 0 1 .58-.91l6-2.75A1 1 0 0 1 12 2.2Z")
                : svgIcon("M12 2.2a1 1 0 0 1 .42.09l6 2.75a1 1 0 0 1 .58.91v4.23c0 4.78-2.77 8.98-6.63 10.92a1 1 0 0 1-.74 0C7.77 19.16 5 14.96 5 10.18V5.95a1 1 0 0 1 .58-.91l6-2.75A1 1 0 0 1 12 2.2Zm0 2.1-5 2.3v3.58c0 3.75 2.06 7.13 5 8.9 2.94-1.77 5-5.15 5-8.9V6.6l-5-2.3Z");
        case QuickButtonIconSet.PlusCheck:
        default:
            return selected
                ? svgIcon("M9.55 16.15 5.4 12a1 1 0 0 0-1.4 1.42l4.84 4.84a1 1 0 0 0 1.42 0L20 8.5a1 1 0 0 0-1.42-1.42l-9.03 9.07Z")
                : svgIcon("M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1Z");
    }
}

function getQuickButtonLabel(selected: boolean) {
    const style = settings.store.quickButtonStyle;
    const label = selected ? t("quickSelected") : t("quickSelect");

    if (style === QuickButtonStyle.IconText || style === QuickButtonStyle.Pill) return label;
    return "";
}

function setVoiceButtonState(button: HTMLButtonElement, guildId: string, userId: string) {
    const selected = hasSelectedUser(guildId, userId);
    const icon = getQuickButtonIcon(selected);
    const label = getQuickButtonLabel(selected);
    const title = selected ? t("quickSelected") : t("quickSelect");
    const style = settings.store.quickButtonStyle ?? QuickButtonStyle.Native;
    const iconSet = settings.store.quickButtonIconSet ?? QuickButtonIconSet.PlusCheck;
    const visibility = settings.store.quickButtonVisibility ?? QuickButtonVisibility.HoverOnly;
    const size = settings.store.quickButtonSize ?? QuickButtonSize.Normal;
    const position = settings.store.quickButtonPosition ?? QuickButtonPosition.RightSide;
    const selectedStyle = settings.store.quickButtonSelectedStyle ?? QuickButtonSelectedStyle.Filled;
    const accent = settings.store.quickButtonAccent ?? QuickButtonAccent.Blurple;
    const visualStyle = settings.store.visualStyle ?? VisualStyle.DiscordLike;
    const nextStateKey = [selected, style, iconSet, visibility, size, position, selectedStyle, accent, visualStyle, icon, label, title].join("|");

    if (button.dataset.vcVcuStateKey === nextStateKey) return;
    button.dataset.vcVcuStateKey = nextStateKey;

    button.dataset.vcVcuSelected = selected ? "true" : "false";
    button.dataset.vcVcuStyle = style;
    button.dataset.vcVcuIconSet = iconSet;
    button.dataset.vcVcuVisibility = visibility;
    button.dataset.vcVcuSize = size;
    button.dataset.vcVcuPosition = position;
    button.dataset.vcVcuSelectedStyle = selectedStyle;
    button.dataset.vcVcuAccent = accent;
    button.dataset.vcVcuVisualStyle = visualStyle;

    button.classList.toggle("vc-vcu-dom-memory-selected", selected);
    button.title = title;
    button.setAttribute("aria-label", title);
    button.setAttribute("aria-pressed", selected ? "true" : "false");

    button.replaceChildren();

    const iconNode = document.createElement("span");
    iconNode.className = "vc-vcu-dom-memory-icon";
    iconNode.innerHTML = icon;
    button.appendChild(iconNode);

    if (label) {
        const labelNode = document.createElement("span");
        labelNode.className = "vc-vcu-dom-memory-label";
        labelNode.textContent = label;
        button.appendChild(labelNode);
    }
}

function refreshVoiceMemoryDomButtons() {
    document.querySelectorAll<HTMLButtonElement>(".vc-vcu-dom-memory-btn").forEach(button => {
        const guildId = button.dataset.vcVcuGuildId;
        const userId = button.dataset.vcVcuUserId;
        if (!guildId || !userId) return;
        setVoiceButtonState(button, guildId, userId);
    });
}

function getSelfPullButtonIcon() {
    return svgIcon("M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1Zm-7 17a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z");
}

function setSelfPullButtonState(button: HTMLButtonElement, guildId: string) {
    const selectedCount = getSelectionCount(guildId);
    const visibility = settings.store.quickButtonVisibility ?? QuickButtonVisibility.HoverOnly;
    const size = settings.store.quickButtonSize ?? QuickButtonSize.Normal;
    const accent = settings.store.quickButtonAccent ?? QuickButtonAccent.Blurple;
    const visualStyle = settings.store.visualStyle ?? VisualStyle.DiscordLike;
    const title = selectedCount > 0 ? `${t("pullSelectedToMe")} (${selectedCount})` : t("pullSelectedToMe");
    const nextStateKey = [selectedCount, visibility, size, accent, visualStyle, title].join("|");

    if (button.dataset.vcVcuStateKey === nextStateKey) return;
    button.dataset.vcVcuStateKey = nextStateKey;

    button.dataset.vcVcuVisibility = visibility;
    button.dataset.vcVcuSize = size;
    button.dataset.vcVcuAccent = accent;
    button.dataset.vcVcuVisualStyle = visualStyle;
    button.dataset.vcVcuSelectedCount = String(selectedCount);
    button.title = title;
    button.setAttribute("aria-label", title);

    button.replaceChildren();
    const iconNode = document.createElement("span");
    iconNode.className = "vc-vcu-self-pull-icon";
    iconNode.innerHTML = getSelfPullButtonIcon();
    button.appendChild(iconNode);
}

function refreshSelfPullDomButtons() {
    document.querySelectorAll<HTMLButtonElement>(".vc-vcu-self-pull-btn").forEach(button => {
        const guildId = button.dataset.vcVcuGuildId;
        if (!guildId) return;
        setSelfPullButtonState(button, guildId);
    });
}

function getChannelPullButtonIcon() {
    return svgIcon("M15.5 4a1 1 0 1 1 0 2H9.91l3.3 3.3a1 1 0 0 1-1.42 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 1 1 1.42 1.4L9.91 4h5.59ZM4 13a1 1 0 0 1 1-1h9.59l-3.3-3.3a1 1 0 1 1 1.42-1.4l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 1 1-1.42-1.4l3.3-3.3H5a1 1 0 0 1-1-1Zm15-10a1 1 0 0 1 1 1v16a1 1 0 1 1-2 0V4a1 1 0 0 1 1-1Z");
}

function getChannelIdFromRow(row: HTMLElement) {
    return row.getAttribute("data-list-item-id")?.match(/\d{15,25}/)?.[0] ?? null;
}

function getLikelyVoiceChannelRows(guildId: string) {
    const voiceChannels = getGuildVoiceChannels(guildId);
    const channelById = new Map(voiceChannels.map(channel => [channel.id, channel]));

    return Array.from(document.querySelectorAll<HTMLElement>('[data-list-item-id^="channels___"]'))
        .flatMap(row => {
            const channelId = getChannelIdFromRow(row);
            const channel = channelId ? channelById.get(channelId) : null;
            if (!channel || row.closest(".vc-vcu-root")) return [];

            const rect = row.getBoundingClientRect();
            if (rect.width < 120 || rect.height < 20 || rect.height > 52) return [];

            return [{ row, channel }];
        });
}

function setChannelPullButtonState(button: HTMLButtonElement, guildId: string, channelId: string, channelName: string) {
    const selectedCount = getSelectionCount(guildId);
    const visibility = settings.store.quickButtonVisibility ?? QuickButtonVisibility.HoverOnly;
    const size = settings.store.quickButtonSize ?? QuickButtonSize.Normal;
    const accent = settings.store.quickButtonAccent ?? QuickButtonAccent.Blurple;
    const visualStyle = settings.store.visualStyle ?? VisualStyle.DiscordLike;
    const position = settings.store.channelPullButtonPosition ?? ChannelPullButtonPosition.BeforeChat;
    const title = selectedCount > 0 ? `${t("pullSelectedHere")} #${channelName} (${selectedCount})` : `${t("pullSelectedHere")} #${channelName}`;
    const nextStateKey = [selectedCount, visibility, size, accent, visualStyle, position, channelId, channelName, title].join("|");

    if (button.dataset.vcVcuStateKey === nextStateKey) return;
    button.dataset.vcVcuStateKey = nextStateKey;

    button.dataset.vcVcuVisibility = visibility;
    button.dataset.vcVcuSize = size;
    button.dataset.vcVcuAccent = accent;
    button.dataset.vcVcuVisualStyle = visualStyle;
    button.dataset.vcVcuSelectedCount = String(selectedCount);
    button.disabled = selectedCount === 0;
    button.title = title;
    button.setAttribute("aria-label", title);

    button.replaceChildren();
    const iconNode = document.createElement("span");
    iconNode.className = "vc-vcu-channel-pull-icon";
    iconNode.innerHTML = getChannelPullButtonIcon();
    button.appendChild(iconNode);
}

function refreshChannelPullDomButtons() {
    document.querySelectorAll<HTMLButtonElement>(".vc-vcu-channel-pull-btn").forEach(button => {
        const guildId = button.dataset.vcVcuGuildId;
        const channelId = button.dataset.vcVcuChannelId;
        const channelName = button.dataset.vcVcuChannelName;
        if (!guildId || !channelId || !channelName) return;
        setChannelPullButtonState(button, guildId, channelId, channelName);
    });
}

function cleanupDomButtonsForChangedGuild(guildId: string) {
    const channelsElement = document.querySelector("#channels");
    const locationKey = `${location.pathname}|${location.search}|${location.hash}`;
    const changed = lastDomGuildId !== guildId || lastChannelsElement !== channelsElement || lastLocationKey !== locationKey;

    if (!changed) return;

    document.querySelectorAll(".vc-vcu-dom-memory-btn, .vc-vcu-self-pull-btn, .vc-vcu-channel-pull-btn").forEach(button => button.remove());
    document.querySelectorAll(".vc-vcu-dom-memory-row").forEach(row => row.classList.remove("vc-vcu-dom-memory-row", "vc-vcu-self-pull-row"));
    document.querySelectorAll(".vc-vcu-channel-pull-row").forEach(row => row.classList.remove("vc-vcu-channel-pull-row"));

    lastDomGuildId = guildId;
    lastChannelsElement = channelsElement;
    lastLocationKey = locationKey;
}

function findChannelActionsHost(row: HTMLElement) {
    const nativeChildren = Array.from(row.querySelectorAll<HTMLElement>('[class*="children__"], [class*="children_"]'))
        .filter(element => {
            const rect = element.getBoundingClientRect();
            const className = typeof element.className === "string" ? element.className : "";
            const hasNativeIcons = element.querySelectorAll("svg,button,[role='button']").length > 0;
            return /children/.test(className) && rect.width >= 8 && rect.height >= 10 && rect.height <= 28 && hasNativeIcons;
        })
        .sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x);

    if (nativeChildren[0]) return nativeChildren[0];

    const linkTop = row.querySelector<HTMLElement>(':scope [class*="linkTop__"], :scope [class*="linkTop_"]');
    if (linkTop) return linkTop;

    return row;
}

function renderChannelPullDomButtons(guildId: string) {
    const showChannelPullButton = Boolean(settings.store.showChannelPullButton);
    if (!showChannelPullButton) {
        document.querySelectorAll(".vc-vcu-channel-pull-btn").forEach(button => button.remove());
        document.querySelectorAll(".vc-vcu-channel-pull-row").forEach(row => row.classList.remove("vc-vcu-channel-pull-row"));
        return;
    }

    const seen = new Set<string>();
    for (const { row, channel } of getLikelyVoiceChannelRows(guildId)) {
        seen.add(channel.id);
        row.classList.add("vc-vcu-channel-pull-row");

        const actionsHost = findChannelActionsHost(row);

        let button = row.querySelector<HTMLButtonElement>(".vc-vcu-channel-pull-btn");
        if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "vc-vcu-channel-pull-btn";

            let lastPullAt = 0;
            const pullFromButton = () => {
                const buttonGuildId = button!.dataset.vcVcuGuildId;
                const buttonChannelId = button!.dataset.vcVcuChannelId;
                if (!buttonGuildId || !buttonChannelId) return;
                lastPullAt = Date.now();
                pullSelectedToChannel(buttonGuildId, buttonChannelId);
                window.requestAnimationFrame(refreshChannelPullDomButtons);
            };

            button.addEventListener("pointerdown", event => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                pullFromButton();
            });
            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                if (Date.now() - lastPullAt < 250) return;
                pullFromButton();
            });
        }

        const position = settings.store.channelPullButtonPosition ?? ChannelPullButtonPosition.BeforeChat;
        const hostClassName = typeof actionsHost.className === "string" ? actionsHost.className : "";
        const isNativeActionsHost = /children[_-]/i.test(hostClassName);
        const firstExistingAction = isNativeActionsHost
            ? Array.from(actionsHost.children).find(child =>
                child !== button && (child.matches?.("button,[role='button']") || child.querySelector?.("button,[role='button'],svg"))
            )
            : null;

        if (button.parentElement !== actionsHost) actionsHost.appendChild(button);

        if (position === ChannelPullButtonPosition.BeforeChat && firstExistingAction && button.previousElementSibling !== null) {
            actionsHost.insertBefore(button, firstExistingAction);
        } else if (position === ChannelPullButtonPosition.AfterActions && button.nextElementSibling !== null) {
            actionsHost.appendChild(button);
        }

        button.dataset.vcVcuGuildId = guildId;
        button.dataset.vcVcuChannelId = channel.id;
        button.dataset.vcVcuChannelName = channel.name;
        setChannelPullButtonState(button, guildId, channel.id, channel.name);
    }

    document.querySelectorAll<HTMLButtonElement>(".vc-vcu-channel-pull-btn").forEach(button => {
        const channelId = button.dataset.vcVcuChannelId;
        if (channelId && !seen.has(channelId)) button.remove();
    });
}

function renderVoiceMemoryDomButtons() {
    const showMemoryButton = Boolean(settings.store.showVoiceUserMemoryButton);
    const showSelfPullButton = Boolean(settings.store.showSelfPullToMeButton);
    const showChannelPullButton = Boolean(settings.store.showChannelPullButton);

    if (!showMemoryButton && !showSelfPullButton && !showChannelPullButton) {
        document.querySelectorAll(".vc-vcu-dom-memory-btn, .vc-vcu-self-pull-btn, .vc-vcu-channel-pull-btn").forEach(button => button.remove());
        document.querySelectorAll(".vc-vcu-dom-memory-row").forEach(row => row.classList.remove("vc-vcu-dom-memory-row", "vc-vcu-self-pull-row"));
        document.querySelectorAll(".vc-vcu-channel-pull-row").forEach(row => row.classList.remove("vc-vcu-channel-pull-row"));
        return;
    }

    const guildId = SelectedGuildStore?.getGuildId?.();
    if (!guildId) return;

    cleanupDomButtonsForChangedGuild(guildId);
    renderChannelPullDomButtons(guildId);

    if (!showMemoryButton && !showSelfPullButton) {
        document.querySelectorAll(".vc-vcu-dom-memory-btn, .vc-vcu-self-pull-btn").forEach(button => button.remove());
        document.querySelectorAll(".vc-vcu-dom-memory-row").forEach(row => row.classList.remove("vc-vcu-dom-memory-row", "vc-vcu-self-pull-row"));
        return;
    }

    const myId = UserStore.getCurrentUser()?.id;

    for (const row of getLikelyVoiceRows()) {
        const userId = resolveVoiceRowUserId(row, guildId);
        if (!userId) continue;

        row.dataset.vcVcuUserId = userId;
        row.classList.add("vc-vcu-dom-memory-row");
        row.classList.toggle("vc-vcu-self-pull-row", showSelfPullButton && userId === myId);

        const content = getVoiceRowContent(row);
        const icons = getVoiceRowIcons(content);

        let memoryButton = row.querySelector<HTMLButtonElement>(".vc-vcu-dom-memory-btn");
        if (!showMemoryButton) {
            memoryButton?.remove();
            memoryButton = null;
        } else {
            if (!memoryButton) {
                memoryButton = document.createElement("button");
                memoryButton.type = "button";
                memoryButton.className = "vc-vcu-dom-memory-btn";

                let lastToggleAt = 0;
                const toggleFromButton = () => {
                    const buttonGuildId = memoryButton!.dataset.vcVcuGuildId;
                    const buttonUserId = memoryButton!.dataset.vcVcuUserId;
                    if (!buttonGuildId || !buttonUserId) return;

                    lastToggleAt = Date.now();
                    const selected = toggleUserSelection(buttonGuildId, buttonUserId);
                    setVoiceButtonState(memoryButton!, buttonGuildId, buttonUserId);
                    window.requestAnimationFrame(() => {
                        refreshVoiceMemoryDomButtons();
                        refreshSelfPullDomButtons();
                    });
                    showToast(selected ? t("quickAddedToast") : t("quickRemovedToast"), Toasts.Type.SUCCESS);
                };

                memoryButton.addEventListener("pointerdown", event => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.stopPropagation();
                    toggleFromButton();
                });
                memoryButton.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (Date.now() - lastToggleAt < 250) return;
                    toggleFromButton();
                });
            }

            if (content) {
                if (memoryButton.parentElement !== content || (icons && memoryButton.nextElementSibling !== icons && !memoryButton.nextElementSibling?.classList.contains("vc-vcu-self-pull-btn"))) {
                    content.insertBefore(memoryButton, icons ?? null);
                }
            } else if (memoryButton.parentElement !== row) {
                row.appendChild(memoryButton);
            }

            memoryButton.dataset.vcVcuGuildId = guildId;
            memoryButton.dataset.vcVcuUserId = userId;
            setVoiceButtonState(memoryButton, guildId, userId);
        }

        let selfPullButton = row.querySelector<HTMLButtonElement>(".vc-vcu-self-pull-btn");
        const shouldShowSelfPull = showSelfPullButton && userId === myId;
        if (!shouldShowSelfPull) {
            selfPullButton?.remove();
            continue;
        }

        if (!selfPullButton) {
            selfPullButton = document.createElement("button");
            selfPullButton.type = "button";
            selfPullButton.className = "vc-vcu-self-pull-btn";

            let lastPullAt = 0;
            const pullFromButton = () => {
                const buttonGuildId = selfPullButton!.dataset.vcVcuGuildId;
                if (!buttonGuildId) return;
                lastPullAt = Date.now();
                pullSelectedToMe(buttonGuildId);
                window.requestAnimationFrame(refreshSelfPullDomButtons);
            };

            selfPullButton.addEventListener("pointerdown", event => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                pullFromButton();
            });
            selfPullButton.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                if (Date.now() - lastPullAt < 250) return;
                pullFromButton();
            });
        }

        if (content) {
            const beforeNode = icons ?? null;
            if (selfPullButton.parentElement !== content || selfPullButton.nextElementSibling !== beforeNode) {
                content.insertBefore(selfPullButton, beforeNode);
            }
        } else if (selfPullButton.parentElement !== row) {
            row.appendChild(selfPullButton);
        }

        selfPullButton.dataset.vcVcuGuildId = guildId;
        setSelfPullButtonState(selfPullButton, guildId);
    }
}

function queueVoiceMemoryDomRender() {
    if (voiceButtonRenderTimer) return;

    const elapsed = Date.now() - lastVoiceButtonRenderAt;
    const delay = Math.max(VOICE_BUTTON_RENDER_DELAY_MS - elapsed, 60);

    voiceButtonRenderTimer = setTimeout(() => {
        voiceButtonRenderTimer = null;
        lastVoiceButtonRenderAt = Date.now();
        renderVoiceMemoryDomButtons();
    }, delay);
}

function onSelectionMemoryChanged() {
    refreshVoiceMemoryDomButtons();
    refreshSelfPullDomButtons();
    refreshChannelPullDomButtons();
    renderTopPanelButton();
}

function onRouteOrFocusChanged() {
    queueVoiceMemoryDomRender();
    setTimeout(renderVoiceMemoryDomButtons, 250);
    setTimeout(renderVoiceMemoryDomButtons, 900);
}

function startVoiceMemoryDomObserver() {
    stopVoiceMemoryDomObserver();

    lastDomGuildId = null;
    lastChannelsElement = null;
    lastLocationKey = "";

    const root = document.body;
    voiceButtonObserver = new MutationObserver(mutations => {
        if (shouldIgnoreVoiceButtonMutations(mutations)) return;
        queueVoiceMemoryDomRender();
    });
    voiceButtonObserver.observe(root, { childList: true, subtree: true });
    window.addEventListener("vc-vcu-selection-change", onSelectionMemoryChanged);
    window.addEventListener("focus", onRouteOrFocusChanged);
    window.addEventListener("popstate", onRouteOrFocusChanged);
    window.addEventListener("hashchange", onRouteOrFocusChanged);

    // Safety timer: only re-render when context actually changes (guild/route).
    // The MutationObserver above handles "Discord re-rendered the list" cases.
    // Increased interval from 1.2s to 3s to reduce CPU on idle clients.
    voiceButtonSafetyTimer = setInterval(() => {
        const guildId = SelectedGuildStore?.getGuildId?.() ?? null;
        const channelsElement = document.querySelector("#channels");
        const locationKey = `${location.pathname}|${location.search}|${location.hash}`;
        const contextChanged = guildId !== lastDomGuildId || channelsElement !== lastChannelsElement || locationKey !== lastLocationKey;
        const hasAnyButtons = Boolean(document.querySelector(".vc-vcu-dom-memory-btn, .vc-vcu-self-pull-btn, .vc-vcu-channel-pull-btn"));

        if (contextChanged || !hasAnyButtons) {
            queueVoiceMemoryDomRender();
        }
        // Note: refreshXxxDomButtons() calls removed from safety path - the observer
        // already covers them and they were the cause of ~95% of idle CPU.
    }, 3000);

    queueVoiceMemoryDomRender();
    setTimeout(renderVoiceMemoryDomButtons, 350);
    setTimeout(renderVoiceMemoryDomButtons, 1200);
    console.info("YamachVoiceUtilitiesPro: optimized DOM voice buttons enabled");
}

function stopVoiceMemoryDomObserver() {
    if (voiceButtonRenderTimer) {
        clearTimeout(voiceButtonRenderTimer);
        voiceButtonRenderTimer = null;
    }

    if (voiceButtonSafetyTimer) {
        clearInterval(voiceButtonSafetyTimer);
        voiceButtonSafetyTimer = null;
    }

    voiceButtonObserver?.disconnect();
    voiceButtonObserver = null;
    lastDomGuildId = null;
    lastChannelsElement = null;
    lastLocationKey = "";
    window.removeEventListener("vc-vcu-selection-change", onSelectionMemoryChanged);
    window.removeEventListener("focus", onRouteOrFocusChanged);
    window.removeEventListener("popstate", onRouteOrFocusChanged);
    window.removeEventListener("hashchange", onRouteOrFocusChanged);

    document.querySelectorAll(".vc-vcu-dom-memory-btn, .vc-vcu-self-pull-btn, .vc-vcu-channel-pull-btn").forEach(button => button.remove());
    document.querySelectorAll(".vc-vcu-dom-memory-row").forEach(row => row.classList.remove("vc-vcu-dom-memory-row", "vc-vcu-self-pull-row"));
    document.querySelectorAll(".vc-vcu-channel-pull-row").forEach(row => row.classList.remove("vc-vcu-channel-pull-row"));
}

function normalizeAria(value?: string | null) {
    return normalizeDomText(value ?? "");
}

let lastKnownTopGuildId: string | null = null;

function getTopPanelGuildId() {
    const selectedGuildId = SelectedGuildStore?.getGuildId?.() ?? null;
    if (selectedGuildId) {
        lastKnownTopGuildId = selectedGuildId;
        return selectedGuildId;
    }

    const selectedChannelId = SelectedChannelStore?.getChannelId?.() ?? null;
    const selectedChannel = selectedChannelId ? IndexChannelStore?.getChannel?.(selectedChannelId) : null;
    const channelGuildId = selectedChannel?.guild_id ?? null;
    if (channelGuildId) {
        lastKnownTopGuildId = channelGuildId;
        return channelGuildId;
    }

    return lastKnownTopGuildId;
}

function getElementClassName(element: HTMLElement) {
    return element.className?.toString?.() ?? "";
}

function isBadTopToolbarHost(element: HTMLElement) {
    const className = getElementClassName(element).toLowerCase();
    return /(^|\s|_)leading|(^|\s|_)title|topic|search/.test(className);
}

function hasTopToolbarButtons(element: HTMLElement) {
    return element.querySelectorAll("button,[role='button'],svg").length >= 2;
}

function isTopToolbarCandidate(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    if (rect.top < 0 || rect.top > 76) return false;
    if (rect.height < 18 || rect.height > 48) return false;
    if (rect.width < 32 || rect.width > 380) return false;
    if (rect.right < window.innerWidth * 0.45) return false;
    if (isBadTopToolbarHost(element)) return false;
    return hasTopToolbarButtons(element);
}

function isTopBarTrailing(element: HTMLElement) {
    const className = getElementClassName(element);
    return /trailing/.test(className) && isTopToolbarCandidate(element);
}

function findTopToolbar() {
    const trailing = Array.from(document.querySelectorAll<HTMLElement>('[class*="trailing_"], [class*="trailing-"], [class*="trailing"]'))
        .filter(isTopBarTrailing)
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
    if (trailing) return trailing;

    const mentionLabels = [
        "inbox",
        "mentions",
        "recent mentions",
        "unreads",
        "صندوق",
        "المنشن",
        "منشن",
        "الإشارات",
        "الاشارات",
    ];

    const labelled = Array.from(document.querySelectorAll<HTMLElement>('[aria-label], [title]'))
        .filter(element => {
            const rect = element.getBoundingClientRect();
            if (rect.top < 0 || rect.top > 90 || rect.right < window.innerWidth * 0.45) return false;
            const text = `${normalizeAria(element.getAttribute("aria-label"))} ${normalizeAria(element.getAttribute("title"))}`;
            return mentionLabels.some(label => text.includes(normalizeAria(label)));
        })
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];

    if (labelled) {
        const trailingHost = labelled.closest<HTMLElement>('[class*="trailing_"], [class*="trailing-"], [class*="trailing"]');
        if (trailingHost && isTopToolbarCandidate(trailingHost)) return trailingHost;

        let host: HTMLElement | null = labelled;
        while (host?.parentElement && host.parentElement !== document.body) {
            if (isTopToolbarCandidate(host.parentElement)) return host.parentElement;
            host = host.parentElement;
        }
    }

    const roleToolbars = Array.from(document.querySelectorAll<HTMLElement>('[role="toolbar"]'))
        .filter(isTopToolbarCandidate)
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    if (roleToolbars[0]) return roleToolbars[0];

    const topBars = Array.from(document.querySelectorAll<HTMLElement>('[class*="bar_"], [class*="bar-"], [class*="toolbar"], [class*="toolbar_"]'))
        .filter(element => {
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.top < 80 && rect.height >= 24 && rect.height <= 52 && !isBadTopToolbarHost(element);
        });

    for (const bar of topBars) {
        const bestChild = Array.from(bar.children)
            .filter((child): child is HTMLElement => child instanceof HTMLElement)
            .filter(child => {
                const className = getElementClassName(child);
                return /trailing|toolbar|children/.test(className) && isTopToolbarCandidate(child);
            })
            .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
        if (bestChild) return bestChild;
    }

    const genericRightToolbar = Array.from(document.querySelectorAll<HTMLElement>("div,section,nav"))
        .filter(isTopToolbarCandidate)
        .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return br.right - ar.right || ar.width - br.width;
        })[0];

    return genericRightToolbar ?? null;
}

function findTopToolbarAnchor(toolbar: HTMLElement) {
    const mentionLabels = ["inbox", "mentions", "recent mentions", "unreads", "صندوق", "المنشن", "منشن", "الإشارات", "الاشارات"];

    const anchor = Array.from(toolbar.querySelectorAll<HTMLElement>('[aria-label], [title]'))
        .filter(element => {
            const text = `${normalizeAria(element.getAttribute("aria-label"))} ${normalizeAria(element.getAttribute("title"))}`;
            return mentionLabels.some(label => text.includes(normalizeAria(label)));
        })
        .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];

    if (!anchor) return toolbar.firstElementChild instanceof HTMLElement ? toolbar.firstElementChild : null;

    let directChild: HTMLElement | null = anchor;
    while (directChild.parentElement && directChild.parentElement !== toolbar) {
        directChild = directChild.parentElement;
    }

    return directChild.parentElement === toolbar ? directChild : null;
}
function setTopPanelButtonState(button: HTMLButtonElement) {
    const guildId = getTopPanelGuildId();
    const selectedCount = guildId ? getSelectionCount(guildId) : 0;
    const style = settings.store.topPanelButtonStyle ?? TopPanelButtonStyle.IconOnly;
    const showBadge = Boolean(settings.store.showTopPanelCountBadge && selectedCount > 0);
    const visualStyle = settings.store.visualStyle ?? VisualStyle.DiscordLike;
    const nextStateKey = [style, selectedCount, showBadge, visualStyle].join("|");

    if (button.dataset.vcVcuTopStateKey === nextStateKey) return;
    button.dataset.vcVcuTopStateKey = nextStateKey;
    button.dataset.vcVcuTopStyle = style;
    button.dataset.vcVcuSelectedCount = String(selectedCount);
    button.dataset.vcVcuVisualStyle = visualStyle;
    button.classList.toggle("vc-vcu-top-panel-has-count", showBadge);
    button.title = selectedCount > 0 ? `Open Voice Tools (${selectedCount} selected)` : "Open Voice Tools";
    button.setAttribute("aria-label", button.title);

    const count = button.querySelector<HTMLElement>(".vc-vcu-top-panel-count");
    if (count) count.textContent = selectedCount > 99 ? "99+" : String(selectedCount);
}

function createTopPanelButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vc-vcu-top-panel-btn";
    button.title = "Open Voice Tools";
    button.setAttribute("aria-label", "Open Voice Tools");

    let lastOpenAt = 0;
    const openFromButton = () => {
        const guildId = getTopPanelGuildId();
        lastOpenAt = Date.now();
        if (guildId) openPanelForGuild(guildId);
        else openYamachGlobalPanel();
    };

    button.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        openFromButton();
    });
    button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (Date.now() - lastOpenAt < 250) return;
        openFromButton();
    });

    const icon = document.createElement("span");
    icon.className = "vc-vcu-top-panel-icon";
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4.75 3A2.75 2.75 0 0 0 2 5.75v12.5A2.75 2.75 0 0 0 4.75 21h14.5A2.75 2.75 0 0 0 22 18.25V5.75A2.75 2.75 0 0 0 19.25 3H4.75Zm0 1.8h4.45v14.4H4.75a.95.95 0 0 1-.95-.95V5.75a.95.95 0 0 1 .95-.95Zm6.25 0h8.25a.95.95 0 0 1 .95.95v12.5a.95.95 0 0 1-.95.95H11V4.8Zm1.8 2.2v1.8h5.6V7h-5.6Zm0 3.6v1.8h5.6v-1.8h-5.6Zm0 3.6V16h3.6v-1.8h-3.6Z" /></svg>';

    const text = document.createElement("span");
    text.className = "vc-vcu-top-panel-text";
    text.textContent = "Voice Tools";

    const count = document.createElement("span");
    count.className = "vc-vcu-top-panel-count";
    count.textContent = "0";

    button.append(icon, text, count);
    setTopPanelButtonState(button);
    return button;
}

function renderTopPanelButton() {
    const existingButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".vc-vcu-top-panel-btn"));

    if (!settings.store.showTopPanelButton) {
        existingButtons.forEach(button => button.remove());
        return;
    }

    const toolbar = findTopToolbar();
    let button = existingButtons[0];
    existingButtons.slice(1).forEach(extra => extra.remove());

    if (!button) button = createTopPanelButton();

    setTopPanelButtonState(button);

    if (toolbar) {
        button.classList.remove("vc-vcu-top-panel-floating");
        const anchor = findTopToolbarAnchor(toolbar);
        if (button.parentElement !== toolbar) {
            toolbar.insertBefore(button, anchor ?? toolbar.firstChild);
        } else if (anchor && button.nextElementSibling !== anchor) {
            toolbar.insertBefore(button, anchor);
        }
    } else {
        button.classList.add("vc-vcu-top-panel-floating");
        if (button.parentElement !== document.body) document.body.appendChild(button);
    }
}

function queueTopPanelButtonRender() {
    if (topPanelButtonRenderTimer) return;
    topPanelButtonRenderTimer = setTimeout(() => {
        topPanelButtonRenderTimer = null;
        renderTopPanelButton();
    }, TOP_PANEL_BUTTON_RENDER_DELAY_MS);
}

function startTopPanelButtonObserver() {
    stopTopPanelButtonObserver();
    topPanelButtonObserver = new MutationObserver(mutations => {
        if (mutations.every(mutation => {
            if (mutation.target instanceof HTMLElement && mutation.target.closest(".vc-vcu-top-panel-btn")) return true;
            return Array.from(mutation.addedNodes).concat(Array.from(mutation.removedNodes)).every(node => {
                return node instanceof HTMLElement && Boolean(node.closest?.(".vc-vcu-top-panel-btn"));
            });
        })) return;

        queueTopPanelButtonRender();
    });
    topPanelButtonObserver.observe(document.body, { childList: true, subtree: true });
    queueTopPanelButtonRender();
    setTimeout(renderTopPanelButton, 900);
    console.info("VoiceChatUtilities: top panel button enabled");
}

function stopTopPanelButtonObserver() {
    if (topPanelButtonRenderTimer) {
        clearTimeout(topPanelButtonRenderTimer);
        topPanelButtonRenderTimer = null;
    }

    topPanelButtonObserver?.disconnect();
    topPanelButtonObserver = null;
    document.querySelectorAll(".vc-vcu-top-panel-btn").forEach(button => button.remove());
}

function startPlugin() {
    startVoiceMemoryDomObserver();
    startTopPanelButtonObserver();
    startShortcuts({
        openPanel: () => {
            const guildId = SelectedGuildStore?.getGuildId?.();
            if (guildId) openPanelForGuild(guildId);
            else openYamachGlobalPanel();
        },
        pullToMe: () => {
            const guildId = SelectedGuildStore?.getGuildId?.();
            if (!guildId) {
                showToast(t("noGuildToast"), Toasts.Type.FAILURE);
                return;
            }
            pullSelectedToMe(guildId);
        },
        clearSelection: () => {
            const guildId = SelectedGuildStore?.getGuildId?.();
            if (!guildId) return;
            clearSelection(guildId);
            showToast(t("clearedToast"), Toasts.Type.SUCCESS);
        },
        undo: () => {
            // Prefer the new captured-action undo stack; fall back to room memory restore.
            const entry = popUndoEntry();
            if (entry) {
                executePatchJobs(entry.guildId, entry.reverseJobs, `${t("undo")} · ${entry.label}`);
                return;
            }
            const guildId = SelectedGuildStore?.getGuildId?.();
            if (!guildId) {
                showToast(t("nothingToUndo"), Toasts.Type.FAILURE);
                return;
            }
            restoreMemoryPreviousRooms(guildId);
        },
    });
}

function stopPlugin() {
    stopShortcuts();
    stopTopPanelButtonObserver();
    stopVoiceMemoryDomObserver();
}

async function startYamachVoiceUtilitiesPro() {
    startPlugin();
    await yamachStart();
}

function stopYamachVoiceUtilitiesPro() {
    yamachStop();
    stopPlugin();
}

const Yamach = { name: "Yamach", id: 0n };

function openVoicePanel(channel: Channel, scope: ScopeMode = getDefaultScope()) {
    openModal(rootProps => <VoiceControlModal rootProps={rootProps} channel={channel} initialScope={scope} />);
}

function runSelectionAction(guildId: string, actionLabel: string, bodyFactory: (userId: string, index: number) => MemberPatchBody, rememberCurrentRooms = false) {
    const members = getSelectedVoiceMembers(guildId, getSelectionSnapshot(guildId));

    if (!members.length) {
        showToast(t("noSelectionToast"), Toasts.Type.FAILURE);
        return;
    }

    if (rememberCurrentRooms) rememberPreviousRooms(guildId, members);

    confirmAction(actionLabel, members.length, () => {
        executePatchJobs(
            guildId,
            members.map((member, index) => ({
                userId: member.userId,
                body: bodyFactory(member.userId, index),
            })),
            actionLabel
        ).then(ok => {
            if (ok && settings.store.clearSelectionAfterAction) {
                clearSelection(guildId);
            }
        });
    });
}

function addCurrentChannelToMemory(channel: Channel) {
    const userIds = getChannelUserIds(channel, settings.store.includeSelfByDefault, settings.store.includeBotsByDefault);
    addUsersToSelection(channel.guild_id, userIds);
    showToast(`${t("addedToast")} (${userIds.length})`, Toasts.Type.SUCCESS);
}

function removeCurrentChannelFromMemory(channel: Channel) {
    const userIds = getChannelUserIds(channel, true, true);
    removeUsersFromSelection(channel.guild_id, userIds);
    showToast(`${t("removedToast")} (${userIds.length})`, Toasts.Type.SUCCESS);
}

function clearGuildMemory(guildId: string) {
    clearSelection(guildId);
    showToast(t("clearedToast"), Toasts.Type.SUCCESS);
}
function restoreMemoryPreviousRooms(guildId: string) {
    const members = getSelectedVoiceMembers(guildId, getSelectionSnapshot(guildId));
    const restorableMembers = members.filter(member => {
        const previousRoom = getPreviousRoom(guildId, member.userId);
        return Boolean(previousRoom && previousRoom !== member.channelId);
    });

    if (!restorableMembers.length) {
        showToast(t("noPreviousRoomsToast"), Toasts.Type.FAILURE);
        return;
    }

    confirmAction(t("restorePreviousRooms"), restorableMembers.length, () => {
        executePatchJobs(
            guildId,
            restorableMembers.map(member => ({
                userId: member.userId,
                body: { channel_id: getPreviousRoom(guildId, member.userId)! },
            })),
            t("restorePreviousRooms")
        );
    });
}


function pullUsersToMe(guildId: string, userIds: string[], actionLabel = t("pullSelectedToMe")) {
    const myVoiceChannel = getCurrentUserVoiceChannel(guildId);
    if (!myVoiceChannel) {
        showToast(t("noMyVoiceChannelToast"), Toasts.Type.FAILURE);
        return;
    }

    const userIdSet = new Set(userIds);
    const movableMembers = getAllVoiceMembers(guildId)
        .filter(member => userIdSet.has(member.userId))
        .filter(member => member.channelId !== myVoiceChannel.id);

    if (!movableMembers.length) {
        showToast(t("noMovableToMeToast"), Toasts.Type.FAILURE);
        return;
    }

    rememberPreviousRooms(guildId, movableMembers);
    const label = `${actionLabel} #${myVoiceChannel.name}`;

    // Capture undo: reverse the pull by moving each member back to their previous room
    if (settings.store.enableUndo) {
        const reverseJobs = movableMembers
            .filter(member => member.channelId)
            .map(member => ({ userId: member.userId, body: { channel_id: member.channelId } as MemberPatchBody }));
        if (reverseJobs.length) pushUndoEntry({ label, guildId, reverseJobs });
    }

    confirmAction(label, movableMembers.length, () => {
        executePatchJobs(
            guildId,
            movableMembers.map(member => ({
                userId: member.userId,
                body: { channel_id: myVoiceChannel.id },
            })),
            label
        );
    });
}

function pullSelectedToMe(guildId: string) {
    pullUsersToMe(guildId, getSelectionSnapshot(guildId), t("pullSelectedToMe"));
}

function pullSelectedToChannel(guildId: string, targetChannelId: string) {
    const targetChannel = getGuildVoiceChannels(guildId).find(channel => channel.id === targetChannelId);
    if (!targetChannel) {
        showToast(t("noTargetToast"), Toasts.Type.FAILURE);
        return;
    }

    const members = getSelectedVoiceMembers(guildId, getSelectionSnapshot(guildId))
        .filter(member => member.channelId !== targetChannelId);

    if (!members.length) {
        showToast(t("noMovableToTargetToast"), Toasts.Type.FAILURE);
        return;
    }

    rememberPreviousRooms(guildId, members);
    const label = `${t("pullSelectedHere")} #${targetChannel.name}`;

    confirmAction(label, members.length, () => {
        executePatchJobs(
            guildId,
            members.map(member => ({
                userId: member.userId,
                body: { channel_id: targetChannelId },
            })),
            label
        ).then(ok => {
            if (ok && settings.store.clearSelectionAfterAction) {
                clearSelection(guildId);
            }
        });
    });
}


interface UserContextProps {
    user?: User;
    guildId?: string;
    guild?: { id?: string; };
    channel?: Channel;
    message?: { author?: User; guild_id?: string; };
}

function getContextUser(props: UserContextProps) {
    return props.user ?? props.message?.author;
}

function getContextGuildId(props: UserContextProps) {
    return props.guildId ?? props.guild?.id ?? props.channel?.guild_id ?? props.message?.guild_id;
}

function openYamachGlobalPanel(userId?: string, tab: "live" | "watch" | "logs" | "reports" | "alerts" | "data" | "theme" = "live") {
    setYamachPending(userId, tab);
    const virtualChannel = {
        id: "__yamach_global__",
        guild_id: "__yamach_global__",
        name: "Yamach Command Center",
    } as unknown as Channel;
    openVoicePanel(virtualChannel, "all");
}

function openPanelForGuild(guildId: string, userId?: string, tab?: "live" | "watch" | "logs" | "reports" | "alerts" | "data" | "theme") {
    if (userId || tab) setYamachPending(userId, tab ?? "live");
    const firstVoiceChannel = getGuildVoiceChannels(guildId)[0];

    if (!firstVoiceChannel) {
        openYamachGlobalPanel(userId, tab ?? "live");
        return;
    }

    openVoicePanel(firstVoiceChannel, "all");
}

const UserContext: NavContextMenuPatchCallback = (children, props: UserContextProps) => {
    const user = getContextUser(props);
    const guildId = getContextGuildId(props);

    if (!user?.id) return;

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            key="vc-yvu-user-root"
            id="vc-yvu-user-root"
            label="Yamach Command Center"
        >
            <Menu.MenuItem
                key="vc-yvu-open-user-live"
                id="vc-yvu-open-user-live"
                label={settings.store.language === "ar" ? "فتح موقعه الصوتي" : "Open voice locations"}
                action={() => {
                    guildId ? openPanelForGuild(guildId, user.id, "live") : openYamachGlobalPanel(user.id, "live");
                }}
            />
            <Menu.MenuItem
                key="vc-yvu-open-user-logs"
                id="vc-yvu-open-user-logs"
                label={settings.store.language === "ar" ? "فتح سجله" : "Open logs"}
                action={() => {
                    guildId ? openPanelForGuild(guildId, user.id, "logs") : openYamachGlobalPanel(user.id, "logs");
                }}
            />
            <Menu.MenuItem
                key="vc-yvu-track-user"
                id="vc-yvu-track-user"
                label={isTracked(user.id) ? (settings.store.language === "ar" ? "إلغاء تتبعه" : "Untrack user") : (settings.store.language === "ar" ? "تتبعه" : "Track user")}
                action={() => isTracked(user.id) ? untrackUser(user.id) : trackUser(user.id)}
            />
        </Menu.MenuItem>,
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            label={t("menuRoot")}
            key="vc-vcu-user-root"
            id="vc-vcu-user-root"
        >
            <Menu.MenuItem
                key="vc-vcu-pull-user-to-me"
                id="vc-vcu-pull-user-to-me"
                label={t("pullThisUserToMe")}
                action={() => {
                    if (!guildId) {
                        showToast(t("noGuildToast"), Toasts.Type.FAILURE);
                        return;
                    }

                    pullUsersToMe(guildId, [user.id], t("pullThisUserToMe"));
                }}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                key="vc-vcu-add-user-memory"
                id="vc-vcu-add-user-memory"
                label={t("addUserToMemory")}
                action={() => {
                    if (!guildId) {
                        showToast(t("noGuildToast"), Toasts.Type.FAILURE);
                        return;
                    }

                    addUsersToSelection(guildId, [user.id]);
                    showToast(t("userAddedToast"), Toasts.Type.SUCCESS);
                }}
            />
            <Menu.MenuItem
                key="vc-vcu-remove-user-memory"
                id="vc-vcu-remove-user-memory"
                label={t("removeUserFromMemory")}
                action={() => {
                    if (!guildId) {
                        showToast(t("noGuildToast"), Toasts.Type.FAILURE);
                        return;
                    }

                    removeUsersFromSelection(guildId, [user.id]);
                    showToast(t("userRemovedToast"), Toasts.Type.SUCCESS);
                }}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                key="vc-vcu-open-panel-from-user"
                id="vc-vcu-open-panel-from-user"
                label={t("openPanelFromUser")}
                action={() => {
                    if (!guildId) {
                        showToast(t("noGuildToast"), Toasts.Type.FAILURE);
                        return;
                    }

                    openPanelForGuild(guildId);
                }}
            />
        </Menu.MenuItem>
    );
};

interface VoiceChannelContextProps {
    channel: Channel;
}

const VoiceChannelContext: NavContextMenuPatchCallback = (children, { channel }: VoiceChannelContextProps) => {
    if (!isVoiceLikeChannel(channel)) return;

    const selectedCount = getSelectionCount(channel.guild_id);

    children.splice(
        -1,
        0,
        <Menu.MenuItem
            key="vc-yvu-channel-root"
            id="vc-yvu-channel-root"
            label="Yamach Command Center"
        >
            <Menu.MenuItem
                key="vc-yvu-open-command-center"
                id="vc-yvu-open-command-center"
                label={settings.store.language === "ar" ? "فتح لوحة Yamach" : "Open Yamach panel"}
                action={() => { setYamachPending(undefined, "live"); openVoicePanel(channel, "all"); }}
            />
            <Menu.MenuItem
                key="vc-yvu-watch-channel"
                id="vc-yvu-watch-channel"
                label={settings.store.language === "ar" ? "تتبع هذا الروم في لوق Yamach" : "Watch this room in Yamach logs"}
                action={() => toggleTrackedRoom(channel.id)}
            />
            <Menu.MenuItem
                key="vc-yvu-scope-guild"
                id="vc-yvu-scope-guild"
                label={settings.store.language === "ar" ? "اجعل هذا السيرفر نطاق التتبع" : "Use this server as tracking scope"}
                action={() => setTrackedGuild(channel.guild_id)}
            />
        </Menu.MenuItem>,
        <Menu.MenuItem
            label={t("menuRoot")}
            key="vc-vcu-root"
            id="vc-vcu-root"
        >
            <Menu.MenuItem
                key="vc-vcu-open-panel"
                id="vc-vcu-open-panel"
                label={t("openPanel")}
                action={() => openVoicePanel(channel)}
            />
            <Menu.MenuItem
                key="vc-vcu-open-panel-current"
                id="vc-vcu-open-panel-current"
                label={t("openPanelCurrent")}
                action={() => openVoicePanel(channel, "current")}
            />
            <Menu.MenuItem
                key="vc-vcu-open-panel-all"
                id="vc-vcu-open-panel-all"
                label={t("openPanelAll")}
                action={() => openVoicePanel(channel, "all")}
            />
            <Menu.MenuSeparator />

            <Menu.MenuItem
                key="vc-vcu-pull-selected-to-me"
                id="vc-vcu-pull-selected-to-me"
                label={`${t("pullSelectedToMe")} (${selectedCount})`}
                action={() => pullSelectedToMe(channel.guild_id)}
            />
            <Menu.MenuItem
                key="vc-vcu-move-memory-here"
                id="vc-vcu-move-memory-here"
                label={t("moveMemoryHere")}
                action={() => runSelectionAction(channel.guild_id, `${t("moveTo")} #${channel.name}`, () => ({ channel_id: channel.id }), true)}
            />
            <Menu.MenuItem
                key="vc-vcu-restore-memory"
                id="vc-vcu-restore-memory"
                label={t("restorePreviousRooms")}
                action={() => restoreMemoryPreviousRooms(channel.guild_id)}
            />

            <Menu.MenuItem
                key="vc-vcu-selection-manage"
                id="vc-vcu-selection-manage"
                label={`${t("memoryActions")} (${selectedCount})`}
            >
                <Menu.MenuItem
                    key="vc-vcu-add-current"
                    id="vc-vcu-add-current"
                    label={t("addCurrentToMemory")}
                    action={() => addCurrentChannelToMemory(channel)}
                />
                <Menu.MenuItem
                    key="vc-vcu-remove-current"
                    id="vc-vcu-remove-current"
                    label={t("removeCurrentFromMemory")}
                    action={() => removeCurrentChannelFromMemory(channel)}
                />
                <Menu.MenuItem
                    key="vc-vcu-clear-memory"
                    id="vc-vcu-clear-memory"
                    label={t("clearMemory")}
                    action={() => clearGuildMemory(channel.guild_id)}
                />
            </Menu.MenuItem>

            <Menu.MenuItem
                key="vc-vcu-memory-actions"
                id="vc-vcu-memory-actions"
                label={t("selectedActions")}
            >
                <Menu.MenuItem
                    key="vc-vcu-disconnect-memory"
                    id="vc-vcu-disconnect-memory"
                    label={t("disconnectMemory")}
                    action={() => runSelectionAction(channel.guild_id, t("disconnect"), () => ({ channel_id: null }))}
                />
                <Menu.MenuItem
                    key="vc-vcu-mute-memory"
                    id="vc-vcu-mute-memory"
                    label={t("muteMemory")}
                    action={() => runSelectionAction(channel.guild_id, t("mute"), () => ({ mute: true }))}
                />
                <Menu.MenuItem
                    key="vc-vcu-unmute-memory"
                    id="vc-vcu-unmute-memory"
                    label={t("unmuteMemory")}
                    action={() => runSelectionAction(channel.guild_id, t("unmute"), () => ({ mute: false }))}
                />
            </Menu.MenuItem>

            <Menu.MenuSeparator />

            <Menu.MenuItem
                key="vc-vcu-quick-current"
                id="vc-vcu-quick-current"
                label={t("quickCurrent")}
            >
                <Menu.MenuItem
                    key="vc-vcu-disconnect-all-here"
                    id="vc-vcu-disconnect-all-here"
                    label={t("disconnectAllHere")}
                    action={() => runBulkChannelAction(channel, { channel_id: null }, t("disconnectAllHere"))}
                />
                <Menu.MenuItem
                    key="vc-vcu-mute-all-here"
                    id="vc-vcu-mute-all-here"
                    label={t("muteAllHere")}
                    action={() => runBulkChannelAction(channel, { mute: true }, t("muteAllHere"))}
                />
                <Menu.MenuItem
                    key="vc-vcu-unmute-all-here"
                    id="vc-vcu-unmute-all-here"
                    label={t("unmuteAllHere")}
                    action={() => runBulkChannelAction(channel, { mute: false }, t("unmuteAllHere"))}
                />
                <Menu.MenuItem
                    key="vc-vcu-deafen-all-here"
                    id="vc-vcu-deafen-all-here"
                    label={t("deafenAllHere")}
                    action={() => runBulkChannelAction(channel, { deaf: true }, t("deafenAllHere"))}
                />
                <Menu.MenuItem
                    key="vc-vcu-undeafen-all-here"
                    id="vc-vcu-undeafen-all-here"
                    label={t("undeafenAllHere")}
                    action={() => runBulkChannelAction(channel, { deaf: false }, t("undeafenAllHere"))}
                />
            </Menu.MenuItem>
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "YamachVoiceUtilitiesPro",
    description: "Made by Yamach. Unified voice utilities and command center: moderation controls, voice finder, watch board, local logs, room reports, session replay, alerts, themes and evidence tools.",
    authors: [Yamach],
    tags: ["Voice", "Moderation", "Utility", "Logs", "Yamach"],
    dependencies: ["UserVoiceShow", "MemberListDecoratorsAPI", "MessageDecorationsAPI", "NicknameIconsAPI"],
    start: startYamachVoiceUtilitiesPro,
    stop: stopYamachVoiceUtilitiesPro,

    settings,
    renderNicknameIcon({ userId }) {
        return <MultiRoomMiniBadge userId={userId} />;
    },

    renderMemberListDecorator({ user }) {
        return user?.id ? <MultiRoomMiniBadge userId={user.id} /> : null;
    },

    renderMessageDecoration({ message }) {
        return message?.author?.id ? <MultiRoomMiniBadge userId={message.author.id} /> : null;
    },

    flux: {
        VOICE_STATE_UPDATES: yamachHandleVoiceStateUpdates,
        CONNECTION_OPEN() {
            void yamachStart();
        }
    },

    contextMenus: {
        "channel-context": VoiceChannelContext,
        "user-context": UserContext,
    },
});
