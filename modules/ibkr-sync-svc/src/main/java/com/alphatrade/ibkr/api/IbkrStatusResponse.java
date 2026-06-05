package com.alphatrade.ibkr.api;

import java.time.Instant;

public record IbkrStatusResponse(
        String state,
        boolean connected,
        boolean gatewayReachable,
        boolean hasSnapshot,
        boolean syncInProgress,
        String primaryAccount,
        int positionCount,
        int accountCount,
        Instant lastSyncAt,
        Instant lastCheckedAt,
        String lastError,
        String loginUrl
) {}
