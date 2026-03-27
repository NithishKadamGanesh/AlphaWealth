package com.alphatrade.analysis.seasonality;

import com.alphatrade.analysis.model.Candle;
import org.springframework.stereotype.Component;
import java.time.LocalDate;
import java.time.Month;
import java.util.*;
import java.util.stream.Collectors;

@Component
public class SeasonalityEngine {

    public record MonthStats(int month, String name, double avgReturn, double winRate, int sampleSize, double bestReturn, double worstReturn) {}
    public record WeekStats(int week, double avgReturn, double winRate, int sampleSize) {}
    public record DayOfWeekStats(String day, double avgReturn, double winRate, int sampleSize) {}
    public record SeasonalityReport(List<MonthStats> monthly, List<WeekStats> weekly, List<DayOfWeekStats> dayOfWeek, List<String> bestBuyMonths, List<String> worstMonths) {}

    public SeasonalityReport analyze(List<Candle> candles) {
        List<MonthStats> mo = monthlyReturns(candles); List<WeekStats> wk = weeklyReturns(candles); List<DayOfWeekStats> dow = dayOfWeekReturns(candles);
        List<String> best = mo.stream().filter(m -> m.avgReturn > 0).sorted(Comparator.comparingDouble(MonthStats::avgReturn).reversed()).limit(3).map(MonthStats::name).collect(Collectors.toList());
        List<String> worst = mo.stream().sorted(Comparator.comparingDouble(MonthStats::avgReturn)).limit(3).map(MonthStats::name).collect(Collectors.toList());
        return new SeasonalityReport(mo, wk, dow, best, worst);
    }

    private List<MonthStats> monthlyReturns(List<Candle> candles) {
        Map<String, List<Candle>> byM = new LinkedHashMap<>();
        for (Candle c : candles) { LocalDate d = LocalDate.parse(c.date()); byM.computeIfAbsent(d.getYear()+"-"+d.getMonthValue(), k -> new ArrayList<>()).add(c); }
        Map<Integer, List<Double>> retByM = new HashMap<>();
        for (var e : byM.entrySet()) { List<Candle> b = e.getValue(); if (b.size()<2) continue;
            double ret = (b.get(b.size()-1).close()-b.get(0).open())/b.get(0).open()*100;
            retByM.computeIfAbsent(Integer.parseInt(e.getKey().split("-")[1]), k -> new ArrayList<>()).add(ret); }
        List<MonthStats> r = new ArrayList<>();
        for (int m = 1; m <= 12; m++) { List<Double> rets = retByM.getOrDefault(m, Collections.emptyList());
            if (rets.isEmpty()) { r.add(new MonthStats(m, Month.of(m).name(), 0,0,0,0,0)); continue; }
            double avg = rets.stream().mapToDouble(Double::doubleValue).average().orElse(0);
            long w = rets.stream().filter(x -> x > 0).count(); double wr = (double)w/rets.size()*100;
            double best = rets.stream().mapToDouble(Double::doubleValue).max().orElse(0);
            double worst = rets.stream().mapToDouble(Double::doubleValue).min().orElse(0);
            r.add(new MonthStats(m, Month.of(m).name(), rd(avg), rd(wr), rets.size(), rd(best), rd(worst))); }
        return r;
    }

    private List<WeekStats> weeklyReturns(List<Candle> candles) {
        Map<Integer, List<Double>> byW = new HashMap<>();
        for (int i = 5; i < candles.size(); i++) { LocalDate d = LocalDate.parse(candles.get(i).date()); int w = d.getDayOfYear()/7+1;
            double ret = (candles.get(i).close()-candles.get(i-5).close())/candles.get(i-5).close()*100; byW.computeIfAbsent(w, k -> new ArrayList<>()).add(ret); }
        List<WeekStats> r = new ArrayList<>();
        for (int w = 1; w <= 52; w++) { List<Double> rets = byW.getOrDefault(w, Collections.emptyList());
            if (rets.isEmpty()) { r.add(new WeekStats(w,0,0,0)); continue; }
            double avg = rets.stream().mapToDouble(Double::doubleValue).average().orElse(0);
            long wins = rets.stream().filter(x -> x > 0).count();
            r.add(new WeekStats(w, rd(avg), rd((double)wins/rets.size()*100), rets.size())); }
        return r;
    }

    private List<DayOfWeekStats> dayOfWeekReturns(List<Candle> candles) {
        String[] days = {"MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"};
        Map<String, List<Double>> byD = new HashMap<>();
        for (int i = 1; i < candles.size(); i++) { LocalDate d = LocalDate.parse(candles.get(i).date());
            double ret = (candles.get(i).close()-candles.get(i-1).close())/candles.get(i-1).close()*100;
            byD.computeIfAbsent(d.getDayOfWeek().name(), k -> new ArrayList<>()).add(ret); }
        List<DayOfWeekStats> r = new ArrayList<>();
        for (String day : days) { List<Double> rets = byD.getOrDefault(day, Collections.emptyList());
            if (rets.isEmpty()) { r.add(new DayOfWeekStats(day,0,0,0)); continue; }
            double avg = rets.stream().mapToDouble(Double::doubleValue).average().orElse(0);
            long w = rets.stream().filter(x -> x > 0).count();
            r.add(new DayOfWeekStats(day, rd(avg), rd((double)w/rets.size()*100), rets.size())); }
        return r;
    }

    private double rd(double v) { return Math.round(v*100.0)/100.0; }
}
