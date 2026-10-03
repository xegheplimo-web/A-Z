// ---------------------------------------------------------------------------
// VietScope · Wire format của POST /v1/retrieve (snake_case, contract_version "1")
//
// Đây là định dạng mà search-router (Python) phải trả. Facade chuyển sang DTO nội bộ
// bằng fromWire(), có kiểm tra hợp lệ — sai contract thì lỗi rõ ràng chứ không âm thầm sai.
// toWire() dùng cho server tham chiếu (scripts/reference-retrieve-server.ts) và test parity.
// ---------------------------------------------------------------------------
import {
  CONTRACT_VERSION,
  INTENTS,
  type CandidateDTO,
  type DocDTO,
  type PlaceDTO,
  type RetrieveResult,
  type RetrieveRequest,
} from './contract';

type J = Record<string, unknown>;

export class ContractError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(
      `search-router trả dữ liệu không đúng contract v${CONTRACT_VERSION}: ${problems.slice(0, 6).join('; ')}${problems.length > 6 ? ` (+${problems.length - 6} lỗi)` : ''}`,
    );
    this.name = 'ContractError';
    this.problems = problems;
  }
}

// --- request ------------------------------------------------------------------------
export function requestToWire(r: RetrieveRequest) {
  return {
    contract_version: CONTRACT_VERSION,
    query: r.query,
    context: r.context ?? null,
    mode: r.mode ?? 'auto',
    location: r.location ? { lat: r.location.lat, lng: r.location.lng } : null,
    max_results: r.maxResults ?? 10,
    record: r.record !== false,
  };
}

export function requestFromWire(j: J): RetrieveRequest {
  const loc = j.location as J | null | undefined;
  return {
    query: String(j.query ?? ''),
    context: typeof j.context === 'string' ? j.context : null,
    mode: (typeof j.mode === 'string'
      ? j.mode
      : 'auto') as RetrieveRequest['mode'],
    location:
      loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
        ? { lat: loc.lat, lng: loc.lng }
        : null,
    maxResults: typeof j.max_results === 'number' ? j.max_results : undefined,
    record: j.record !== false,
  };
}

// --- DTO → wire ---------------------------------------------------------------------
const placeToWire = (p: PlaceDTO) => ({
  id: p.id,
  name: p.name,
  category: p.category,
  category_label: p.categoryLabel,
  address: p.address,
  province_id: p.provinceId,
  specialties: p.specialties,
  rating: p.rating,
  review_count: p.reviewCount,
  price_label: p.priceLabel,
  phone: p.phone,
  hours: p.hours,
  open_now: p.openNow,
  distance_km: p.distanceKm,
  distance_label: p.distanceLabel,
  image: p.image,
  source: p.source,
  verified: p.verified,
  note: p.note,
  score: p.score,
  lat: p.lat,
  lng: p.lng,
  updated_at: p.updatedAt,
  why: p.why,
});
const docToWire = (d: DocDTO) => ({
  id: d.id,
  title: d.title,
  url: d.url,
  domain: d.domain,
  source_type: d.sourceType,
  snippet: d.snippet,
  content: d.content,
  authority: d.authority,
  published_at: d.publishedAt,
  entities: d.entities,
  score: d.score,
  why: d.why,
  origin: d.origin,
});
const candToWire = (c: CandidateDTO) => ({
  id: c.id,
  name: c.name,
  specialty: c.specialty,
  address: c.address,
  source_url: c.sourceUrl,
  source_title: c.sourceTitle,
  evidence: c.evidence,
  verification_level: c.verificationLevel ?? null,
  admin_scope: c.adminScope ?? null,
});

export function toWire(r: RetrieveResult) {
  const u = r.understanding;
  return {
    contract_version: CONTRACT_VERSION,
    backend: r.backend,
    understanding: {
      raw: u.raw,
      normalized: u.normalized,
      tokens: u.tokens,
      intent: u.intent,
      intent_label: u.intentLabel,
      specialty: u.specialty,
      categories: u.categories,
      freshness: u.freshness,
      locations: u.locations.map((l) => ({
        id: l.id,
        name: l.name,
        type: l.type,
        status: l.status,
        matched_term: l.matchedTerm,
        fuzzy: l.fuzzy,
      })),
      resolved_current_ids: u.resolvedCurrentIds,
      transition: u.transition,
      compare_targets: u.compareTargets,
      fuzzy: u.fuzzy,
    },
    budget: {
      name: r.budget.name,
      reason: r.budget.reason,
      target_ms: r.budget.targetMs,
      multi_hop: r.budget.multiHop,
      read_evidence: r.budget.readEvidence,
    },
    places: {
      exact: r.places.exact.map(placeToWire),
      unverified: r.places.unverified.map(placeToWire),
      related: r.places.related.map(placeToWire),
      candidates: r.places.candidates.map(candToWire),
    },
    docs: r.docs.map(docToWire),
    coverage: r.coverage,
    anchor: r.anchor,
    scope: r.scope,
    quality: {
      confidence: r.quality.confidence,
      coverage: r.quality.coverage,
      independent_sources: r.quality.independentSources,
      avg_authority: r.quality.avgAuthority,
    },
    federation: r.federation,
    widening: r.widening,
    timings: r.timings,
  };
}

// --- wire → DTO (có kiểm tra) ----------------------------------------------------------
export function fromWire(
  input: unknown,
  backendId = 'search-router',
): RetrieveResult {
  const problems: string[] = [];
  const bad = (path: string, want: string) =>
    problems.push(`${path}: cần ${want}`);
  const obj = (v: unknown, path: string): J =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? (v as J)
      : (bad(path, 'object'), {});
  const arr = (v: unknown, path: string): unknown[] =>
    Array.isArray(v) ? v : (bad(path, 'array'), []);
  const str = (v: unknown, path: string): string =>
    typeof v === 'string' ? v : (bad(path, 'string'), '');
  const strN = (v: unknown, path: string): string | null =>
    v === null || v === undefined
      ? null
      : typeof v === 'string'
        ? v
        : (bad(path, 'string|null'), null);
  const num = (v: unknown, path: string): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : (bad(path, 'number'), 0);
  const numN = (v: unknown, path: string): number | null =>
    v === null || v === undefined
      ? null
      : typeof v === 'number' && Number.isFinite(v)
        ? v
        : (bad(path, 'number|null'), null);
  const bool = (v: unknown, path: string): boolean =>
    typeof v === 'boolean' ? v : (bad(path, 'boolean'), false);
  const boolN = (v: unknown, path: string): boolean | null =>
    v === null || v === undefined
      ? null
      : typeof v === 'boolean'
        ? v
        : (bad(path, 'boolean|null'), null);
  const strs = (v: unknown, path: string): string[] =>
    arr(v, path).map((x, i) => str(x, `${path}[${i}]`));

  const root = obj(input, '$');
  if (String(root.contract_version) !== CONTRACT_VERSION)
    bad(
      'contract_version',
      `"${CONTRACT_VERSION}" (nhận ${JSON.stringify(root.contract_version)})`,
    );

  const un = obj(root.understanding, 'understanding');
  const intent = str(un.intent, 'understanding.intent');
  if (intent && !(INTENTS as readonly string[]).includes(intent))
    bad('understanding.intent', `một trong ${INTENTS.join('|')}`);
  const fz = obj(un.fuzzy ?? { used: false, notes: [] }, 'understanding.fuzzy');
  const tr =
    un.transition == null
      ? null
      : obj(un.transition, 'understanding.transition');
  const cmp =
    un.compare_targets == null
      ? null
      : strs(un.compare_targets, 'understanding.compare_targets');

  const place = (v: unknown, path: string): PlaceDTO => {
    const p = obj(v, path);
    return {
      id: str(p.id, `${path}.id`),
      name: str(p.name, `${path}.name`),
      category: str(p.category, `${path}.category`),
      categoryLabel: str(p.category_label, `${path}.category_label`),
      address: str(p.address, `${path}.address`),
      provinceId: str(p.province_id, `${path}.province_id`),
      specialties: strs(p.specialties ?? [], `${path}.specialties`),
      rating: numN(p.rating, `${path}.rating`),
      reviewCount: num(p.review_count ?? 0, `${path}.review_count`),
      priceLabel: strN(p.price_label, `${path}.price_label`),
      phone: strN(p.phone, `${path}.phone`),
      hours: strN(p.hours, `${path}.hours`),
      openNow: boolN(p.open_now, `${path}.open_now`),
      distanceKm: numN(p.distance_km, `${path}.distance_km`),
      distanceLabel: strN(p.distance_label, `${path}.distance_label`),
      image: strN(p.image, `${path}.image`),
      source: str(p.source, `${path}.source`),
      verified: bool(p.verified, `${path}.verified`),
      verificationLevel: str(
        p.verification_level ?? 'observed',
        `${path}.verification_level`,
      ),
      note: strN(p.note, `${path}.note`),
      score: num(p.score ?? 0, `${path}.score`),
      lat: numN(p.lat, `${path}.lat`),
      lng: numN(p.lng, `${path}.lng`),
      updatedAt: strN(p.updated_at, `${path}.updated_at`),
      why: strs(p.why ?? [], `${path}.why`),
    };
  };
  const doc = (v: unknown, path: string): DocDTO => {
    const d = obj(v, path);
    return {
      id: str(d.id, `${path}.id`),
      title: str(d.title, `${path}.title`),
      url: str(d.url, `${path}.url`),
      domain: str(d.domain, `${path}.domain`),
      sourceType: (str(d.source_type, `${path}.source_type`) ||
        'web') as DocDTO['sourceType'],
      snippet: str(d.snippet ?? '', `${path}.snippet`),
      content: str(d.content ?? '', `${path}.content`),
      authority: num(d.authority, `${path}.authority`),
      publishedAt: strN(d.published_at, `${path}.published_at`),
      entities: strs(d.entities ?? [], `${path}.entities`),
      score: num(d.score ?? 0, `${path}.score`),
      why: strs(d.why ?? [], `${path}.why`),
      origin: str(d.origin ?? 'search-router', `${path}.origin`),
    };
  };

  const pl = obj(root.places, 'places');
  const bu = obj(root.budget, 'budget');
  const cov = obj(root.coverage, 'coverage');
  const sc = obj(root.scope ?? { provinces: [], communes: [] }, 'scope');
  const q = obj(root.quality, 'quality');
  const qcov = str(q.coverage, 'quality.coverage');
  if (qcov && !['good', 'partial', 'none'].includes(qcov))
    bad('quality.coverage', 'good|partial|none');
  const bname = str(bu.name, 'budget.name');
  if (bname && !['fast', 'standard', 'research'].includes(bname))
    bad('budget.name', 'fast|standard|research');
  const anchor = root.anchor == null ? null : obj(root.anchor, 'anchor');

  const result: RetrieveResult = {
    backend: backendId,
    understanding: {
      raw: str(un.raw, 'understanding.raw'),
      normalized: str(un.normalized, 'understanding.normalized'),
      tokens: strs(un.tokens ?? [], 'understanding.tokens'),
      intent: intent as RetrieveResult['understanding']['intent'],
      intentLabel: str(un.intent_label ?? '', 'understanding.intent_label'),
      specialty: strN(un.specialty, 'understanding.specialty'),
      categories: strs(un.categories ?? [], 'understanding.categories'),
      freshness: (['today', 'recent', 'any'].includes(String(un.freshness))
        ? un.freshness
        : 'any') as 'today' | 'recent' | 'any',
      locations: arr(un.locations ?? [], 'understanding.locations').map(
        (v, i) => {
          const l = obj(v, `understanding.locations[${i}]`);
          return {
            id: str(l.id, `locations[${i}].id`),
            name: str(l.name, `locations[${i}].name`),
            type: str(l.type, `locations[${i}].type`),
            status: str(l.status, `locations[${i}].status`),
            matchedTerm: str(
              l.matched_term ?? '',
              `locations[${i}].matched_term`,
            ),
            fuzzy: l.fuzzy === true,
          };
        },
      ),
      resolvedCurrentIds: strs(
        un.resolved_current_ids ?? [],
        'understanding.resolved_current_ids',
      ),
      transition: tr
        ? {
            from: str(tr.from, 'transition.from'),
            to: strs(tr.to, 'transition.to'),
            date: strN(tr.date, 'transition.date'),
          }
        : null,
      compareTargets: cmp && cmp.length >= 2 ? [cmp[0], cmp[1]] : null,
      fuzzy: {
        used: fz.used === true,
        notes: strs(fz.notes ?? [], 'understanding.fuzzy.notes'),
      },
    },
    budget: {
      name: (bname || 'standard') as RetrieveResult['budget']['name'],
      reason: str(bu.reason ?? '', 'budget.reason'),
      targetMs: str(bu.target_ms ?? '', 'budget.target_ms'),
      multiHop: bu.multi_hop === true,
      readEvidence: bu.read_evidence === true,
    },
    places: {
      exact: arr(pl.exact ?? [], 'places.exact').map((v, i) =>
        place(v, `places.exact[${i}]`),
      ),
      unverified: arr(pl.unverified ?? [], 'places.unverified').map((v, i) =>
        place(v, `places.unverified[${i}]`),
      ),
      related: arr(pl.related ?? [], 'places.related').map((v, i) =>
        place(v, `places.related[${i}]`),
      ),
      candidates: arr(pl.candidates ?? [], 'places.candidates').map((v, i) => {
        const c = obj(v, `places.candidates[${i}]`);
        return {
          id: str(c.id, 'candidate.id'),
          name: str(c.name, 'candidate.name'),
          specialty: strN(c.specialty, 'candidate.specialty'),
          address: strN(c.address, 'candidate.address'),
          sourceUrl: strN(c.source_url, 'candidate.source_url'),
          sourceTitle: strN(c.source_title, 'candidate.source_title'),
          evidence: strN(c.evidence, 'candidate.evidence'),
          verificationLevel: strN(
            c.verification_level,
            'candidate.verification_level',
          ) as CandidateDTO['verificationLevel'],
          adminScope: strN(c.admin_scope, 'candidate.admin_scope'),
        };
      }),
    },
    docs: arr(root.docs ?? [], 'docs').map((v, i) => doc(v, `docs[${i}]`)),
    coverage: {
      gap: bool(cov.gap, 'coverage.gap'),
      reason: strN(cov.reason, 'coverage.reason'),
      widened: cov.widened === true,
    },
    anchor: anchor
      ? {
          lat: num(anchor.lat, 'anchor.lat'),
          lng: num(anchor.lng, 'anchor.lng'),
          label: str(anchor.label, 'anchor.label'),
        }
      : null,
    scope: {
      provinces: strs(sc.provinces ?? [], 'scope.provinces'),
      communes: strs(sc.communes ?? [], 'scope.communes'),
    },
    quality: {
      confidence: num(q.confidence, 'quality.confidence'),
      coverage: (qcov || 'none') as RetrieveResult['quality']['coverage'],
      independentSources: num(
        q.independent_sources ?? 0,
        'quality.independent_sources',
      ),
      avgAuthority: num(q.avg_authority ?? 0, 'quality.avg_authority'),
    },
    federation: arr(root.federation ?? [], 'federation').map((v, i) => {
      const f = obj(v, `federation[${i}]`);
      return {
        provider: str(f.provider, 'federation.provider'),
        lane: str(f.lane ?? '', 'federation.lane'),
        status: (str(f.status, 'federation.status') ||
          'error') as RetrieveResult['federation'][number]['status'],
        ms: num(f.ms ?? 0, 'federation.ms'),
        count: num(f.count ?? 0, 'federation.count'),
        detail: typeof f.detail === 'string' ? f.detail : undefined,
      };
    }),
    widening: strs(root.widening ?? [], 'widening'),
    timings: Object.fromEntries(
      Object.entries(obj(root.timings ?? {}, 'timings')).filter(
        ([, v]) => typeof v === 'number',
      ),
    ) as Record<string, number>,
  };
  if (problems.length) throw new ContractError(problems);
  return result;
}
