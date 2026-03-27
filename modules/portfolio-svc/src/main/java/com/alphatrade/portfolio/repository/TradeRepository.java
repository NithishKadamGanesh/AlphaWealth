package com.alphatrade.portfolio.repository;

import com.alphatrade.portfolio.entity.TradeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TradeRepository extends JpaRepository<TradeEntity, String> {
    List<TradeEntity> findByAccountIdOrderByTsDesc(String accountId);
    List<TradeEntity> findByAccountIdAndSymbolOrderByTsDesc(String accountId, String symbol);
    List<TradeEntity> findAllByOrderByTsDesc();
}
