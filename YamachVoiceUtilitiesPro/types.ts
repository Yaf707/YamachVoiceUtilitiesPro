// Made by Yamach

export type MemberPatchBody = Partial<{
    channel_id: string | null;
    mute: boolean;
    deaf: boolean;
}>;

export type VoiceState = {
    userId?: string;
    channelId?: string;
    channel_id?: string;
    mute?: boolean;
    deaf?: boolean;
    selfMute?: boolean;
    selfDeaf?: boolean;
};

export type VoiceMember = {
    userId: string;
    label: string;
    channelId: string;
    channelName: string;
    isSelf: boolean;
    isBot: boolean;
    muted: boolean;
    deafened: boolean;
    inVoice?: boolean;
};

export type PatchJob = {
    userId: string;
    body: MemberPatchBody;
};

export type ScopeMode = "current" | "all" | "selected";

export type VoiceChannelGroup = {
    id: string;
    name: string;
    channels: any[];
};
