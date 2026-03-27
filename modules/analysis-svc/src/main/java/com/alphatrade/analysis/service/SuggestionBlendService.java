package com.alphatrade.analysis.service;

import com.alphatrade.analysis.model.BlendedSuggestion;
import com.alphatrade.analysis.model.ModelSuggestion;
import com.alphatrade.analysis.signal.SignalGenerator.TradeSignal;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Service
public class SuggestionBlendService {

    public BlendedSuggestion blend(TradeSignal ruleSignal, Optional<ModelSuggestion> modelSignalOpt) {
        if (modelSignalOpt.isEmpty()) {
            return new BlendedSuggestion(
                ruleSignal.action(),
                ruleSignal.confidence(),
                "RULE_ONLY",
                "Using rule-based signal only because model inference is unavailable.",
                List.of(ruleSignal.rationale())
            );
        }

        ModelSuggestion modelSignal = modelSignalOpt.get();
        String alignment = ruleSignal.action().equals(modelSignal.action()) ? "ALIGNED" : "DIVERGENT";
        double confidence = Math.round(((ruleSignal.confidence() + modelSignal.confidence()) / 2.0) * 100.0) / 100.0;
        String finalAction = alignment.equals("ALIGNED")
            ? modelSignal.action()
            : (modelSignal.confidence() >= ruleSignal.confidence() ? modelSignal.action() : ruleSignal.action());

        List<String> reasons = new ArrayList<>();
        reasons.add("Rule signal: " + ruleSignal.action() + " (" + Math.round(ruleSignal.confidence() * 100) + "%)");
        reasons.add("Model signal: " + modelSignal.action() + " (" + Math.round(modelSignal.confidence() * 100) + "%)");
        reasons.addAll(modelSignal.reasons());

        String summary = alignment.equals("ALIGNED")
            ? "Rule engine and model are aligned."
            : "Rule engine and model diverge; action selected from the stronger confidence source.";

        return new BlendedSuggestion(finalAction, confidence, alignment, summary, reasons);
    }
}
