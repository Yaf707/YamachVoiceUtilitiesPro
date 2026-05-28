// Made by Yamach

import type { VoiceMember } from "./types";

const guildSelectionMemory = new Map<string, Set<string>>();
const guildPreviousRoomMemory = new Map<string, Map<string, string>>();


function notifySelectionChange(guildId: string) {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("vc-vcu-selection-change", { detail: { guildId } }));
    }
}

function getGuildSelection(guildId: string) {
    let selected = guildSelectionMemory.get(guildId);
    if (!selected) {
        selected = new Set<string>();
        guildSelectionMemory.set(guildId, selected);
    }

    return selected;
}

function getGuildPreviousRooms(guildId: string) {
    let previousRooms = guildPreviousRoomMemory.get(guildId);
    if (!previousRooms) {
        previousRooms = new Map<string, string>();
        guildPreviousRoomMemory.set(guildId, previousRooms);
    }

    return previousRooms;
}

export function getSelectionSnapshot(guildId: string) {
    return Array.from(getGuildSelection(guildId));
}

export function getSelectionCount(guildId: string) {
    return getGuildSelection(guildId).size;
}

export function hasSelectedUser(guildId: string, userId: string) {
    return getGuildSelection(guildId).has(userId);
}

export function addUsersToSelection(guildId: string, userIds: string[]) {
    const selected = getGuildSelection(guildId);
    userIds.forEach(userId => selected.add(userId));
    notifySelectionChange(guildId);
    return selected.size;
}

export function removeUsersFromSelection(guildId: string, userIds: string[]) {
    const selected = getGuildSelection(guildId);
    userIds.forEach(userId => selected.delete(userId));
    notifySelectionChange(guildId);
    return selected.size;
}

export function toggleUserSelection(guildId: string, userId: string) {
    const selected = getGuildSelection(guildId);
    selected.has(userId) ? selected.delete(userId) : selected.add(userId);
    notifySelectionChange(guildId);
    return selected.has(userId);
}

export function clearSelection(guildId: string) {
    getGuildSelection(guildId).clear();
    notifySelectionChange(guildId);
}

export function retainOnlySelection(guildId: string, validUserIds: Set<string>) {
    const selected = getGuildSelection(guildId);
    let removed = 0;

    for (const userId of Array.from(selected)) {
        if (!validUserIds.has(userId)) {
            selected.delete(userId);
            removed++;
        }
    }

    if (removed) notifySelectionChange(guildId);
    return removed;
}

export function rememberPreviousRooms(guildId: string, members: VoiceMember[]) {
    const previousRooms = getGuildPreviousRooms(guildId);

    for (const member of members) {
        if (member.channelId) previousRooms.set(member.userId, member.channelId);
    }

    return previousRooms.size;
}

export function getPreviousRoom(guildId: string, userId: string) {
    return getGuildPreviousRooms(guildId).get(userId);
}

export function getPreviousRoomSnapshot(guildId: string) {
    return new Map(getGuildPreviousRooms(guildId));
}

export function clearPreviousRooms(guildId: string) {
    getGuildPreviousRooms(guildId).clear();
}
