package com.alphatrade.marketdata.service;

import com.alphatrade.marketdata.client.AlphaVantageClient;
import com.alphatrade.marketdata.client.CryptoClient;
import com.alphatrade.marketdata.entity.OhlcvEntity;
import com.alphatrade.marketdata.repository.OhlcvRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class MarketDataService {

    private static final Logger log = LoggerFactory.getLogger(MarketDataService.class);
    private final AlphaVantageClient avClient;
    private final CryptoClient cryptoClient;
    private final OhlcvRepository repo;

    public MarketDataService(AlphaVantageClient avClient, CryptoClient cryptoClient, OhlcvRepository repo) {
        this.avClient = avClient;
        this.cryptoClient = cryptoClient;
        this.repo = repo;
    }

    @Transactional
    public int ingestCrypto(String symbol) {
        List<Map<String, Object>> candles = cryptoClient.fetchDailyFull(symbol);
        return persistCandles(symbol.toUpperCase(), candles, "DAILY");
    }

    @Transactional
    public int ingestDailyFull(String symbol) {
        return persistCandles(symbol, avClient.fetchDailyFull(symbol), "DAILY");
    }

    @Transactional
    public int ingestDailyCompact(String symbol) {
        return persistCandles(symbol, avClient.fetchDailyCompact(symbol), "DAILY");
    }

    @Transactional
    public int ingestWeekly(String symbol) {
        return persistCandles(symbol, avClient.fetchWeekly(symbol), "WEEKLY");
    }

    private int persistCandles(String symbol, List<Map<String, Object>> candles, String timeframe) {
        if (candles.isEmpty()) return 0;
        Set<LocalDate> existingDates = repo.findAllDates(symbol, timeframe);
        List<OhlcvEntity> pending = new ArrayList<>();
        for (Map<String, Object> c : candles) {
            LocalDate date = (LocalDate) c.get("date");
            if (!existingDates.contains(date)) {
                pending.add(new OhlcvEntity(symbol, date,
                    (BigDecimal) c.get("open"), (BigDecimal) c.get("high"),
                    (BigDecimal) c.get("low"), (BigDecimal) c.get("close"),
                    (BigDecimal) c.get("adjClose"), (Long) c.get("volume"), timeframe));
                existingDates.add(date);
            }
        }
        repo.saveAll(pending);
        int inserted = pending.size();
        log.info("Ingested {}/{} new {} candles for {}", inserted, candles.size(), timeframe, symbol);
        return inserted;
    }

    public List<OhlcvEntity> getDaily(String symbol) {
        return repo.findBySymbolAndTimeframeOrderByDateAsc(symbol, "DAILY");
    }

    public List<OhlcvEntity> getDaily(String symbol, LocalDate from, LocalDate to) {
        return repo.findBySymbolAndTimeframeAndDateBetweenOrderByDateAsc(symbol, "DAILY", from, to);
    }

    public List<OhlcvEntity> getWeekly(String symbol) {
        return repo.findBySymbolAndTimeframeOrderByDateAsc(symbol, "WEEKLY");
    }

    public List<String> getAvailableSymbols() { return repo.findDistinctSymbols(); }

    public long getCandleCount(String symbol, String timeframe) {
        return repo.countBySymbolAndTimeframe(symbol, timeframe);
    }

    public List<Map<String, Object>> toCandles(List<OhlcvEntity> entities) {
        return entities.stream().map(e -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("date", e.getDate().toString());
            m.put("open", e.getOpen()); m.put("high", e.getHigh());
            m.put("low", e.getLow()); m.put("close", e.getClose());
            m.put("volume", e.getVolume());
            return m;
        }).collect(Collectors.toList());
    }
}
