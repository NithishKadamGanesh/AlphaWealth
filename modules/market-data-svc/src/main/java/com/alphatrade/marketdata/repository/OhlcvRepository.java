package com.alphatrade.marketdata.repository;

import com.alphatrade.marketdata.entity.OhlcvEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public interface OhlcvRepository extends JpaRepository<OhlcvEntity, Long> {
    List<OhlcvEntity> findBySymbolAndTimeframeOrderByDateAsc(String symbol, String timeframe);
    List<OhlcvEntity> findBySymbolAndTimeframeAndDateBetweenOrderByDateAsc(String symbol, String timeframe, LocalDate from, LocalDate to);
    Optional<OhlcvEntity> findBySymbolAndDateAndTimeframe(String symbol, LocalDate date, String timeframe);
    @Query("SELECT o.date FROM OhlcvEntity o WHERE o.symbol = :symbol AND o.timeframe = :tf")
    Set<LocalDate> findAllDates(String symbol, String tf);
    @Query("SELECT MAX(o.date) FROM OhlcvEntity o WHERE o.symbol = :symbol AND o.timeframe = :tf")
    Optional<LocalDate> findLatestDate(String symbol, String tf);
    @Query("SELECT DISTINCT o.symbol FROM OhlcvEntity o")
    List<String> findDistinctSymbols();
    long countBySymbolAndTimeframe(String symbol, String timeframe);
}
