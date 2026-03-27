package com.alphatrade.analysis.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.Arrays;
import java.util.List;

@Service
public class ScheduledSignalGenerationService {

    private static final Logger log = LoggerFactory.getLogger(ScheduledSignalGenerationService.class);

    private final AnalysisWorkflowService workflowService;
    private final List<String> fallbackSymbols;

    public ScheduledSignalGenerationService(
        AnalysisWorkflowService workflowService,
        @Value("${analysis.scheduler.symbols:AAPL,MSFT,NVDA,AMZN,TSLA,META}") String fallbackSymbols
    ) {
        this.workflowService = workflowService;
        this.fallbackSymbols = Arrays.stream(fallbackSymbols.split(","))
            .map(String::trim)
            .filter(s -> !s.isBlank())
            .toList();
    }

    @Scheduled(initialDelayString = "${analysis.scheduler.initial-delay-ms:30000}",
        fixedDelayString = "${analysis.scheduler.fixed-delay-ms:120000}")
    public void generateSnapshots() {
        List<String> symbols = workflowService.fetchSymbols();
        if (symbols.isEmpty()) symbols = fallbackSymbols;
        for (String symbol : symbols) {
            workflowService.generateBundle(symbol, "SCHEDULED");
        }
        log.info("Scheduled signal generation completed for {} symbols", symbols.size());
    }
}
