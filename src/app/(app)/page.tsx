"use client";
import { DraftBoard } from "@/components/draft-board";
import { AlertsPanel, AvailableTable, CategoryOutlook, InjuryWatch, MyRoster, OpponentPredictions, RecentPicks } from "@/components/panels";
import { CandidateTable, LabelledPicks, MetricBanner, TopPickCard } from "@/components/recs";
import { useStrategies } from "@/client/analysis";
import { Badge, Panel, Spinner } from "@/components/ui";
import { YahooSync } from "@/components/yahoo-sync";

function BuildPanel() {
  const s = useStrategies();
  if (!s.result) return <Panel title="Current optimal build"><Spinner label="Simulating builds…" /></Panel>;
  const adv = s.result.advice;
  return (
    <Panel title="Current optimal build" right={s.stale ? <Spinner label="updating" /> : <span className="text-dim">{s.result.results[0]?.runs} draft completions / build</span>}>
      {adv && (
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{adv.recommended.label}</span>
            <Badge tone={adv.commit ? "good" : "neutral"}>{adv.commit ? "COMMIT" : "STAY FLEXIBLE"}</Badge>
          </div>
          <div className="text-mute">{adv.message}</div>
          <div className="text-[10px] text-dim">{adv.flexibility} builds within tolerance of the best — higher = more flexibility.</div>
        </div>
      )}
    </Panel>
  );
}

export default function WarRoom() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold tracking-tight">Live Draft War Room</h1>
        <MetricBanner />
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <div className="space-y-3 xl:col-span-5">
          <YahooSync />
          <TopPickCard />
          <CandidateTable limit={6} />
          <BuildPanel />
        </div>
        <div className="space-y-3 xl:col-span-4">
          <AvailableTable rows={60} />
          <LabelledPicks />
        </div>
        <div className="space-y-3 xl:col-span-3">
          <MyRoster />
          <CategoryOutlook />
          <AlertsPanel />
          <OpponentPredictions />
          <RecentPicks />
          <InjuryWatch />
        </div>
      </div>
      <DraftBoard />
    </div>
  );
}
