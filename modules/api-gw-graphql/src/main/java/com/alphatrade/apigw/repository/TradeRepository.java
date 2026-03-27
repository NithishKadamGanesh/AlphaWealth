package com.alphatrade.apigw.repository;

import com.alphatrade.apigw.entity.TradeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface TradeRepository extends JpaRepository<TradeEntity, String> {
    List<TradeEntity> findByAccountIdOrderByTsDesc(String accountId);
    List<TradeEntity> findBySymbolOrderByTsDesc(String symbol);
    List<TradeEntity> findAllByOrderByTsDesc();
}
