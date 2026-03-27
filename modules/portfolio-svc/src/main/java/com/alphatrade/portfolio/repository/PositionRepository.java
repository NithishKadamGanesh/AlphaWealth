package com.alphatrade.portfolio.repository;

import com.alphatrade.portfolio.entity.PositionEntity;
import com.alphatrade.portfolio.entity.PositionId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PositionRepository extends JpaRepository<PositionEntity, PositionId> {
    List<PositionEntity> findByAccountId(String accountId);
}
