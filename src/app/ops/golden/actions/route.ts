// ---------------------------------------------------------------------------
// POST /ops/golden/actions — golden candidate lifecycle ops (P-LEARNING-6).
// Browser dùng ops session cookie; Bearer/internal qua opsAccessOk().
//   op=create   {query}                      → draft candidate (confirmed_bad only)
//   op=label    {id, intent, geo, specialty, entities, freshness, authority, abstain, note}
//   op=approve  {id}
//   op=promote  {id}                          → cũng set review → promoted_to_golden
//   op=revise   {id + label fields}           → supersede cũ, version+1 labeled
// ---------------------------------------------------------------------------
import { opsAccessOk } from "@/lib/ops";
import {
  approveGoldenCandidate,
  createGoldenCandidate,
  promoteGoldenCandidate,
  reviseGoldenCandidate,
  setGoldenLabels,
  type GoldenLabels,
} from "@/lib/golden";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const csv = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

function labelsFrom(form: FormData): GoldenLabels {
  const geo = csv(form.get("geo"));
  const entities = csv(form.get("entities"));
  return {
    intent: String(form.get("intent") ?? "") || null,
    geoScope: geo.length ? { admin_ids: geo } : null,
    specialty: String(form.get("specialty") ?? "") || null,
    expectedEntities: entities.length ? entities : null,
    freshnessRequirement: String(form.get("freshness") ?? "") || null,
    authorityRequirement: String(form.get("authority") ?? "") || null,
    abstentionExpected: form.get("abstain") === "on" || form.get("abstain") === "true",
    reviewNote: String(form.get("note") ?? "") || null,
  };
}

export async function POST(req: Request) {
  if (!(await opsAccessOk())) return new Response(null, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > 8192) {
    return Response.json({ error: { message: "payload too large", type: "invalid_request_error" } }, { status: 413 });
  }
  const form = await req.formData();
  const op = String(form.get("op") ?? "");
  const back = form.get("back") === "quality" ? "/ops/quality#bad-searches" : "/ops/golden";

  try {
    switch (op) {
      case "create":
        await createGoldenCandidate({ querySafe: String(form.get("query") ?? "") });
        break;
      case "label":
        await setGoldenLabels(String(form.get("id") ?? ""), labelsFrom(form));
        break;
      case "approve":
        await approveGoldenCandidate(String(form.get("id") ?? ""));
        break;
      case "promote":
        await promoteGoldenCandidate(String(form.get("id") ?? ""));
        break;
      case "revise":
        await reviseGoldenCandidate(String(form.get("id") ?? ""), labelsFrom(form));
        break;
      default:
        return Response.json({ error: { message: "unknown op", type: "invalid_request_error" } }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    return Response.redirect(new URL(`/ops/golden?err=${encodeURIComponent(msg)}`, req.url), 303);
  }
  return Response.redirect(new URL(back, req.url), 303);
}
