"use client";
import { useEngineContext } from "@/client/analysis";
import { SeasonHome } from "@/components/season-home";
import { WarRoom } from "@/components/war-room";
import { Spinner } from "@/components/ui";

/** Home: the live draft room while drafting, Season HQ once the draft is complete. */
export default function Home() {
  const ctx = useEngineContext();
  if (!ctx) return <Spinner />;
  return ctx.overall > ctx.totalPicks ? <SeasonHome /> : <WarRoom />;
}
