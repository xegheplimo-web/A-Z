import type { Metadata } from "next";
import { PilotWorkspace } from "@/components/pilot-workspace";
import before from "../../../../reports/local1-before.json";
import after from "../../../../reports/local1-after.json";

export const metadata: Metadata = { title: "Yên Dũng · Pilot dữ liệu", robots: { index: false, follow: false } };
export default function PilotPage() {
  return <PilotWorkspace baseline={before} current={after} />;
}
