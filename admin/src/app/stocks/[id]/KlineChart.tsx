"use client";

import dynamic from "next/dynamic";

const KlineChartInner = dynamic(() => import("./KlineChartInner"), { ssr: false });

export default function KlineChart(props: { stockId: string }) {
  return <KlineChartInner stockId={props.stockId} />;
}
