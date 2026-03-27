package com.alphatrade.analysis.repository;

import com.alphatrade.analysis.entity.SignalSnapshotEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SignalSnapshotRepository extends JpaRepository<SignalSnapshotEntity, Long> {
    List<SignalSnapshotEntity> findTop50BySymbolOrderByCreatedAtDesc(String symbol);
    List<SignalSnapshotEntity> findTop50ByOrderByCreatedAtDesc();
}
