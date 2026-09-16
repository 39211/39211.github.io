/**
 * Credential-free reliability kernel for small-shop publishing automation.
 *
 * This is a reusable extract of three production rules from
 * laundry-social-auto-poster. It does not call Meta, GA4, or any live API.
 *
 *   1. Approval completeness — missing, forced, paused, or fingerprint-mismatched
 *      consent cannot publish.
 *   2. Retry / uncertain commit — a lost publish response is recorded as
 *      uncertain and must not be retried (retrying would duplicate the post).
 *   3. Missing analytics — unmeasured is not zero.
 *
 * Production counterparts:
 *   - src/approvePost.ts, src/autoApprove.ts, src/postCurrentSlot.ts
 *   - src/retry.ts, src/postInstagram.ts, src/postFacebook.ts
 *   - src/ga4Report.ts, src/programCheckpoint.ts
 */
export class NonRetryablePublishError extends Error {
    name = "NonRetryablePublishError";
    constructor(message) {
        super(message);
    }
}
function flightKey(postId, platform) {
    return `${postId}:${platform}`;
}
export function fingerprintFor(caption, mediaDigest) {
    return `${caption.trim()}::${mediaDigest ?? ""}`;
}
export function createShop(merchant = "示例洗衣店") {
    return {
        merchant,
        paused: false,
        approvals: [],
        posts: [],
        inFlight: {}
    };
}
export function createMockPlatform(nextOutcome = "success") {
    return {
        nextOutcome,
        publishCalls: 0,
        createdRemoteIds: []
    };
}
export function latestPublish(state, postId, platform) {
    for (let index = state.posts.length - 1; index >= 0; index -= 1) {
        const row = state.posts[index];
        if (row && row.postId === postId && row.platform === platform)
            return row;
    }
    return undefined;
}
export function findApproval(state, postId, platform) {
    for (let index = state.approvals.length - 1; index >= 0; index -= 1) {
        const row = state.approvals[index];
        if (row && row.postId === postId && row.platform === platform)
            return row;
    }
    return undefined;
}
export function evaluateApproval(state, draft, platform) {
    if (state.paused) {
        return { publishable: false, reason: "shop is paused; publishing is blocked" };
    }
    if (!draft.platforms.includes(platform)) {
        return { publishable: false, reason: `draft is not intended for ${platform}` };
    }
    const approval = findApproval(state, draft.id, platform);
    if (!approval) {
        return { publishable: false, reason: `post is not approved for ${platform}` };
    }
    if (approval.kind === "forced") {
        return { publishable: false, reason: "forced approval is not publishable consent" };
    }
    if (approval.kind === "incomplete") {
        return { publishable: false, reason: "approval is incomplete (missing digest or platform coverage)" };
    }
    const expected = fingerprintFor(draft.caption, draft.mediaDigest);
    if (approval.fingerprint !== expected) {
        return { publishable: false, reason: "content changed after approval (fingerprint mismatch)" };
    }
    if (approval.mediaDigest && draft.mediaDigest && approval.mediaDigest !== draft.mediaDigest) {
        return { publishable: false, reason: "media changed after approval" };
    }
    return { publishable: true, reason: "approval is complete and matches the current draft" };
}
export function approveDraft(state, draft, options = { platform: "instagram" }) {
    if (state.paused) {
        throw new Error("shop is paused; approval is blocked");
    }
    const kind = options.kind ?? (draft.mediaDigest ? "approved" : "incomplete");
    const record = {
        postId: draft.id,
        platform: options.platform,
        kind,
        fingerprint: fingerprintFor(draft.caption, draft.mediaDigest),
        mediaDigest: draft.mediaDigest,
        note: options.note
    };
    state.approvals.push(record);
    return record;
}
function callMockPlatform(mock, draft, platform) {
    mock.publishCalls += 1;
    if (mock.nextOutcome === "retryable") {
        throw new Error("transient network error before commit");
    }
    if (mock.nextOutcome === "lost_response") {
        const remoteId = `remote-${platform}-${draft.id}-${mock.publishCalls}`;
        mock.createdRemoteIds.push(remoteId);
        throw new NonRetryablePublishError(`${platform} publish response was lost; the post may already be live. Not retrying.`);
    }
    if (mock.nextOutcome === "unknown_after_commit") {
        const remoteId = `remote-${platform}-${draft.id}-${mock.publishCalls}`;
        mock.createdRemoteIds.push(remoteId);
        throw new NonRetryablePublishError(`${platform} returned an unknown status after the commit point. Not retrying.`);
    }
    const remoteId = `remote-${platform}-${draft.id}-${mock.publishCalls}`;
    mock.createdRemoteIds.push(remoteId);
    return remoteId;
}
export function publishDraft(state, draft, platform, mock) {
    const key = flightKey(draft.id, platform);
    if (state.inFlight[key]) {
        const skipped = {
            postId: draft.id,
            platform,
            status: "skipped",
            attempts: 0,
            error: "single-flight lock: a publish is already in progress"
        };
        state.posts.push(skipped);
        return skipped;
    }
    const existing = latestPublish(state, draft.id, platform);
    if (existing?.status === "success") {
        const skipped = {
            postId: draft.id,
            platform,
            status: "skipped",
            remotePostId: existing.remotePostId,
            attempts: 0,
            error: "already published; refusing a duplicate"
        };
        state.posts.push(skipped);
        return skipped;
    }
    if (existing?.status === "uncertain") {
        const blocked = {
            postId: draft.id,
            platform,
            status: "blocked",
            remotePostId: existing.remotePostId,
            attempts: 0,
            error: "previous attempt is uncertain; retry would risk a duplicate"
        };
        state.posts.push(blocked);
        return blocked;
    }
    const decision = evaluateApproval(state, draft, platform);
    if (!decision.publishable) {
        const blocked = {
            postId: draft.id,
            platform,
            status: "blocked",
            attempts: 0,
            error: decision.reason
        };
        state.posts.push(blocked);
        return blocked;
    }
    state.inFlight[key] = true;
    try {
        const remotePostId = callMockPlatform(mock, draft, platform);
        const success = {
            postId: draft.id,
            platform,
            status: "success",
            remotePostId,
            attempts: 1
        };
        state.posts.push(success);
        return success;
    }
    catch (error) {
        if (error instanceof NonRetryablePublishError) {
            const uncertain = {
                postId: draft.id,
                platform,
                status: "uncertain",
                remotePostId: mock.createdRemoteIds[mock.createdRemoteIds.length - 1],
                attempts: 1,
                error: error.message
            };
            state.posts.push(uncertain);
            return uncertain;
        }
        const failed = {
            postId: draft.id,
            platform,
            status: "failed",
            attempts: 1,
            error: error instanceof Error ? error.message : String(error)
        };
        state.posts.push(failed);
        return failed;
    }
    finally {
        delete state.inFlight[key];
    }
}
export function retryUntilPublished(state, draft, platform, mock, maxAttempts = 3) {
    let last = latestPublish(state, draft.id, platform);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        last = publishDraft(state, draft, platform, mock);
        if (last.status === "success" || last.status === "skipped" || last.status === "blocked" || last.status === "uncertain") {
            return last;
        }
    }
    return last ?? {
        postId: draft.id,
        platform,
        status: "failed",
        attempts: maxAttempts,
        error: "exhausted retryable attempts"
    };
}
export function recordAnalytics(input) {
    if (!input.configured) {
        return { status: "unmeasured", dataGaps: [input.gap ?? "analytics is not configured"] };
    }
    if (input.fetchError) {
        return { status: "unmeasured", dataGaps: [input.fetchError] };
    }
    if (input.empty) {
        return { status: "unmeasured", dataGaps: [input.gap ?? "empty dataset; not a measured zero"] };
    }
    if (input.value === undefined) {
        return { status: "unmeasured", dataGaps: [input.gap ?? "value was not returned"] };
    }
    return { status: "measured", value: input.value, dataGaps: [] };
}
export function aggregateAnalytics(days) {
    const gaps = days.flatMap((day) => day.dataGaps);
    const measured = days.filter((day) => day.status === "measured" && day.value !== undefined);
    if (measured.length !== days.length) {
        return {
            status: "unmeasured",
            dataGaps: gaps.length > 0 ? gaps : ["one or more days are unmeasured; refusing to coerce them to 0"]
        };
    }
    let total = 0;
    for (const day of measured) {
        total += day.value ?? 0;
    }
    return { status: "measured", value: total, dataGaps: [] };
}
export function canJudgeCheckpoint(reading) {
    return reading.status === "measured" && reading.dataGaps.length === 0 && reading.value !== undefined;
}
export function sampleDraft(overrides = {}) {
    return {
        id: "slot-01",
        date: "2026-09-16",
        slot: 1,
        caption: "雨後白鞋先看膠邊，不要直接漂白。",
        mediaDigest: "digest-white-shoe",
        platforms: ["facebook", "instagram"],
        ...overrides
    };
}
function expect(condition, message) {
    if (!condition)
        throw new Error(message);
}
export function buildRegressionCases() {
    return [
        {
            id: "A01",
            group: "approval",
            title: "Unapproved draft cannot publish",
            titleZh: "未核准不能發布",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                const mock = createMockPlatform();
                const result = publishDraft(state, draft, "instagram", mock);
                expect(result.status === "blocked", "expected blocked");
                expect(mock.publishCalls === 0, "platform must not be called");
                expect(mock.createdRemoteIds.length === 0, "no remote post");
            }
        },
        {
            id: "A02",
            group: "approval",
            title: "Incomplete approval cannot publish",
            titleZh: "核准不完整不能發布",
            run() {
                const state = createShop();
                const draft = sampleDraft({ mediaDigest: undefined });
                approveDraft(state, draft, { platform: "instagram", kind: "incomplete" });
                const mock = createMockPlatform();
                const result = publishDraft(state, draft, "instagram", mock);
                expect(result.status === "blocked", "expected blocked");
                expect(mock.publishCalls === 0, "platform must not be called");
            }
        },
        {
            id: "A03",
            group: "approval",
            title: "Forced approval is not publishable consent",
            titleZh: "強制核准不是可發布同意",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram", kind: "forced", note: "owner override" });
                const mock = createMockPlatform();
                const result = publishDraft(state, draft, "instagram", mock);
                expect(result.status === "blocked", "forced must block");
                expect(result.error?.includes("forced") === true, "reason must mention forced");
                expect(mock.publishCalls === 0, "platform must not be called");
            }
        },
        {
            id: "A04",
            group: "approval",
            title: "Fingerprint mismatch after approval cannot publish",
            titleZh: "核准後文案被改不能發布",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                draft.caption = "文案已被改寫";
                const mock = createMockPlatform();
                const result = publishDraft(state, draft, "instagram", mock);
                expect(result.status === "blocked", "mismatch must block");
                expect(mock.publishCalls === 0, "platform must not be called");
            }
        },
        {
            id: "A05",
            group: "approval",
            title: "Complete approval can publish once",
            titleZh: "完整核准可以發布一次",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                const mock = createMockPlatform();
                const result = publishDraft(state, draft, "instagram", mock);
                expect(result.status === "success", "expected success");
                expect(mock.publishCalls === 1, "one platform call");
                expect(mock.createdRemoteIds.length === 1, "one remote post");
            }
        },
        {
            id: "A06",
            group: "approval",
            title: "Missing media blocks a complete approval",
            titleZh: "缺少媒體證據不能當成完整核准",
            run() {
                const state = createShop();
                const draft = sampleDraft({ mediaDigest: undefined });
                const record = approveDraft(state, draft, { platform: "instagram" });
                expect(record.kind === "incomplete", "missing digest is incomplete");
                const mock = createMockPlatform();
                expect(publishDraft(state, draft, "instagram", mock).status === "blocked", "must block");
            }
        },
        {
            id: "A07",
            group: "approval",
            title: "Pause blocks approval and publish",
            titleZh: "暫停會擋住核准與發布",
            run() {
                const state = createShop();
                state.paused = true;
                const draft = sampleDraft();
                let threw = false;
                try {
                    approveDraft(state, draft, { platform: "instagram" });
                }
                catch {
                    threw = true;
                }
                expect(threw, "approve must throw while paused");
                const mock = createMockPlatform();
                const result = publishDraft(state, draft, "instagram", mock);
                expect(result.status === "blocked", "publish must block");
                expect(mock.publishCalls === 0, "platform must not be called");
            }
        },
        {
            id: "A08",
            group: "approval",
            title: "Approval for one platform does not publish the other",
            titleZh: "只核准一個平台不能發布另一個",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "facebook" });
                const mock = createMockPlatform();
                const result = publishDraft(state, draft, "instagram", mock);
                expect(result.status === "blocked", "other platform stays blocked");
                expect(mock.publishCalls === 0, "platform must not be called");
            }
        },
        {
            id: "R01",
            group: "retry",
            title: "Lost response is uncertain and non-retryable",
            titleZh: "回應遺失記為不確定且不可重試",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                const mock = createMockPlatform("lost_response");
                const first = publishDraft(state, draft, "instagram", mock);
                expect(first.status === "uncertain", "lost response is uncertain");
                expect(mock.createdRemoteIds.length === 1, "remote side already created a post");
            }
        },
        {
            id: "R02",
            group: "retry",
            title: "Retry after uncertain does not create a second post",
            titleZh: "不確定狀態重試不能再發一則",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                const mock = createMockPlatform("lost_response");
                publishDraft(state, draft, "instagram", mock);
                mock.nextOutcome = "success";
                const second = publishDraft(state, draft, "instagram", mock);
                expect(second.status === "blocked", "retry must block");
                expect(mock.publishCalls === 1, "platform called only once");
                expect(mock.createdRemoteIds.length === 1, "still one remote post");
            }
        },
        {
            id: "R03",
            group: "retry",
            title: "Retry after confirmed success is idempotent",
            titleZh: "成功後重試保持冪等",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                const mock = createMockPlatform();
                const first = publishDraft(state, draft, "instagram", mock);
                const second = publishDraft(state, draft, "instagram", mock);
                expect(first.status === "success" && second.status === "skipped", "second is skip");
                expect(second.remotePostId === first.remotePostId, "same remote id");
                expect(mock.publishCalls === 1, "platform called only once");
            }
        },
        {
            id: "R04",
            group: "retry",
            title: "Retryable error before commit can be retried",
            titleZh: "送出前的暫時錯誤可以重試",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                const mock = createMockPlatform("retryable");
                const first = publishDraft(state, draft, "instagram", mock);
                expect(first.status === "failed", "retryable stays failed");
                expect(mock.createdRemoteIds.length === 0, "nothing committed");
                mock.nextOutcome = "success";
                const second = publishDraft(state, draft, "instagram", mock);
                expect(second.status === "success", "retry can succeed");
                expect(mock.createdRemoteIds.length === 1, "one remote post");
            }
        },
        {
            id: "R05",
            group: "retry",
            title: "retryUntilPublished publishes once after a retryable failure",
            titleZh: "暫時失敗後的重試迴圈只成功一次",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                const mock = createMockPlatform("retryable");
                const first = retryUntilPublished(state, draft, "instagram", mock, 1);
                expect(first.status === "failed", "first loop fails");
                mock.nextOutcome = "success";
                const done = retryUntilPublished(state, draft, "instagram", mock, 3);
                expect(done.status === "success", "later retry succeeds");
                const again = retryUntilPublished(state, draft, "instagram", mock, 3);
                expect(again.status === "skipped", "further retries skip");
                expect(mock.createdRemoteIds.length === 1, "one remote post");
            }
        },
        {
            id: "R06",
            group: "retry",
            title: "Posted-log success skips a later catch-up run",
            titleZh: "已有成功紀錄的補跑會略過",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "facebook" });
                const mock = createMockPlatform();
                publishDraft(state, draft, "facebook", mock);
                const catchUp = publishDraft(state, draft, "facebook", mock);
                expect(catchUp.status === "skipped", "catch-up skips");
                expect(mock.publishCalls === 1, "no second live call");
            }
        },
        {
            id: "R07",
            group: "retry",
            title: "Single-flight lock prevents a concurrent duplicate",
            titleZh: "單飛鎖避免並行重複發布",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                state.inFlight[flightKey(draft.id, "instagram")] = true;
                const mock = createMockPlatform();
                const result = publishDraft(state, draft, "instagram", mock);
                expect(result.status === "skipped", "in-flight is skipped");
                expect(mock.publishCalls === 0, "platform must not be called");
            }
        },
        {
            id: "R08",
            group: "retry",
            title: "Unknown status after commit is non-retryable",
            titleZh: "送出後未知狀態不可重試",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                const mock = createMockPlatform("unknown_after_commit");
                const first = publishDraft(state, draft, "instagram", mock);
                expect(first.status === "uncertain", "unknown after commit is uncertain");
                mock.nextOutcome = "success";
                const second = publishDraft(state, draft, "instagram", mock);
                expect(second.status === "blocked", "must not retry");
                expect(mock.createdRemoteIds.length === 1, "one remote post");
            }
        },
        {
            id: "R09",
            group: "retry",
            title: "NonRetryablePublishError is not treated as a transient failure",
            titleZh: "不可重試錯誤不能被當成暫時失敗",
            run() {
                const state = createShop();
                const draft = sampleDraft();
                approveDraft(state, draft, { platform: "instagram" });
                const mock = createMockPlatform("lost_response");
                const result = retryUntilPublished(state, draft, "instagram", mock, 3);
                expect(result.status === "uncertain", "loop must stop");
                expect(mock.publishCalls === 1, "only the first call");
            }
        },
        {
            id: "M01",
            group: "analytics",
            title: "Unconfigured analytics is unmeasured, not zero",
            titleZh: "未設定分析是未量測，不是零",
            run() {
                const reading = recordAnalytics({ configured: false });
                expect(reading.status === "unmeasured", "unmeasured");
                expect(reading.value === undefined, "value must be absent");
                expect(reading.value !== 0, "must not be zero");
            }
        },
        {
            id: "M02",
            group: "analytics",
            title: "Fetch error is unmeasured, not zero",
            titleZh: "讀取失敗是未量測，不是零",
            run() {
                const reading = recordAnalytics({ configured: true, fetchError: "GA4 403" });
                expect(reading.status === "unmeasured", "unmeasured");
                expect(reading.value === undefined, "no numeric fallback");
            }
        },
        {
            id: "M03",
            group: "analytics",
            title: "Empty dataset is unmeasured, not zero",
            titleZh: "空資料集是未量測，不是零",
            run() {
                const reading = recordAnalytics({ configured: true, empty: true });
                expect(reading.status === "unmeasured", "unmeasured");
                expect(!("value" in reading && reading.value === 0), "empty is not zero");
            }
        },
        {
            id: "M04",
            group: "analytics",
            title: "A real API zero is measured zero",
            titleZh: "介面真的回 0 才能記成已量測的 0",
            run() {
                const reading = recordAnalytics({ configured: true, value: 0 });
                expect(reading.status === "measured", "measured");
                expect(reading.value === 0, "zero is allowed when fetched");
                expect(reading.dataGaps.length === 0, "no gaps");
            }
        },
        {
            id: "M05",
            group: "analytics",
            title: "Data gaps prevent checkpoint judgment",
            titleZh: "有資料缺口就不能判定里程碑",
            run() {
                const reading = recordAnalytics({ configured: true, fetchError: "insights permission missing" });
                expect(canJudgeCheckpoint(reading) === false, "cannot judge");
            }
        },
        {
            id: "M06",
            group: "analytics",
            title: "Ledger-style record keeps clicks undefined on failure",
            titleZh: "失敗時帳本不寫入點擊數 0",
            run() {
                const reading = recordAnalytics({ configured: false, gap: "GA4_REFRESH_TOKEN missing" });
                const ledger = {
                    source_clicks_status: reading.status
                };
                if (reading.status === "measured")
                    ledger.source_clicks = reading.value;
                expect(ledger.source_clicks === undefined, "field stays undefined");
                expect(ledger.source_clicks_status === "unmeasured", "status recorded");
            }
        },
        {
            id: "M07",
            group: "analytics",
            title: "Partial days cannot be summed as zero",
            titleZh: "缺測日子不能被加總成 0",
            run() {
                const days = [
                    recordAnalytics({ configured: true, value: 4 }),
                    recordAnalytics({ configured: true, fetchError: "timeout" })
                ];
                const total = aggregateAnalytics(days);
                expect(total.status === "unmeasured", "aggregate unmeasured");
                expect(total.value === undefined, "no coerced total");
            }
        },
        {
            id: "M08",
            group: "analytics",
            title: "All-measured days may be summed",
            titleZh: "全部已量測的日子才能加總",
            run() {
                const total = aggregateAnalytics([
                    recordAnalytics({ configured: true, value: 2 }),
                    recordAnalytics({ configured: true, value: 5 })
                ]);
                expect(total.status === "measured" && total.value === 7, "2+5=7");
                expect(canJudgeCheckpoint(total), "checkpoint ok");
            }
        }
    ];
}
export function runRegressionSuite(cases = buildRegressionCases()) {
    const results = [];
    for (const item of cases) {
        try {
            item.run();
            results.push({ id: item.id, group: item.group, title: item.title, titleZh: item.titleZh, ok: true });
        }
        catch (error) {
            results.push({
                id: item.id,
                group: item.group,
                title: item.title,
                titleZh: item.titleZh,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    return {
        passed: results.filter((row) => row.ok).length,
        failed: results.filter((row) => !row.ok).length,
        results
    };
}
export function runNamedScenarios() {
    const unapprovedState = createShop();
    const unapprovedDraft = sampleDraft({ id: "demo-unapproved" });
    const unapprovedMock = createMockPlatform();
    const unapproved = publishDraft(unapprovedState, unapprovedDraft, "instagram", unapprovedMock);
    const retryState = createShop();
    const retryDraft = sampleDraft({ id: "demo-retry" });
    approveDraft(retryState, retryDraft, { platform: "instagram" });
    const retryMock = createMockPlatform("lost_response");
    const first = publishDraft(retryState, retryDraft, "instagram", retryMock);
    retryMock.nextOutcome = "success";
    const second = publishDraft(retryState, retryDraft, "instagram", retryMock);
    const analytics = recordAnalytics({ configured: true, fetchError: "insights feed unavailable" });
    return {
        unapproved,
        retry: { first, second, remotePosts: retryMock.createdRemoteIds.length },
        analytics
    };
}
