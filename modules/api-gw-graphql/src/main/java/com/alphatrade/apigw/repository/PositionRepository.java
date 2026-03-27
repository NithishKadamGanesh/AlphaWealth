package com.alphatrade.apigw.repository;

import com.alphatrade.apigw.entity.PositionEntity;
import com.alphatrade.apigw.entity.PositionId;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface PositionRepository extends JpaRepository<PositionEntity, PositionId> {
    List<PositionEntity> findByAccountId(String accountId);
}
