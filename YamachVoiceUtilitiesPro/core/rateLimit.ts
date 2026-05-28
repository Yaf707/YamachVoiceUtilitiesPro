// Made by Yamach - Smart rate-limit aware executor

import { RestAPI, showToast, Toasts } from "@webpack/common";

import { t } from "../i18n";
import { PatchJob } from "../types";

export type RateLimitOptions = {
    batchSize: number;
    waitBetweenBatchesSec: number;
    delayBetweenActionsMs: number;
    fastMode: boolean;
    maxRetries: number;
};

export type ExecutionResult = {
    success: number;
    failed: number;
    rateLimited: number;
    totalMs: number;
    errors: Array<{ userId: string; status?: number; reason: unknown; }>;
};

export type ProgressCallback = (current: number, total: number) => void;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function jitter(base: number, jitterMs = 80) {
    return Math.max(0, base + Math.floor((Math.random() * 2 - 1) * jitterMs));
}

function isRateLimit(error: any) {
    const status = error?.status ?? error?.response?.status;
    return status === 429;
}

function getRetryAfterMs(error: any) {
    const headers = error?.headers ?? error?.response?.headers ?? {};
    const body = error?.body ?? error?.response?.body ?? error?.data ?? null;
    const rawHeader =
        headers["retry-after"]
        ?? headers["Retry-After"]
        ?? headers["x-ratelimit-reset-after"]
        ?? headers["X-RateLimit-Reset-After"]
        ?? body?.retry_after
        ?? body?.retryAfter;

    const seconds = Number(rawHeader);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
    return 1500;
}

async function patchOne(guildId: string, job: PatchJob, maxRetries: number) {
    let attempt = 0;
    let waitMs = 600;

    while (true) {
        try {
            const response = await RestAPI.patch({
                url: `/guilds/${guildId}/members/${job.userId}`,
                body: job.body,
            });
            return { ok: true as const, response };
        } catch (error: any) {
            if (isRateLimit(error) && attempt < maxRetries) {
                const retryAfter = getRetryAfterMs(error);
                await sleep(jitter(retryAfter));
                attempt++;
                continue;
            }

            const status = Number(error?.status ?? error?.response?.status);
            const recoverable = (status >= 500 && status < 600) || status === 408;
            if (recoverable && attempt < maxRetries) {
                await sleep(jitter(waitMs));
                waitMs = Math.min(waitMs * 2, 8000);
                attempt++;
                continue;
            }

            return { ok: false as const, error, status, rateLimited: isRateLimit(error) };
        }
    }
}

export async function executePatchJobsSmart(
    guildId: string,
    jobs: PatchJob[],
    options: RateLimitOptions,
    actionLabel: string,
    onProgress?: ProgressCallback
): Promise<ExecutionResult> {
    const startedAt = Date.now();
    const result: ExecutionResult = { success: 0, failed: 0, rateLimited: 0, totalMs: 0, errors: [] };

    if (!jobs.length) {
        result.totalMs = 0;
        return result;
    }

    showToast(`${t("runningToast")} ${actionLabel} (${jobs.length})...`, Toasts.Type.MESSAGE);

    const batchSize = Math.max(1, options.batchSize);
    const perActionDelay = Math.max(0, options.delayBetweenActionsMs);
    const waitBetweenBatchesMs = Math.max(0, options.waitBetweenBatchesSec * 1000);
    const maxRetries = Math.max(0, options.maxRetries);

    let completedSoFar = 0;
    const reportProgress = () => onProgress?.(completedSoFar, jobs.length);

    if (options.fastMode) {
        for (let start = 0; start < jobs.length; start += batchSize) {
            const batch = jobs.slice(start, start + batchSize);
            const responses = await Promise.allSettled(batch.map(job => patchOne(guildId, job, maxRetries)));

            responses.forEach((response, offset) => {
                const job = batch[offset];
                if (response.status === "fulfilled" && response.value.ok) {
                    result.success++;
                } else if (response.status === "fulfilled" && !response.value.ok) {
                    result.failed++;
                    if (response.value.rateLimited) result.rateLimited++;
                    result.errors.push({ userId: job.userId, status: response.value.status, reason: response.value.error });
                } else if (response.status === "rejected") {
                    result.failed++;
                    result.errors.push({ userId: job.userId, reason: response.reason });
                }
            });

            completedSoFar += batch.length;
            reportProgress();

            if (start + batchSize < jobs.length && waitBetweenBatchesMs > 0) {
                await sleep(jitter(waitBetweenBatchesMs));
            }
        }
    } else {
        for (let i = 0; i < jobs.length; i++) {
            const job = jobs[i];
            const response = await patchOne(guildId, job, maxRetries);

            if (response.ok) {
                result.success++;
            } else {
                result.failed++;
                if (response.rateLimited) result.rateLimited++;
                result.errors.push({ userId: job.userId, status: response.status, reason: response.error });
            }

            completedSoFar = i + 1;
            reportProgress();

            if (perActionDelay > 0 && i + 1 < jobs.length) await sleep(perActionDelay);

            const shouldBatchWait = (i + 1) % batchSize === 0 && i + 1 < jobs.length;
            if (shouldBatchWait && waitBetweenBatchesMs > 0) await sleep(jitter(waitBetweenBatchesMs));
        }
    }

    result.totalMs = Date.now() - startedAt;

    if (result.failed === 0) {
        const elapsed = (result.totalMs / 1000).toFixed(1);
        showToast(`${t("successToast")} ${actionLabel} (${result.success}) · ${elapsed}s`, Toasts.Type.SUCCESS);
    } else if (result.success > 0) {
        showToast(`${t("partialToast")} ${result.success}/${jobs.length}${result.rateLimited ? ` · 429: ${result.rateLimited}` : ""}`, Toasts.Type.MESSAGE);
    } else {
        showToast(`${t("failedToast")} ${result.success}/${jobs.length}`, Toasts.Type.FAILURE);
    }

    if (result.errors.length) console.error("YamachVoiceUtilitiesPro failed requests", result.errors);

    return result;
}

export function defaultOptionsFromSettings(store: any): RateLimitOptions {
    return {
        batchSize: Number(store.waitAfter ?? 25),
        waitBetweenBatchesSec: Number(store.waitSeconds ?? 0),
        delayBetweenActionsMs: Number(store.delayBetweenActionsMs ?? 0),
        fastMode: (store.executionMode ?? "fastBatched") === "fastBatched",
        maxRetries: Number(store.maxRetries ?? 3),
    };
}
