/** Data-pilot contract. Facade routes/UI depend only on these DTOs and the active backend. */
export const PILOT_CATEGORIES = ["gio-cha", "cafe", "vlxd", "tap-hoa", "nha-thuoc"] as const;
export type PilotCategory = (typeof PILOT_CATEGORIES)[number];
export const PILOT_LABELS: Record<PilotCategory, string> = { "gio-cha": "Giò chả", cafe: "Cà phê", vlxd: "Sắt thép", "tap-hoa": "Tạp hóa", "nha-thuoc": "Nhà thuốc" };
export interface ObservationInput {
  sourceType: "osm" | "registry" | "website" | "directory" | "merchant";
  sourceId: string;
  sourceUrl: string;
  observedAt: string;
  name: string;
  address: string;
  communeId: string;
  provinceId: string;
  category: PilotCategory;
  specialties: string[];
  phone?: string | null;
  website?: string | null;
  hours?: string | null;
  lat?: number | null;
  lng?: number | null;
  legalEntity?: { taxId: string; legalName: string; registeredAddress?: string; status?: string } | null;
  fixture?: boolean;
}
export type PilotCommand =
  | { action: "ingest"; observations: ObservationInput[]; jobId?: string; leaseToken?: string }
  | { action: "review"; outletKey: string; decision: "approve" | "reject"; note: string }
  | { action: "plan" }
  | { action: "claim"; jobId: string };
export interface PilotSnapshot {
  backend: string;
  capabilities: { write: boolean };
  summary: { observations: number; pending: number; legalEntities: number; outlets: number; jobs: number };
  candidates: { key: string; name: string; address: string; commune: string; category: string; sources: number; status: string; fixture: boolean; observations: { id: string; sourceType: string; url: string; observedAt: string; payload: Record<string, unknown> }[] }[];
  jobs: { id: string; region: string; category: string; demand: number; canonicalCount: number; priority: number; status: string; h3Cell: string | null; lastCrawled: string | null }[];
}
export class PilotError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "PilotError"; }
}
