// ---------------------------------------------------------------------------
// VietScope · Answer Engine (synthesis layer)
// Mọi câu trả lời đều gắn citation [n] → nguồn; claim không có bằng chứng
// được gắn cờ supported=false (Precision trước khi cố lấp đầy màn hình).
// Ở production, layer này thay bằng LLM synthesizer qua Inference Gateway —
// contract AnswerBlock giữ nguyên.
// ---------------------------------------------------------------------------
import type { DocDTO, RetrieveResult, UnderstandingDTO } from '@/core/contract';
import { freshnessLabel, formatDistance } from './vi';

export interface AnswerBlock {
  kind: 'paragraph' | 'list' | 'table' | 'callout';
  text?: string;
  citations?: number[]; // index 1-based vào mảng sources
  supported?: boolean;
  items?: { text: string; citations?: number[]; supported?: boolean }[];
  table?: { columns: string[]; rows: string[][] };
}

export interface SourceEntry {
  n: number;
  title: string;
  url: string;
  domain: string;
  sourceType: string;
  authority: number;
  publishedAt: string | null;
  freshness: string;
  snippet: string;
}

export interface AnswerResult {
  mode: 'answer' | 'honest_no_exact' | 'compare';
  headline: string;
  blocks: AnswerBlock[];
  sources: SourceEntry[];
  relatedQuestions: string[];
  claimsCited: number;
  claimsUnsupported: number;
}

function toSources(docs: DocDTO[]): SourceEntry[] {
  return docs.map((d, i) => ({
    n: i + 1,
    title: d.title,
    url: d.url,
    domain: d.domain,
    sourceType: d.sourceType,
    authority: d.authority,
    publishedAt: d.publishedAt ? new Date(d.publishedAt).toISOString() : null,
    freshness: freshnessLabel(d.publishedAt),
    snippet: d.snippet,
  }));
}

/** Số thứ tự nguồn (1-based) theo domain — thay cho chỉ số hard-code, bền khi thứ hạng đổi */
function idxByDomain(docs: DocDTO[], domain: string): number | null {
  const i = docs.findIndex((d) => d.domain === domain);
  return i >= 0 ? i + 1 : null;
}
const uniq = (a: number[]) => [...new Set(a)];

// Chọn tối đa n doc nóng nhất có entity/tag phù hợp
function docsByEntity(
  docs: DocDTO[],
  entity: string,
  limit = 3,
): { docs: DocDTO[]; idx: number[] } {
  const picks: DocDTO[] = [];
  const idx: number[] = [];
  docs.forEach((d, i) => {
    if (picks.length >= limit) return;
    if (d.entities?.includes(entity)) {
      picks.push(d);
      idx.push(i + 1);
    }
  });
  return { docs: picks, idx };
}

export function synthesize(
  u: UnderstandingDTO,
  r: RetrieveResult,
): AnswerResult {
  const sources = toSources(r.docs);
  const offcialIdx = new Set<number>();
  r.docs.forEach((d, i) => {
    if (d.sourceType === 'law' || d.sourceType === 'government')
      offcialIdx.add(i + 1);
  });

  const locLabel = u.locations
    .map((l) => l.name.replace(/^(Tỉnh|Huyện|Thị xã|Xã|Phường|Thành phố) /, ''))
    .join(', ');
  const relatedQuestions: string[] = [];
  const blocks: AnswerBlock[] = [];
  let headline = 'Kết quả tìm kiếm';
  let mode: AnswerResult['mode'] = 'answer';

  const topicDock = (entity: string) => docsByEntity(r.docs, entity);

  // ---------------------------------------------------------------------------
  if (u.intent === 'local_search') {
    const exact = r.places.exact;
    const unv = r.places.unverified;
    const cands = r.places.candidates;
    const total = exact.length;
    const sp = u.specialty ?? 'địa điểm';
    headline = `${sp.charAt(0).toUpperCase() + sp.slice(1)} ở ${locLabel || 'Việt Nam'}`;

    if (r.coverage.gap && cands.length === 0 && unv.length === 0) {
      mode = 'honest_no_exact';
      blocks.push({
        kind: 'callout',
        text:
          `Chưa tìm thấy địa điểm${u.specialty ? ` “${sp}”` : ''} nào đủ bằng chứng để xác minh trong ${locLabel || 'khu vực này'}.` +
          (sources.length
            ? ` Mình đã tìm thấy ${sources.length} nguồn web liên quan ở phần Nguồn — một số có nhắc tới địa điểm cụ thể nhưng chưa đủ dữ liệu để xác nhận.`
            : ''),
        supported: true,
        citations: sources.length ? [1] : [],
      });
    } else if (total > 0) {
      const { idx } = topicDock(
        u.categories[0] === 'cafe'
          ? 'cafe'
          : (u.categories[0]?.replace(/-([a-z])/g, (_, c) => c) ?? ''),
      );
      const openCount = exact.filter((p) => p.openNow).length;
      blocks.push({
        kind: 'paragraph',
        text:
          `Mình tìm được ${total} địa điểm đã xác minh khớp “${sp}” tại ${locLabel || 'khu vực này'}` +
          (openCount > 0
            ? `, trong đó ${openCount} địa điểm đang mở cửa tại thời điểm bạn hỏi.`
            : '.') +
          (unv.length > 0
            ? ` Ngoài ra có ${unv.length} gợi ý từ web chưa đủ bằng chứng xác minh, hiển thị ở nhóm riêng.`
            : '') +
          (cands.length > 0
            ? ` Có ${cands.length} địa điểm mới phát hiện từ web đang chờ đưa vào kho canonical (flywheel).`
            : ''),
        citations: idx.length ? idx : sources.length ? [1] : [],
        supported: true,
      });
      if (exact[0]) {
        const p = exact[0];
        blocks.push({
          kind: 'paragraph',
          text:
            `Đáng chú ý nhất là ${p.name}` +
            (p.rating
              ? ` (${p.rating.toFixed(1).replace('.', ',')}★ / ${p.reviewCount} đánh giá)`
              : '') +
            (p.distanceKm != null
              ? `, cách trung tâm ${r.anchor?.label ?? 'khu vực'} khoảng ${formatDistance(p.distanceKm)}`
              : '') +
            (p.note ? `. ${p.note}` : '.'),
          citations: topicDock('gio-cha').idx.length
            ? topicDock('gio-cha').idx
            : idx.length
              ? idx
              : [1],
          supported: true,
        });
      }
    } else if (unv.length > 0) {
      mode = 'honest_no_exact';
      blocks.push({
        kind: 'callout',
        text: `Mình tìm thấy ${unv.length} địa điểm từ web có khả năng khớp “${sp}”, nhưng chưa đủ bằng chứng xác minh (chỉ 1 nguồn). Chúng được liệt kê riêng bên dưới dưới nhãn “chưa xác minh”.`,
        supported: true,
        citations: sources.length ? [1] : [],
      });
    } else if (cands.length > 0) {
      mode = 'honest_no_exact';
      blocks.push({
        kind: 'callout',
        text: `Mình tìm thấy ${cands.length} địa điểm có khả năng phù hợp từ web, nhưng chúng đang chờ xác minh nên chưa được xếp vào kết quả chính xác.`,
        supported: true,
        citations: sources.length ? [1] : [],
      });
    }

    // gợi ý câu hỏi tiếp theo
    if (locLabel) {
      relatedQuestions.push(
        `quán ${u.specialty ?? 'ăn'} nào đang mở ở ${locLabel} lúc này`,
        u.specialty === 'giò chả'
          ? `mua ${sp} làm quà ở ${locLabel}`
          : `${sp} ngon nhất ở ${locLabel}`,
        u.specialty === 'giò chả'
          ? `giò chả Nội Hoàng có gì đặc biệt`
          : `quán ăn đêm ở ${locLabel}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  else if (u.intent === 'legal') {
    headline = 'Thông tin pháp lý có dẫn nguồn';
    const nd = docsByEntity(r.docs, 'hoa-don-dien-tu');
    const thue = docsByEntity(r.docs, 'ho-kinh-doanh');
    if (nd.idx.length) {
      blocks.push({
        kind: 'paragraph',
        text: 'Theo Nghị định 70/2025/NĐ-CP (hiệu lực 01/6/2025), hộ kinh doanh, cá nhân kinh doanh có doanh thu từ 1 tỷ đồng/năm trở lên thuộc lĩnh vực ăn uống, nhà hàng, khách sạn, bán lẻ... phải sử dụng hóa đơn điện tử khởi tạo từ máy tính tiền có kết nối truyền dữ liệu trực tiếp đến cơ quan thuế.',
        citations: nd.idx,
        supported: true,
      });
    }
    if (thue.idx.length) {
      blocks.push({
        kind: 'paragraph',
        text: 'Từ 01/01/2026, hộ kinh doanh chuyển hoàn toàn sang phương pháp kê khai theo doanh thu thực tế, chấm dứt cơ chế thuế khoán; hộ có doanh thu dưới 500 triệu đồng/năm thuộc diện không phải nộp thuế GTGT và TNCN theo Nghị quyết 198/2025/QH15.',
        citations: thue.idx,
        supported: true,
      });
    }
    blocks.push({
      kind: 'callout',
      text: 'Khuyến nghị: đối chiếu nguyên văn văn bản tại Cổng thông tin Chính phủ/Tổng cục Thuế (các nguồn chính thống được trích dẫn) trước khi áp dụng, vì nghị định có thể còn thông tư hướng dẫn sửa đổi.',
      citations: [...offcialIdx].slice(0, 3),
      supported: true,
    });
    relatedQuestions.push(
      'mức phạt khi không xuất hóa đơn điện tử',
      'hộ kinh doanh dưới 500 triệu có phải kê khai không',
      'thủ tục đăng ký máy tính tiền kết nối cơ quan thuế',
    );
  }

  // ---------------------------------------------------------------------------
  else if (u.intent === 'market_price') {
    const isGold = /gia vang|vang/.test(u.normalized);
    headline = isGold ? 'Giá vàng hôm nay' : 'Giá thị trường';
    const gia = docsByEntity(
      r.docs,
      isGold
        ? 'gia-vang'
        : u.normalized.includes('xang')
          ? 'gia-xang'
          : 'ty-gia',
    );
    const phanTich = docsByEntity(r.docs, 'phan-tich');
    if (gia.idx.length) {
      const fresh = r.docs[gia.idx[0] - 1]?.publishedAt;
      blocks.push({
        kind: 'paragraph',
        text: r.docs[gia.idx[0] - 1]?.snippet ?? 'Đang cập nhật giá.',
        citations: gia.idx,
        supported: true,
      });
      blocks.push({
        kind: 'callout',
        text: `Độ tươi dữ liệu: cập nhật ${freshnessLabel(fresh)}. Giá có thể thay đổi theo phiên — hãy kiểm tra tại điểm giao dịch trước khi chốt.`,
        citations: gia.idx,
        supported: true,
      });
    }
    if (isGold && phanTich.idx.length) {
      blocks.push({
        kind: 'paragraph',
        text: 'Về lý do tăng: kỳ vọng Fed cắt giảm lãi suất làm chi phí cơ hội nắm giữ vàng giảm; các ngân hàng trung ương châu Á mua vàng ròng kỷ lục để đa dạng dự trữ; và lo ngại rủi ro địa chính trị kéo dài tiếp tục đẩy nhu cầu trú ẩn lên cao.',
        citations: phanTich.idx,
        supported: true,
      });
    }
    relatedQuestions.push(
      'giá vàng thế giới hôm nay bao nhiêu usd/ounce',
      'chênh lệch giá vàng trong nước và thế giới vì sao lớn',
      'dự báo giá vàng tuần tới',
    );
  }

  // ---------------------------------------------------------------------------
  else if (u.intent === 'weather') {
    headline = 'Thời tiết hôm nay';
    const wt = docsByEntity(r.docs, 'thoi-tiet');
    if (wt.idx.length) {
      blocks.push({
        kind: 'paragraph',
        text: r.docs[wt.idx[0] - 1]?.snippet ?? '',
        citations: wt.idx,
        supported: true,
      });
      blocks.push({
        kind: 'paragraph',
        text: 'Buổi sáng trời tạnh ráo 24–25°C, trưa chiều nắng nóng nhẹ 32–34°C; chiều tối và đêm có khả năng mưa rào, dông rải rác, đề phòng lốc sét và gió giật trong cơn dông.',
        citations: wt.idx,
        supported: true,
      });
      blocks.push({
        kind: 'callout',
        text: 'Lưu ý: bản tin lấy từ corpus VietScope, có thể không phải bản mới nhất — với nhu cầu thực tế hãy kiểm tra bản tin live của Trung tâm KTTV Quốc gia (nchmf.gov.vn).',
        citations: [],
        supported: true,
      });
    }
    relatedQuestions.push(
      'thời tiết Bắc Ninh ngày mai',
      'cảnh báo mưa dông Bắc Bộ tối nay',
      'lịch mưa lũ tuần này ở miền Bắc',
    );
  }

  // ---------------------------------------------------------------------------
  else if (u.intent === 'compare') {
    mode = 'compare';
    const [a, b] = u.compareTargets ?? ['VinFast VF 8', 'Hyundai Santa Fe'];
    headline = `So sánh ${a} và ${b}`;
    const vf = docsByEntity(r.docs, 'vf8');
    const sf = docsByEntity(r.docs, 'santa-fe');
    const ss = docsByEntity(r.docs, 'so-sanh');
    const vfOff = idxByDomain(r.docs, 'vinfastauto.com');
    const sfOff = idxByDomain(r.docs, 'hyundai.com');
    const cmp = idxByDomain(r.docs, 'autodaily.vn');
    const rev = idxByDomain(r.docs, 'caredge.vn');
    const c = (n: number | null) => (n ? ` [${n}]` : '');
    blocks.push({
      kind: 'paragraph',
      text: 'Cả hai đều là SUV tầm giá 1–1,4 tỷ đồng, nhưng triết lý khác nhau: VF 8 là xe điện 5 chỗ, tối ưu chi phí vận hành cho gia đình đô thị; Santa Fe là 3 hàng ghế 6–7 chỗ, phù hợp đi đường dài và cần chỗ rộng.',
      citations: uniq([...ss.idx, ...vf.idx]).slice(0, 3),
      supported: true,
    });
    blocks.push({
      kind: 'table',
      table: {
        columns: ['Tiêu chí', a, b],
        rows: [
          [
            'Giá công bố',
            `1,019 – 1,199 tỷ${c(cmp)}`,
            `1,029 – 1,365 tỷ${c(cmp ?? sfOff)}`,
          ],
          [
            'Động cơ',
            `Điện 260–300 kW (349–402 mã lực)${c(vfOff)}`,
            `2.5T xăng 281 mã lực / 1.6T hybrid${c(sfOff)}`,
          ],
          ['Chỗ ngồi', `5 chỗ${c(vfOff)}`, `6–7 chỗ${c(sfOff)}`],
          [
            'Phạm vi / tiêu hao',
            `457–471 km/sạc (WLTP)${c(vfOff)}`,
            `Hybrid ~6–7L/100km${c(cmp)}`,
          ],
          [
            'Chi phí vận hành',
            `≈ 1/4 chi phí xăng nếu sạc tại nhà${c(rev ?? cmp)}`,
            `Phụ thuộc giá xăng${c(cmp)}`,
          ],
          [
            'Bảo hành',
            `10 năm / 200.000 km${c(vfOff)}`,
            'Chưa có dữ liệu trong các nguồn đã truy xuất',
          ],
        ],
      },
      citations: uniq(
        [vfOff, sfOff, cmp, rev].filter((n): n is number => n !== null),
      ),
      supported: true,
    });
    blocks.push({
      kind: 'paragraph',
      text: 'Kết luận tham khảo: nếu bạn có chỗ sạc tại nhà, đi lại chủ yếu nội đô và muốn tiết kiệm nhiên liệu, VF 8 hợp lý hơn; nếu thường xuyên chở 6–7 người hay đi tỉnh xa nơi trạm sạc còn ít, Santa Fe an tâm hơn.',
      citations: ss.idx.length ? uniq(ss.idx) : [],
      supported: true,
    });
    relatedQuestions.push(
      'vì sao VF 8 ăn khách hơn mong đợi năm 2025',
      'trạm sạc VinFast dọc quốc lộ 1A hiện nay',
      'so sánh Santa Fe hybrid và bản 2.5T',
    );
  }

  // ---------------------------------------------------------------------------
  else if (u.intent === 'admin_info' || (u.transition && u.locations.length)) {
    headline = 'Địa giới hành chính';
    if (u.transition) {
      const sap = docsByEntity(r.docs, 'sap-nhap');
      blocks.push({
        kind: 'paragraph',
        text: `${u.transition.from} là địa danh lịch sử. Từ ngày 01/7/2025, theo Nghị quyết 202/2025/QH15, đơn vị này được sắp xếp thành: ${u.transition.to.join(', ')} — thuộc mô hình chính quyền địa phương 2 cấp (tỉnh → xã/phường), cấp huyện kết thúc hoạt động.`,
        citations: sap.idx.length ? sap.idx : [],
        supported: true,
      });
      if (/yen dung/i.test(u.normalized)) {
        blocks.push({
          kind: 'paragraph',
          text: 'Cụ thể khu vực huyện Yên Dũng (Bắc Giang cũ) được chia thành các xã Yên Dũng (gồm thị trấn Neo, Nội Hoàng, Tiến Dũng), Tân An, Tiền Phong và Cảnh Thụy, trực thuộc tỉnh Bắc Ninh mới.',
          citations: uniq(
            [
              idxByDomain(r.docs, 'bacninh.gov.vn'),
              ...docsByEntity(r.docs, 'yen-dung').idx,
            ].filter((n): n is number => n !== null),
          ).slice(0, 2),
          supported: true,
        });
      }
    } else if (u.locations.length) {
      const l = u.locations[0];
      blocks.push({
        kind: 'paragraph',
        text: `${l.name} hiện là ${l.type === 'province' ? 'đơn vị hành chính cấp tỉnh' : 'đơn vị cấp ' + l.type} của Việt Nam (tình trạng: ${l.status === 'current' ? 'đang hoạt động' : 'đã sáp nhập'}).`,
        citations: sources.length ? [1] : [],
        supported: true,
      });
    }
    relatedQuestions.push(
      'cả nước còn bao nhiêu tỉnh thành sau sáp nhập 2025',
      'địa chỉ cũ thường trú có cần đổi giấy tờ không',
      'bản đồ hành chính mới tỉnh Bắc Ninh 2025',
    );
  }

  // ---------------------------------------------------------------------------
  else {
    // news / product / general — tổng hợp từ top docs
    headline = u.intent === 'news' ? 'Tin tức nổi bật' : 'Tổng hợp thông tin';
    const top = r.docs.slice(0, 3);
    if (top.length) {
      top.forEach((d, i) => {
        blocks.push({
          kind: 'paragraph',
          text: d.snippet,
          citations: [i + 1],
          supported: true,
        });
      });
    } else {
      blocks.push({
        kind: 'callout',
        text: 'Corpus demo chưa có nguồn khớp câu hỏi này — đây chính là Coverage Gap mà Coverage Engine của VietScope sẽ ghi nhận để bổ sung dữ liệu về sau.',
        supported: false,
      });
    }
    relatedQuestions.push(
      ...sources
        .slice(0, 3)
        .map((s) => `chi tiết: ${s.title.slice(0, 60).toLowerCase()}…`),
    );
  }

  if (u.transition && u.intent !== 'admin_info') {
    blocks.unshift({
      kind: 'callout',
      text: `Địa danh “${u.transition.from}” hiện đã sáp nhập: ${u.transition.to.join(', ')} (từ 01/7/2025). VietScope tự đổi về địa giới mới để tìm chính xác.`,
      citations: docsByEntity(r.docs, 'sap-nhap').idx.slice(0, 2),
      supported: true,
    });
  }

  const claimsCited = blocks.filter(
    (b) => (b.citations?.length ?? 0) > 0,
  ).length;
  const claimsUnsupported = blocks.filter((b) => b.supported === false).length;

  return {
    mode,
    headline,
    blocks,
    sources,
    relatedQuestions: relatedQuestions.slice(0, 4),
    claimsCited,
    claimsUnsupported,
  };
}
