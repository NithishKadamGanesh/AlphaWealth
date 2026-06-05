package com.alphatrade.ibkr.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Slf4j
@Service
@RequiredArgsConstructor
public class IbkrSyncScheduler {
    private final IbkrConnectionService ibkr;

    // Keep the CP gateway session alive
    @Scheduled(fixedRate = 60_000)
    public void tickle() {
        ibkr.tickle();
    }

    // Check auth and sync positions on configured interval
    @Scheduled(fixedRateString = "${ibkr.sync-interval-seconds:30}000")
    public void syncPositions() {
        ibkr.checkAuthAndSync();
    }
}
