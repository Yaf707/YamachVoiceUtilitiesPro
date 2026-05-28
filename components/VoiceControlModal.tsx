// Made by Yamach

import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { React, showToast, Toasts, UserStore } from "@webpack/common";
import type { Channel } from "@vencord/discord-types";

import { createPreset, loadPresets } from "../core/presets";
import { canUndo, getLastUndoEntry, popUndoEntry, pushUndoEntry, subscribeUndo } from "../core/undoStack";
import { dir, t } from "../i18n";
import { addUsersToSelection, clearSelection, getPreviousRoom, getSelectionSnapshot, hasSelectedUser, rememberPreviousRooms, removeUsersFromSelection, retainOnlySelection, toggleUserSelection } from "../selection";
import { DistributionMode, ExecutionMode, settings } from "../settings";
import { MemberPatchBody, ScopeMode, VoiceMember } from "../types";
import { confirmAction, executePatchJobs, getAllVoiceMembers, getCurrentUserVoiceChannel, getGuildVoiceChannelGroups, getGuildVoiceChannels, getSelectedVoiceMembers, getUserLabel, getVoiceStatesForChannel } from "../utils";
import { YamachCommandCenter, consumeYamachFocusUser, consumeYamachMainTab, consumeYamachTab, getYamachThemeClass, getYamachThemeStyle } from "../yamach/YamachCommandCenter";

interface VoiceControlModalProps {
    rootProps: ModalProps;
    channel: Channel;
    initialScope: ScopeMode;
}

function channelCount(channelId: string) {
    return Object.keys(getVoiceStatesForChannel(channelId)).length;
}

function memberMatchesQuery(member: VoiceMember, query: string) {
    if (!query) return true;

    const normalized = query.toLowerCase();
    return member.label.toLowerCase().includes(normalized)
        || member.channelName.toLowerCase().includes(normalized)
        || member.userId.includes(normalized);
}

function ActionButton({ children, onClick, disabled = false, danger = false, primary = false }: {
    children: React.ReactNode;
    onClick(): void;
    disabled?: boolean;
    danger?: boolean;
    primary?: boolean;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            className={`vc-vcu-action-btn ${primary ? "vc-vcu-action-primary" : ""} ${danger ? "vc-vcu-action-danger" : ""}`}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function ChipButton({ active, children, onClick, danger = false, disabled = false }: {
    active?: boolean;
    children: React.ReactNode;
    onClick(): void;
    danger?: boolean;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            className={`vc-vcu-chip ${active ? "vc-vcu-chip-active" : ""} ${danger ? "vc-vcu-chip-danger" : ""}`}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SectionTitle({ children }: { children: React.ReactNode; }) {
    return <h3 className="vc-vcu-section-title">{children}</h3>;
}

function SmallTitle({ children }: { children: React.ReactNode; }) {
    return <h4 className="vc-vcu-small-title">{children}</h4>;
}

function StatCard({ label, value, muted = false, accent = false, icon }: { label: string; value: number | string; muted?: boolean; accent?: boolean; icon?: string; }) {
    return (
        <div className={`vc-vcu-stat ${muted ? "vc-vcu-stat-muted" : ""} ${accent ? "vc-vcu-stat-accent" : ""}`}>
            {icon && <span className="vc-vcu-stat-icon" aria-hidden="true">{icon}</span>}
            <div className="vc-vcu-stat-body">
                <strong>{value}</strong>
                <span>{label}</span>
            </div>
        </div>
    );
}

function ExecutionModeBadge() {
    const mode = settings.store.executionMode ?? ExecutionMode.FastBatched;
    const label = mode === ExecutionMode.FastBatched ? `🚀 Fast` : `🛡️ Safe`;
    const tone = mode === ExecutionMode.FastBatched ? "fast" : "safe";
    const concurrency = settings.store.waitAfter ?? 25;

    return (
        <span className={`vc-vcu-exec-badge vc-vcu-exec-${tone}`} title={`Execution: ${mode} · concurrency ${concurrency}`}>
            {label} · {concurrency}x
        </span>
    );
}

function QuickActionBar({
    selectedCount,
    onPullToMe,
    onClearSelection,
    onRefresh,
    canPullToMe,
}: {
    selectedCount: number;
    onPullToMe(): void;
    onClearSelection(): void;
    onRefresh(): void;
    canPullToMe: boolean;
}) {
    return (
        <div className="vc-vcu-quickbar" dir="auto">
            <div className="vc-vcu-quickbar-left">
                <span className="vc-vcu-quickbar-counter">
                    <strong>{selectedCount}</strong>
                    <span>{t("selectedMembers")}</span>
                </span>
                <ExecutionModeBadge />
            </div>
            <div className="vc-vcu-quickbar-right">
                <button className="vc-vcu-quickbar-btn vc-vcu-quickbar-primary" onClick={onPullToMe} disabled={!selectedCount || !canPullToMe}>
                    ⬇ {t("pullSelectedToMe")}
                </button>
                <button className="vc-vcu-quickbar-btn" onClick={onRefresh} title={t("refresh")}>↻</button>
                <button className="vc-vcu-quickbar-btn vc-vcu-quickbar-danger" onClick={onClearSelection} disabled={!selectedCount} title={t("clearSelected")}>✕</button>
            </div>
        </div>
    );
}

function getMemberAvatarUrl(guildId: string, userId: string) {
    const user = UserStore.getUser(userId) as any;
    return user?.getAvatarURL?.(guildId, 40)
        ?? user?.getAvatarURL?.(undefined, 40)
        ?? user?.avatarURL
        ?? "";
}

function MemberAvatar({ guildId, member }: { guildId: string; member: VoiceMember; }) {
    const avatarUrl = getMemberAvatarUrl(guildId, member.userId);
    const fallback = (member.label || "?").trim().slice(0, 1).toUpperCase();

    return (
        <span className="vc-vcu-avatar" aria-hidden="true">
            {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{fallback}</span>}
        </span>
    );
}

function MemberRow({ guildId, member, selected, onToggle }: {
    guildId: string;
    member: VoiceMember;
    selected: boolean;
    onToggle(): void;
}) {
    const inVoice = member.inVoice !== false;

    return (
        <button
            type="button"
            className={`vc-vcu-member-row ${selected ? "vc-vcu-member-selected" : ""} ${!inVoice ? "vc-vcu-member-offline" : ""}`}
            onClick={() => {
                toggleUserSelection(guildId, member.userId);
                onToggle();
            }}
            aria-pressed={selected}
        >
            <span className="vc-vcu-check">{selected ? "\u2713" : ""}</span>
            <MemberAvatar guildId={guildId} member={member} />
            <span className="vc-vcu-member-main">
                <span className="vc-vcu-member-name">{member.label}</span>
                <span className="vc-vcu-member-sub">{t("room")}: {member.channelName}</span>
                <span className="vc-vcu-member-id">{member.userId}</span>
            </span>
            <span className="vc-vcu-badges">
                {!inVoice && <span className="vc-vcu-badge vc-vcu-badge-warn">{t("notInVoice")}</span>}
                {member.isSelf && <span className="vc-vcu-badge">{t("you")}</span>}
                {member.isBot && <span className="vc-vcu-badge">{t("bot")}</span>}
                {member.muted && <span className="vc-vcu-badge">{t("muted")}</span>}
                {member.deafened && <span className="vc-vcu-badge">{t("deafened")}</span>}
            </span>
        </button>
    );
}

function RestoreChoiceRow({ guildId, member, previousRoomName, checked, onToggle }: {
    guildId: string;
    member: VoiceMember;
    previousRoomName: string;
    checked: boolean;
    onToggle(): void;
}) {
    return (
        <button
            type="button"
            className={`vc-vcu-restore-row ${checked ? "vc-vcu-restore-row-selected" : ""}`}
            onClick={onToggle}
            aria-pressed={checked}
        >
            <span className="vc-vcu-check vc-vcu-restore-check">{checked ? "\u2713" : ""}</span>
            <MemberAvatar guildId={guildId} member={member} />
            <span className="vc-vcu-member-main">
                <span className="vc-vcu-member-name">{member.label}</span>
                <span className="vc-vcu-member-sub">#{member.channelName} → #{previousRoomName}</span>
            </span>
        </button>
    );
}

export function VoiceControlModal({ rootProps, channel, initialScope }: VoiceControlModalProps) {
    const guildId = channel.guild_id;
    const [version, setVersion] = React.useState(0);
    const [mainMode, setMainMode] = React.useState<"control" | "yamach">(() => consumeYamachMainTab());
    const initialYamachUserId = React.useMemo(() => consumeYamachFocusUser(), []);
    const initialYamachTab = React.useMemo(() => consumeYamachTab(), []);
    const bump = () => setVersion(v => v + 1);

    const voiceChannels = React.useMemo(() => getGuildVoiceChannels(guildId), [guildId, version]);
    const voiceChannelGroups = React.useMemo(() => getGuildVoiceChannelGroups(guildId), [guildId, version]);
    const myVoiceChannel = React.useMemo(() => getCurrentUserVoiceChannel(guildId), [guildId, version]);
    const allMembers = React.useMemo(() => getAllVoiceMembers(guildId), [guildId, version]);
    const firstTargetId = voiceChannels.find(voiceChannel => voiceChannel.id !== channel.id)?.id ?? voiceChannels[0]?.id ?? "";

    const [scope, setScope] = React.useState<ScopeMode>(initialScope);
    const [query, setQuery] = React.useState("");
    const [manualUserId, setManualUserId] = React.useState("");
    const [includeSelf, setIncludeSelf] = React.useState(settings.store.includeSelfByDefault);
    const [includeBots, setIncludeBots] = React.useState(settings.store.includeBotsByDefault);
    const [targetChannelId, setTargetChannelId] = React.useState(firstTargetId);
    const [distributionTargetIds, setDistributionTargetIds] = React.useState<Set<string>>(new Set(firstTargetId ? [firstTargetId] : []));
    const [restoreChoiceIds, setRestoreChoiceIds] = React.useState<Set<string>>(new Set());

    const selectedIds = new Set(getSelectionSnapshot(guildId));
    const validVoiceUserIds = new Set(allMembers.map(member => member.userId));
    const selectedOnlineMembers = allMembers.filter(member => selectedIds.has(member.userId));
    const staleSelectionCount = Array.from(selectedIds).filter(userId => !validVoiceUserIds.has(userId)).length;
    const memoryOnlyMembers: VoiceMember[] = Array.from(selectedIds)
        .filter(userId => !validVoiceUserIds.has(userId))
        .map(userId => ({
            userId,
            label: getUserLabel(userId),
            channelId: "__memory_only__",
            channelName: t("notInVoice"),
            isSelf: false,
            isBot: false,
            muted: false,
            deafened: false,
            inVoice: false,
        }));

    const restorableMembers = selectedOnlineMembers.filter(member => {
        const previousRoom = getPreviousRoom(guildId, member.userId);
        return Boolean(previousRoom && previousRoom !== member.channelId);
    });
    const restorableSelectionCount = restorableMembers.length;
    const chosenRestorableMembers = restorableMembers.filter(member => restoreChoiceIds.has(member.userId));
    const restorableUserIdKey = restorableMembers.map(member => member.userId).join("|");

    React.useEffect(() => {
        setRestoreChoiceIds(previous => {
            const validUserIds = new Set(restorableMembers.map(member => member.userId));
            const next = new Set(Array.from(previous).filter(userId => validUserIds.has(userId)));
            return next.size === previous.size ? previous : next;
        });
    }, [guildId, restorableUserIdKey]);

    // Listen for preset-apply events (from Presets tab in Yamach Command Center)
    React.useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent<{ userIds: string[]; name: string; }>).detail;
            if (!detail?.userIds?.length) return;
            addUsersToSelection(guildId, detail.userIds);
            setScope("selected");
            bump();
            showToast(`${t("presetLoaded")}: ${detail.name} (${detail.userIds.length})`, Toasts.Type.SUCCESS);
        };
        window.addEventListener("vc-yvu-preset-apply", handler as EventListener);
        void loadPresets();
        return () => window.removeEventListener("vc-yvu-preset-apply", handler as EventListener);
    }, [guildId]);

    // Subscribe to undo stack changes so the undo bar refreshes
    const [, forceUndo] = React.useState(0);
    React.useEffect(() => subscribeUndo(() => forceUndo(value => value + 1)), []);
    const lastUndo = getLastUndoEntry(guildId);

    function applyUndo() {
        const entry = popUndoEntry();
        if (!entry) {
            showToast(t("nothingToUndo"), Toasts.Type.FAILURE);
            return;
        }
        executePatchJobs(entry.guildId, entry.reverseJobs, `${t("undo")} · ${entry.label}`).then(success => {
            showToast(success ? t("undoSuccess") : t("undoFail"), success ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE);
            if (success) setTimeout(bump, 600);
        });
    }

    function savePresetFromSelection() {
        if (!selectedIds.size) {
            showToast(t("noSelectionToast"), Toasts.Type.FAILURE);
            return;
        }
        const defaultName = `Preset ${new Date().toLocaleString()}`;
        const name = window.prompt(t("presetName"), defaultName);
        if (!name) return;
        createPreset({ name, guildId, userIds: [...selectedIds] });
        showToast(`${t("presetSaved")} (${selectedIds.size})`, Toasts.Type.SUCCESS);
    }

    const sourceMembers = scope === "selected" ? [...allMembers, ...memoryOnlyMembers] : allMembers;
    const visibleMembers = sourceMembers.filter(member => {
        if (scope === "current" && member.channelId !== channel.id) return false;
        if (scope === "selected" && !selectedIds.has(member.userId)) return false;
        if (!includeSelf && member.isSelf) return false;
        if (!includeBots && member.isBot) return false;
        return memberMatchesQuery(member, query.trim());
    });

    const groupedMembers = [
        ...voiceChannels.map(voiceChannel => ({
            id: voiceChannel.id,
            name: `#${voiceChannel.name}`,
            members: visibleMembers.filter(member => member.channelId === voiceChannel.id),
        })),
        {
            id: "__memory_only__",
            name: t("notInVoice"),
            members: visibleMembers.filter(member => member.inVoice === false),
        },
    ].filter(group => group.members.length > 0);

    const targetChannel = voiceChannels.find(voiceChannel => voiceChannel.id === targetChannelId);

    function afterSuccessfulAction(ok: boolean) {
        if (!ok) return;

        if (settings.store.clearSelectionAfterAction) {
            clearSelection(guildId);
            bump();
        }

        setTimeout(bump, 650);

        if (settings.store.closePanelAfterAction) {
            rootProps.onClose();
        }
    }

    function runSelectedAction(actionLabel: string, bodyFactory: (member: VoiceMember, index: number) => MemberPatchBody) {
        const members = getSelectedVoiceMembers(guildId, getSelectionSnapshot(guildId));

        if (!members.length) {
            showToast(t("noSelectionToast"), Toasts.Type.FAILURE);
            return;
        }

        confirmAction(actionLabel, members.length, () => {
            const jobs = members.map((member, index) => ({
                userId: member.userId,
                body: bodyFactory(member, index),
            }));

            executePatchJobs(guildId, jobs, actionLabel).then(afterSuccessfulAction);
        });
    }

    function captureUndoForMembers(label: string, members: VoiceMember[]) {
        if (!settings.store.enableUndo || !members.length) return;
        const reverseJobs = members
            .filter(member => member.channelId && member.channelId !== "__memory_only__")
            .map(member => ({ userId: member.userId, body: { channel_id: member.channelId } as MemberPatchBody }));
        if (!reverseJobs.length) return;
        pushUndoEntry({ label, guildId, reverseJobs });
    }

    function moveSelected() {
        if (!targetChannelId) {
            showToast(t("noTargetToast"), Toasts.Type.FAILURE);
            return;
        }

        const selectedMembers = getSelectedVoiceMembers(guildId, getSelectionSnapshot(guildId));
        rememberPreviousRooms(guildId, selectedMembers);
        captureUndoForMembers(`${t("moveTo")} #${targetChannel?.name ?? targetChannelId}`, selectedMembers);

        const label = `${t("moveTo")} #${targetChannel?.name ?? targetChannelId}`;
        runSelectedAction(label, () => ({ channel_id: targetChannelId }));
    }


    function pullSelectedToMe() {
        if (!myVoiceChannel) {
            showToast(t("noMyVoiceChannelToast"), Toasts.Type.FAILURE);
            return;
        }

        const selectedMembers = getSelectedVoiceMembers(guildId, getSelectionSnapshot(guildId))
            .filter(member => member.channelId !== myVoiceChannel.id);

        if (!selectedMembers.length) {
            showToast(t("noMovableToMeToast"), Toasts.Type.FAILURE);
            return;
        }

        rememberPreviousRooms(guildId, selectedMembers);
        captureUndoForMembers(`${t("pullSelectedToMe")} #${myVoiceChannel.name}`, selectedMembers);
        const label = `${t("pullSelectedToMe")} #${myVoiceChannel.name}`;

        confirmAction(label, selectedMembers.length, () => {
            executePatchJobs(
                guildId,
                selectedMembers.map(member => ({
                    userId: member.userId,
                    body: { channel_id: myVoiceChannel.id },
                })),
                label
            ).then(afterSuccessfulAction);
        });
    }

    function getBalancedDistributionTarget(targetIds: string[], counts: Map<string, number>) {
        let bestTargetId = targetIds[0];

        for (const targetId of targetIds) {
            if ((counts.get(targetId) ?? 0) < (counts.get(bestTargetId) ?? 0)) {
                bestTargetId = targetId;
            }
        }

        counts.set(bestTargetId, (counts.get(bestTargetId) ?? 0) + 1);
        return bestTargetId;
    }

    function distributeSelected() {
        const targetIds = Array.from(distributionTargetIds);
        if (targetIds.length < 2) {
            showToast(t("twoTargetsToast"), Toasts.Type.FAILURE);
            return;
        }

        const targetNames = targetIds
            .map(targetId => voiceChannels.find(voiceChannel => voiceChannel.id === targetId)?.name ?? targetId)
            .join(", ");
        const counts = new Map(targetIds.map(targetId => [targetId, channelCount(targetId)]));
        const selectedMembers = getSelectedVoiceMembers(guildId, getSelectionSnapshot(guildId));
        rememberPreviousRooms(guildId, selectedMembers);
        captureUndoForMembers(`${t("distributeTo")} ${targetNames}`, selectedMembers);

        const shuffled = [...targetIds].sort(() => Math.random() - 0.5);
        runSelectedAction(`${t("distributeTo")} ${targetNames}`, (_, index) => ({
            channel_id: settings.store.distributionMode === DistributionMode.Balanced
                ? getBalancedDistributionTarget(targetIds, counts)
                : settings.store.distributionMode === DistributionMode.Random
                    ? shuffled[index % shuffled.length]
                    : targetIds[index % targetIds.length],
        }));
    }

    function toggleRestoreChoice(userId: string) {
        setRestoreChoiceIds(previous => {
            const next = new Set(previous);
            next.has(userId) ? next.delete(userId) : next.add(userId);
            return next;
        });
    }

    function selectAllRestorable() {
        setRestoreChoiceIds(new Set(restorableMembers.map(member => member.userId)));
    }

    function clearRestoreChoices() {
        setRestoreChoiceIds(new Set());
    }

    function restoreChosenPreviousRooms() {
        if (!restorableMembers.length) {
            showToast(t("noPreviousRoomsToast"), Toasts.Type.FAILURE);
            return;
        }

        if (!chosenRestorableMembers.length) {
            showToast(t("noRestoreChoicesToast"), Toasts.Type.FAILURE);
            return;
        }

        confirmAction(t("restoreChosen"), chosenRestorableMembers.length, () => {
            const jobs = chosenRestorableMembers.map(member => ({
                userId: member.userId,
                body: { channel_id: getPreviousRoom(guildId, member.userId)! },
            }));

            executePatchJobs(guildId, jobs, t("restoreChosen")).then(ok => {
                if (ok) clearRestoreChoices();
                afterSuccessfulAction(ok);
            });
        });
    }

    function addVisible() {
        addUsersToSelection(guildId, visibleMembers.map(member => member.userId));
        showToast(`${t("addedToast")} (${visibleMembers.length})`, Toasts.Type.SUCCESS);
        bump();
    }

    function removeVisible() {
        removeUsersFromSelection(guildId, visibleMembers.map(member => member.userId));
        showToast(`${t("removedToast")} (${visibleMembers.length})`, Toasts.Type.SUCCESS);
        bump();
    }

    function invertVisible() {
        visibleMembers.forEach(member => toggleUserSelection(guildId, member.userId));
        bump();
    }

    function cleanupOffline() {
        const removed = retainOnlySelection(guildId, validVoiceUserIds);
        showToast(`${t("cleanedToast")} (${removed})`, Toasts.Type.SUCCESS);
        bump();
    }

    function clearAllSelected() {
        clearSelection(guildId);
        showToast(t("clearedToast"), Toasts.Type.SUCCESS);
        bump();
    }

    function addManualUser() {
        const match = manualUserId.match(/\d{15,25}/);
        if (!match) {
            showToast(t("noGuildToast"), Toasts.Type.FAILURE);
            return;
        }

        addUsersToSelection(guildId, [match[0]]);
        setManualUserId("");
        setScope("selected");
        showToast(t("userAddedToast"), Toasts.Type.SUCCESS);
        bump();
    }

    function toggleDistributionTarget(channelId: string) {
        setDistributionTargetIds(prev => {
            const next = new Set(prev);
            next.has(channelId) ? next.delete(channelId) : next.add(channelId);
            return next;
        });
    }

    function categoryChannelIds(categoryChannels: Channel[]) {
        return categoryChannels.map(categoryChannel => categoryChannel.id);
    }

    function isCategoryFullySelected(categoryChannels: Channel[]) {
        const ids = categoryChannelIds(categoryChannels);
        return ids.length > 0 && ids.every(channelId => distributionTargetIds.has(channelId));
    }

    function isCategoryPartiallySelected(categoryChannels: Channel[]) {
        const ids = categoryChannelIds(categoryChannels);
        return ids.some(channelId => distributionTargetIds.has(channelId)) && !ids.every(channelId => distributionTargetIds.has(channelId));
    }

    function toggleDistributionCategory(categoryChannels: Channel[]) {
        const ids = categoryChannelIds(categoryChannels);
        const shouldRemove = ids.length > 0 && ids.every(channelId => distributionTargetIds.has(channelId));

        setDistributionTargetIds(previous => {
            const next = new Set(previous);
            ids.forEach(channelId => shouldRemove ? next.delete(channelId) : next.add(channelId));
            return next;
        });
    }

    return (
        <ModalRoot {...rootProps} size={ModalSize.LARGE} className={`vc-vcu-root ${getYamachThemeClass()}`} style={getYamachThemeStyle()} data-vc-vcu-visual-style={settings.store.visualStyle}>
            <ModalHeader className="vc-vcu-header" style={{ background: "var(--yvu-bg, #080a12)", color: "#ffffff", borderBottom: "1px solid color-mix(in srgb, var(--yvu-accent, #f0b232) 32%, transparent)" }}>
                <div className="vc-vcu-title-wrap" dir={dir()}>
                    <h2 className="vc-vcu-title">{t("panelTitle")}</h2>
                    <p className="vc-vcu-subtitle">{t("panelSubtitle")}</p>
                </div>
                <ModalCloseButton onClick={rootProps.onClose} />
            </ModalHeader>

            <ModalContent className="vc-vcu-modal" dir={dir()} style={{ background: "var(--yvu-bg, #0b0d16)", color: "#ffffff" }}>
                {mainMode === "control" && (
                    <QuickActionBar
                        selectedCount={selectedOnlineMembers.length}
                        onPullToMe={pullSelectedToMe}
                        onClearSelection={clearAllSelected}
                        onRefresh={bump}
                        canPullToMe={Boolean(myVoiceChannel)}
                    />
                )}

                {mainMode === "control" && settings.store.enableUndo && canUndo(guildId) && lastUndo ? (
                    <div className="vc-yvu-undo-bar" dir="auto">
                        <span>
                            ⏪ <strong>{t("undoLabel")}:</strong> {lastUndo.label}
                            <span className="vc-vcu-muted"> · {lastUndo.reverseJobs.length} {t("selectedMembers").toLowerCase()}</span>
                        </span>
                        <button onClick={applyUndo}>{t("undo")}</button>
                    </div>
                ) : null}

                <div className="vc-vcu-stats">
                    <StatCard icon="👁" label={t("visibleMembers")} value={visibleMembers.length} />
                    <StatCard icon="✓" label={t("selectedMembers")} value={selectedIds.size} accent />
                    <StatCard icon="🎙" label={t("selectedOnline")} value={selectedOnlineMembers.length} />
                    <StatCard icon="⏸" label={t("staleSelected")} value={staleSelectionCount} muted />
                    <StatCard icon="↩" label={t("canRestore")} value={restorableSelectionCount} />
                </div>

                <div className="vc-yvu-switcher vc-yvu-main-switch" dir="auto">
                    <button className={mainMode === "control" ? "vc-yvu-switch-active" : ""} onClick={() => setMainMode("control")}>🎚 {t("voiceControlTab")}</button>
                    <button className={mainMode === "yamach" ? "vc-yvu-switch-active" : ""} onClick={() => setMainMode("yamach")}>🛰 Yamach Command Center</button>
                </div>

                {mainMode === "yamach" ? (
                    <YamachCommandCenter guildId={guildId} channel={channel} focusUserId={initialYamachUserId} initialTab={initialYamachTab} selectedUserIds={[...selectedIds]} />
                ) : (
                <div className="vc-vcu-grid">
                    <aside className="vc-vcu-panel vc-vcu-side-panel">
                        <SectionTitle>{t("memoryTitle")}</SectionTitle>

                        <div className="vc-vcu-chip-row">
                            <ChipButton active={scope === "all"} onClick={() => setScope("all")}>{t("scopeAll")}</ChipButton>
                            <ChipButton active={scope === "current"} onClick={() => setScope("current")}>{t("scopeCurrent")}</ChipButton>
                            <ChipButton active={scope === "selected"} onClick={() => setScope("selected")}>{t("scopeSelected")}</ChipButton>
                        </div>

                        <div className="vc-vcu-filter-stack">
                            <label className="vc-vcu-toggle">
                                <input type="checkbox" checked={includeSelf} onChange={() => setIncludeSelf(v => !v)} />
                                <span>{t("includeMe")}</span>
                            </label>
                            <label className="vc-vcu-toggle">
                                <input type="checkbox" checked={includeBots} onChange={() => setIncludeBots(v => !v)} />
                                <span>{t("includeBots")}</span>
                            </label>
                        </div>

                        <div className="vc-vcu-manual-add">
                            <input
                                className="vc-vcu-native-input"
                                placeholder={t("userIdPlaceholder")}
                                value={manualUserId}
                                onChange={event => setManualUserId(event.currentTarget.value)}
                                onKeyDown={event => {
                                    if (event.key === "Enter") addManualUser();
                                }}
                            />
                            <ChipButton onClick={addManualUser}>{t("addUserId")}</ChipButton>
                            <p className="vc-vcu-hint">{t("memoryOnlyHint")}</p>
                        </div>

                        <div className="vc-vcu-chip-row vc-vcu-column-actions">
                            <ChipButton onClick={addVisible}>{t("selectVisible")}</ChipButton>
                            <ChipButton onClick={removeVisible}>{t("removeVisible")}</ChipButton>
                            <ChipButton onClick={invertVisible}>{t("invertVisible")}</ChipButton>
                            <ChipButton onClick={cleanupOffline}>{t("cleanupOffline")}</ChipButton>
                            <ChipButton danger onClick={clearAllSelected}>{t("clearSelected")}</ChipButton>
                            <ChipButton onClick={bump}>{t("refresh")}</ChipButton>
                            <ChipButton onClick={savePresetFromSelection} disabled={!selectedIds.size}>📌 {t("savePreset")}</ChipButton>
                        </div>
                    </aside>

                    <main className="vc-vcu-panel vc-vcu-member-panel">
                        <input
                            className="vc-vcu-search vc-vcu-native-input"
                            placeholder={t("searchPlaceholder")}
                            value={query}
                            onChange={event => setQuery(event.currentTarget.value)}
                        />

                        <div className="vc-vcu-member-list">
                            {groupedMembers.length ? groupedMembers.map(group => (
                                <section key={group.id} className="vc-vcu-channel-group">
                                    <div className="vc-vcu-channel-heading">
                                        <span>{group.name}</span>
                                        <span>{group.members.length}</span>
                                    </div>
                                    {group.members.map(member => (
                                        <MemberRow
                                            key={member.userId}
                                            guildId={guildId}
                                            member={member}
                                            selected={hasSelectedUser(guildId, member.userId)}
                                            onToggle={bump}
                                        />
                                    ))}
                                </section>
                            )) : (
                                <div className="vc-vcu-empty">{t("noMembers")}</div>
                            )}
                        </div>
                    </main>

                    <aside className="vc-vcu-panel vc-vcu-actions-panel">
                        <SectionTitle>{t("actionsTitle")}</SectionTitle>
                        <p className="vc-vcu-hint">{t("targetHint")}</p>

                        <div className="vc-vcu-target-section vc-vcu-pull-me-section">
                            <SmallTitle>{t("pullToMeTitle")}</SmallTitle>
                            <p className="vc-vcu-hint">
                                {myVoiceChannel ? `${t("myRoom")}: #${myVoiceChannel.name}` : t("noMyVoiceChannelToast")}
                            </p>
                            <ActionButton primary onClick={pullSelectedToMe} disabled={!selectedOnlineMembers.length || !myVoiceChannel}>{t("pullSelectedToMe")}</ActionButton>
                        </div>

                        <div className="vc-vcu-target-section vc-vcu-restore-section">
                            <SmallTitle>{t("restorePickerTitle")}</SmallTitle>
                            <p className="vc-vcu-hint">{t("restorePickerHint")}</p>
                            <div className="vc-vcu-restore-toolbar">
                                <ChipButton onClick={selectAllRestorable} disabled={!restorableMembers.length}>{t("restoreSelectAll")}</ChipButton>
                                <ChipButton onClick={clearRestoreChoices} disabled={!restoreChoiceIds.size}>{t("restoreClearChoices")}</ChipButton>
                            </div>
                            {restorableMembers.length ? (
                                <div className="vc-vcu-restore-list">
                                    {restorableMembers.map(member => {
                                        const previousRoomId = getPreviousRoom(guildId, member.userId);
                                        const previousRoomName = voiceChannels.find(voiceChannel => voiceChannel.id === previousRoomId)?.name ?? previousRoomId ?? t("notInVoice");

                                        return (
                                            <RestoreChoiceRow
                                                key={member.userId}
                                                guildId={guildId}
                                                member={member}
                                                previousRoomName={previousRoomName}
                                                checked={restoreChoiceIds.has(member.userId)}
                                                onToggle={() => toggleRestoreChoice(member.userId)}
                                            />
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="vc-vcu-empty vc-vcu-empty-small">{t("restoreNone")}</div>
                            )}
                            <ActionButton onClick={restoreChosenPreviousRooms} disabled={!chosenRestorableMembers.length}>
                                {t("restoreChosen")}{chosenRestorableMembers.length ? ` (${chosenRestorableMembers.length})` : ""}
                            </ActionButton>
                        </div>

                        <div className="vc-vcu-target-section">
                            <SmallTitle>{t("targetRoom")}</SmallTitle>
                            <div className="vc-vcu-target-list">
                                {voiceChannels.map(voiceChannel => (
                                    <ChipButton
                                        key={voiceChannel.id}
                                        active={targetChannelId === voiceChannel.id}
                                        onClick={() => setTargetChannelId(voiceChannel.id)}
                                    >
                                        #{voiceChannel.name} - {channelCount(voiceChannel.id)}
                                    </ChipButton>
                                ))}
                            </div>
                            <ActionButton primary onClick={moveSelected} disabled={!selectedOnlineMembers.length || !targetChannelId}>{t("moveSelected")}</ActionButton>
                        </div>

                        <div className="vc-vcu-target-section vc-vcu-distribution-section">
                            <SmallTitle>{t("targetRooms")}</SmallTitle>
                            <p className="vc-vcu-hint">{t("distributionCategoryHint")}</p>
                            <div className="vc-vcu-distribution-summary">
                                {t("distributionSelectedCount")}: <strong>{distributionTargetIds.size}</strong>
                            </div>
                            <div className="vc-vcu-category-list">
                                {voiceChannelGroups.map(group => {
                                    const full = isCategoryFullySelected(group.channels);
                                    const partial = isCategoryPartiallySelected(group.channels);

                                    return (
                                        <section key={group.id} className={`vc-vcu-category-card ${full ? "vc-vcu-category-selected" : ""} ${partial ? "vc-vcu-category-partial" : ""}`}>
                                            <button
                                                type="button"
                                                className="vc-vcu-category-header"
                                                onClick={() => toggleDistributionCategory(group.channels)}
                                                aria-pressed={full}
                                            >
                                                <span className="vc-vcu-category-name">{group.name}</span>
                                                <span className="vc-vcu-category-meta">
                                                    {group.channels.length} · {full ? t("categoryClear") : t("categorySelectAll")}
                                                </span>
                                            </button>
                                            <div className="vc-vcu-category-channels">
                                                {group.channels.map(voiceChannel => (
                                                    <ChipButton
                                                        key={voiceChannel.id}
                                                        active={distributionTargetIds.has(voiceChannel.id)}
                                                        onClick={() => toggleDistributionTarget(voiceChannel.id)}
                                                    >
                                                        #{voiceChannel.name} - {channelCount(voiceChannel.id)}
                                                    </ChipButton>
                                                ))}
                                            </div>
                                        </section>
                                    );
                                })}
                            </div>
                            <p className="vc-vcu-hint">{t("distributionHint")}</p>
                            <ActionButton primary onClick={distributeSelected} disabled={selectedOnlineMembers.length === 0 || distributionTargetIds.size < 2}>{t("distributeSelected")}</ActionButton>
                        </div>

                        <div className="vc-vcu-button-grid">
                            <ActionButton danger onClick={() => runSelectedAction(t("disconnect"), () => ({ channel_id: null }))} disabled={!selectedOnlineMembers.length}>⏏ {t("disconnectSelected")}</ActionButton>
                            <ActionButton onClick={() => runSelectedAction(t("mute"), () => ({ mute: true }))} disabled={!selectedOnlineMembers.length}>🔇 {t("muteSelected")}</ActionButton>
                            <ActionButton onClick={() => runSelectedAction(t("unmute"), () => ({ mute: false }))} disabled={!selectedOnlineMembers.length}>🔊 {t("unmuteSelected")}</ActionButton>
                            <ActionButton onClick={() => runSelectedAction(t("deafen"), () => ({ deaf: true }))} disabled={!selectedOnlineMembers.length}>🙉 {t("deafenSelected")}</ActionButton>
                            <ActionButton onClick={() => runSelectedAction(t("undeafen"), () => ({ deaf: false }))} disabled={!selectedOnlineMembers.length}>👂 {t("undeafenSelected")}</ActionButton>
                        </div>
                    </aside>
                </div>
                )}
            </ModalContent>

            <ModalFooter className="vc-vcu-footer" style={{ background: "#080a12", color: "#ffffff", borderTop: "1px solid #31384f" }}>
                <span className="vc-vcu-footer-credit">{t("madeBy")}</span>
                <ActionButton onClick={rootProps.onClose}>{t("close")}</ActionButton>
            </ModalFooter>
        </ModalRoot>
    );
}
