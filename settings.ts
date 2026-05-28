// Made by Yamach

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

// ─── Enums ────────────────────────────────────────────────────────────────

export const enum UiLanguage {
    English = "en",
    Arabic = "ar",
}

export const enum DefaultPanelScope {
    Current = "current",
    All = "all",
}

export const enum VisualStyle {
    Clean = "clean",
    DiscordLike = "discordLike",
    Premium = "premium",
}

export const enum DistributionMode {
    RoundRobin = "roundRobin",
    Balanced = "balanced",
    Random = "random",
}

export const enum QuickButtonStyle {
    Native = "native",
    Pill = "pill",
    IconText = "iconText",
    IconOnly = "iconOnly",
    Minimal = "minimal",
    Glass = "glass",
    Yamach = "yamach",
}

export const enum QuickButtonIconSet {
    PlusCheck = "plusCheck",
    Bookmark = "bookmark",
    User = "user",
    Pin = "pin",
    Star = "star",
    Crown = "crown",
    Sparkle = "sparkle",
    Target = "target",
    Shield = "shield",
}

export const enum QuickButtonVisibility {
    HoverOnly = "hoverOnly",
    Always = "always",
    SelectedAlways = "selectedAlways",
}

export const enum QuickButtonSize {
    Compact = "compact",
    Normal = "normal",
    Large = "large",
}

export const enum QuickButtonPosition {
    RightSide = "rightSide",
    NearName = "nearName",
}

export const enum QuickButtonSelectedStyle {
    Filled = "filled",
    Outline = "outline",
    Glow = "glow",
}

export const enum QuickButtonAccent {
    Blurple = "blurple",
    Gold = "gold",
    Emerald = "emerald",
    Cyan = "cyan",
    Pink = "pink",
    Red = "red",
}

export const enum ExecutionMode {
    SafeSequential = "safeSequential",
    FastBatched = "fastBatched",
}

export const enum TopPanelButtonStyle {
    IconOnly = "iconOnly",
    IconText = "iconText",
}

export const enum ChannelPullButtonPosition {
    BeforeChat = "beforeChat",
    AfterActions = "afterActions",
}

export const enum PanelDensity {
    Comfortable = "comfortable",
    Compact = "compact",
}

// ─── Settings ─────────────────────────────────────────────────────────────
// Settings are grouped by visual section headers using "▸ NN Section ·" prefixes
// so they remain visually clustered inside the plugin settings list.

export const settings = definePluginSettings({
    // ▸ 01 General ─────────────────────────────────────────────────────────
    language: {
        type: OptionType.SELECT,
        description: "▸ 01 General · Panel/menu language · لغة اللوحة والقوائم",
        options: [
            { label: "English", value: UiLanguage.English, default: true },
            { label: "العربية / Arabic", value: UiLanguage.Arabic },
        ],
    },
    settingsLanguage: {
        type: OptionType.SELECT,
        description: "▸ 01 General · Settings language · لغة الإعدادات",
        options: [
            { label: "English", value: UiLanguage.English, default: true },
            { label: "العربية / Arabic", value: UiLanguage.Arabic },
        ],
    },
    visualStyle: {
        type: OptionType.SELECT,
        description: "▸ 01 General · Visual style for plugin buttons · الشكل العام للأزرار",
        options: [
            { label: "Clean — minimal", value: VisualStyle.Clean },
            { label: "Discord-like — native feel", value: VisualStyle.DiscordLike, default: true },
            { label: "Premium — subtle glow", value: VisualStyle.Premium },
        ],
    },
    panelDensity: {
        type: OptionType.SELECT,
        description: "▸ 01 General · Panel density · كثافة اللوحة",
        options: [
            { label: "Comfortable", value: PanelDensity.Comfortable, default: true },
            { label: "Compact", value: PanelDensity.Compact },
        ],
    },

    // ▸ 02 Panel defaults ──────────────────────────────────────────────────
    defaultPanelScope: {
        type: OptionType.SELECT,
        description: "▸ 02 Panel · Default member source · مصدر الأعضاء الافتراضي",
        options: [
            { label: "Current voice channel", value: DefaultPanelScope.Current },
            { label: "All voice channels", value: DefaultPanelScope.All, default: true },
        ],
    },
    includeSelfByDefault: {
        type: OptionType.BOOLEAN,
        description: "▸ 02 Panel · Include yourself by default · تضمين نفسك",
        default: false,
    },
    includeBotsByDefault: {
        type: OptionType.BOOLEAN,
        description: "▸ 02 Panel · Include bots by default · تضمين البوتات",
        default: false,
    },
    clearSelectionAfterAction: {
        type: OptionType.BOOLEAN,
        description: "▸ 02 Panel · Clear memory after action · مسح التحديد بعد الأمر",
        default: false,
    },
    closePanelAfterAction: {
        type: OptionType.BOOLEAN,
        description: "▸ 02 Panel · Close panel after action · إغلاق اللوحة بعد الأمر",
        default: false,
    },

    // ▸ 03 Voice row buttons ───────────────────────────────────────────────
    showVoiceUserMemoryButton: {
        type: OptionType.BOOLEAN,
        description: "▸ 03 Voice row · Show select button beside each voice user · زر تحديد عند كل عضو",
        default: true,
    },
    showSelfPullToMeButton: {
        type: OptionType.BOOLEAN,
        description: "▸ 03 Voice row · Show pull-to-me button beside your row · زر السحب عندي",
        default: true,
    },
    showChannelPullButton: {
        type: OptionType.BOOLEAN,
        description: "▸ 03 Voice row · Show pull button on voice channel rows · زر السحب على شريط الروم",
        default: true,
    },
    channelPullButtonPosition: {
        type: OptionType.SELECT,
        description: "▸ 03 Voice row · Channel pull button position · مكان زر سحب الروم",
        options: [
            { label: "Left of Chat button · يسار", value: ChannelPullButtonPosition.BeforeChat, default: true },
            { label: "Right of Edit Channel · يمين", value: ChannelPullButtonPosition.AfterActions },
        ],
    },
    quickButtonVisibility: {
        type: OptionType.SELECT,
        description: "▸ 03 Voice row · Visibility behavior · سلوك ظهور الزر",
        options: [
            { label: "Hover only", value: QuickButtonVisibility.HoverOnly },
            { label: "Always visible", value: QuickButtonVisibility.Always },
            { label: "Hover + keep selected", value: QuickButtonVisibility.SelectedAlways, default: true },
        ],
    },
    quickButtonIconSet: {
        type: OptionType.SELECT,
        description: "▸ 03 Voice row · Icon set · مجموعة الأيقونات",
        options: [
            { label: "Plus / Check", value: QuickButtonIconSet.PlusCheck },
            { label: "Bookmark", value: QuickButtonIconSet.Bookmark, default: true },
            { label: "User", value: QuickButtonIconSet.User },
            { label: "Pin", value: QuickButtonIconSet.Pin },
            { label: "Star", value: QuickButtonIconSet.Star },
            { label: "Crown", value: QuickButtonIconSet.Crown },
            { label: "Sparkle", value: QuickButtonIconSet.Sparkle },
            { label: "Target", value: QuickButtonIconSet.Target },
            { label: "Shield", value: QuickButtonIconSet.Shield },
        ],
    },
    quickButtonStyle: {
        type: OptionType.SELECT,
        description: "▸ 03 Voice row · Button shape · شكل الزر",
        options: [
            { label: "Native subtle", value: QuickButtonStyle.Native, default: true },
            { label: "Icon only", value: QuickButtonStyle.IconOnly },
            { label: "Minimal badge", value: QuickButtonStyle.Minimal },
            { label: "Icon + text", value: QuickButtonStyle.IconText },
            { label: "Pill", value: QuickButtonStyle.Pill },
            { label: "Glass neon", value: QuickButtonStyle.Glass },
            { label: "Yamach premium", value: QuickButtonStyle.Yamach },
        ],
    },
    quickButtonSize: {
        type: OptionType.SELECT,
        description: "▸ 03 Voice row · Button size · حجم الزر",
        options: [
            { label: "Compact", value: QuickButtonSize.Compact, default: true },
            { label: "Normal", value: QuickButtonSize.Normal },
            { label: "Large", value: QuickButtonSize.Large },
        ],
    },
    quickButtonPosition: {
        type: OptionType.SELECT,
        description: "▸ 03 Voice row · Button position · مكان الزر",
        options: [
            { label: "Right side", value: QuickButtonPosition.RightSide, default: true },
            { label: "Near username", value: QuickButtonPosition.NearName },
        ],
    },
    quickButtonSelectedStyle: {
        type: OptionType.SELECT,
        description: "▸ 03 Voice row · Selected appearance · شكل حالة التحديد",
        options: [
            { label: "Filled", value: QuickButtonSelectedStyle.Filled },
            { label: "Outline", value: QuickButtonSelectedStyle.Outline, default: true },
            { label: "Glow", value: QuickButtonSelectedStyle.Glow },
        ],
    },
    quickButtonAccent: {
        type: OptionType.SELECT,
        description: "▸ 03 Voice row · Accent color · لون التحديد",
        options: [
            { label: "Blurple", value: QuickButtonAccent.Blurple, default: true },
            { label: "Gold", value: QuickButtonAccent.Gold },
            { label: "Emerald", value: QuickButtonAccent.Emerald },
            { label: "Cyan", value: QuickButtonAccent.Cyan },
            { label: "Pink", value: QuickButtonAccent.Pink },
            { label: "Red", value: QuickButtonAccent.Red },
        ],
    },

    // ▸ 04 Top toolbar ─────────────────────────────────────────────────────
    showTopPanelButton: {
        type: OptionType.BOOLEAN,
        description: "▸ 04 Top bar · Show top Voice Tools button · زر أدوات الصوت في الشريط العلوي",
        default: true,
    },
    topPanelButtonStyle: {
        type: OptionType.SELECT,
        description: "▸ 04 Top bar · Button style · شكل زر الشريط العلوي",
        options: [
            { label: "Icon only", value: TopPanelButtonStyle.IconOnly, default: true },
            { label: "Icon + text", value: TopPanelButtonStyle.IconText },
        ],
    },
    showTopPanelCountBadge: {
        type: OptionType.BOOLEAN,
        description: "▸ 04 Top bar · Show selected count badge · إظهار عدد المحددين",
        default: true,
    },

    // ▸ 05 Actions & performance ───────────────────────────────────────────
    distributionMode: {
        type: OptionType.SELECT,
        description: "▸ 05 Actions · Distribution mode · طريقة التوزيع",
        options: [
            { label: "Round-robin", value: DistributionMode.RoundRobin, default: true },
            { label: "Balance by room size", value: DistributionMode.Balanced },
            { label: "Random", value: DistributionMode.Random },
        ],
    },
    executionMode: {
        type: OptionType.SELECT,
        description: "▸ 05 Actions · Execution speed · سرعة التنفيذ",
        options: [
            { label: "Fast batched · أسرع", value: ExecutionMode.FastBatched, default: true },
            { label: "Safe sequential · أقل 429", value: ExecutionMode.SafeSequential },
        ],
    },
    waitAfter: {
        type: OptionType.SLIDER,
        description: "▸ 05 Actions · Actions per batch · عدد الأوامر في الدفعة",
        default: 25,
        markers: [1, 5, 10, 20, 25, 50, 75, 100],
    },
    waitSeconds: {
        type: OptionType.SLIDER,
        description: "▸ 05 Actions · Wait seconds between batches · انتظار بين الدفعات",
        default: 0.25,
        markers: [0, 0.25, 0.5, 1, 2, 5, 10],
    },
    delayBetweenActionsMs: {
        type: OptionType.SLIDER,
        description: "▸ 05 Actions · Delay between actions (ms) · تأخير بين الأوامر",
        default: 0,
        markers: [0, 50, 100, 250, 500, 1000],
    },
    maxRetries: {
        type: OptionType.SLIDER,
        description: "▸ 05 Actions · Max retries on rate-limit · إعادة محاولة عند 429",
        default: 3,
        markers: [0, 1, 2, 3, 5, 8],
    },
    confirmActions: {
        type: OptionType.BOOLEAN,
        description: "▸ 05 Actions · Confirm before destructive actions · تأكيد قبل الأوامر",
        default: true,
    },
    confirmThreshold: {
        type: OptionType.SLIDER,
        description: "▸ 05 Actions · Always confirm if count exceeds · تأكيد إذا تجاوز العدد",
        default: 1,
        markers: [1, 5, 10, 25, 50, 100],
    },
    enableUndo: {
        type: OptionType.BOOLEAN,
        description: "▸ 05 Actions · Enable Undo for move/pull actions · تفعيل التراجع",
        default: true,
    },

    // ▸ 06 Yamach Command Center ──────────────────────────────────────────
    maxLogEntries: {
        type: OptionType.SLIDER,
        description: "▸ 06 Yamach · Max log entries (auto-prune older) · أقصى عدد للوقات",
        default: 10000,
        markers: [1000, 5000, 10000, 25000, 50000, 100000],
    },
    autoExpireDays: {
        type: OptionType.SLIDER,
        description: "▸ 06 Yamach · Auto delete logs older than X days (0 = off) · حذف اللوقات الأقدم من",
        default: 0,
        markers: [0, 7, 14, 30, 60, 90, 180, 365],
    },
    alertCooldownMinutes: {
        type: OptionType.SLIDER,
        description: "▸ 06 Yamach · Alert cooldown (minutes) · كولداون التنبيهات",
        default: 5,
        markers: [0.5, 1, 2, 5, 10, 15, 30, 60],
    },
    enableSmartAutoPull: {
        type: OptionType.BOOLEAN,
        description: "▸ 06 Yamach · Auto-pull tracked users when they enter voice (requires you in voice) · سحب أوتوماتيك للمتابعين",
        default: false,
    },
    privacyMode: {
        type: OptionType.BOOLEAN,
        description: "▸ 06 Yamach · Privacy mode (mask names in screenshots) · وضع الخصوصية",
        default: false,
    },

    // ▸ 07 Keyboard shortcuts ─────────────────────────────────────────────
    enableKeyboardShortcuts: {
        type: OptionType.BOOLEAN,
        description: "▸ 07 Shortcuts · Enable keyboard shortcuts · تفعيل الاختصارات",
        default: true,
    },
    shortcutOpenPanel: {
        type: OptionType.STRING,
        description: "▸ 07 Shortcuts · Open panel · فتح اللوحة (e.g., ctrl+shift+v)",
        default: "ctrl+shift+v",
    },
    shortcutPullToMe: {
        type: OptionType.STRING,
        description: "▸ 07 Shortcuts · Pull selected to me · سحب المحددين عندي",
        default: "ctrl+shift+p",
    },
    shortcutUndo: {
        type: OptionType.STRING,
        description: "▸ 07 Shortcuts · Undo last action · تراجع",
        default: "ctrl+shift+z",
    },
    shortcutClearSelection: {
        type: OptionType.STRING,
        description: "▸ 07 Shortcuts · Clear selection · مسح التحديد",
        default: "ctrl+shift+x",
    },
});

export default settings;
