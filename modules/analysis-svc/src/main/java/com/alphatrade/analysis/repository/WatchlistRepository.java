package com.alphatrade.analysis.repository;

import com.alphatrade.analysis.entity.WatchlistItemEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface WatchlistRepository extends JpaRepository<WatchlistItemEntity, Long> {
    List<WatchlistItemEntity> findAllByOrderBySortOrderAsc();
    boolean existsBySymbol(String symbol);
    void deleteBySymbol(String symbol);
}
