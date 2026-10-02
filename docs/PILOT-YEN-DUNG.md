# Yên Dũng pilot — provenance before canonical

## Phạm vi phiên bản này

- 5 query do chủ dự án yêu cầu; BEFORE/AFTER đo từ cùng bản tham chiếu, giữ tại `reports/local1-before.json`, `reports/local1-after.json`.
- Import **JSON array / JSONL do người vận hành cung cấp hợp pháp**, không crawler ngẫu nhiên, không Google Maps scrape.
- `legal_entities` (MST) **1 → N** `places` (outlet). Khóa outlet là tên chuẩn hóa + địa chỉ chuẩn hóa + xã; không gộp chi nhánh theo MST hay số điện thoại dùng chung.
- `place_observations` giữ payload, URL, provider, observed_at, dấu fixture. Thay đổi dữ liệu là revision mới; retry đúng payload không tạo trùng.
- Review trong transaction/advisory lock. Cần ≥2 domain độc lập, ≤90 ngày tuổi và không mâu thuẫn specialty/địa bàn/MST/điện thoại/tọa độ.
- `field_provenance` liên kết từng trường với observation cụ thể. Không tự điền giờ mở cửa, rating, số điện thoại, MST, tọa độ từ tâm xã.
- Nguồn `.example`/`.test` hoặc đánh dấu fixture không được biến thành địa điểm thật đã xác minh; không xuất hiện trong public retrieval.
- Luồng cũ `POST /v1/coverage/promote {verified:true}` bị từ chối. Dùng observations và review có ghi chú.

## Vận hành

Trang `/data/pilot`: xem regression/coverage tổng hợp công khai; nguồn chi tiết và thao tác ghi cần `VIETSCOPE_ADMIN_KEY` (Bearer). UI không lưu khóa vào localStorage.

API duy nhất cho workspace: `GET/POST /v1/pilot`. Mọi request đi qua active backend capability. Backend `search-router` chưa cung cấp ops này sẽ báo không hỗ trợ, **không fallback embedded**.

- `action: ingest`, `observations: [...]`: batch tối đa 200 / 1 MB.
- `action: review`, `outletKey`, `decision: approve|reject`, `note`: đối chiếu nguồn, có audit reviewer.
- `action: plan`: nhu cầu bảy ngày → coverage jobs idempotent theo cell.
- `action: claim`, `jobId`: atomic lease 10 phút có token chống worker hết lease; import kèm jobId + leaseToken và đúng scope để hoàn thành.

CLI worker cho export hợp lệ: `npx tsx scripts/pilot-import.ts export.jsonl [job-id]`. Đây là import worker, chưa phải crawler tự động.

## Coverage

Cell = admin area × H3 (nullable) × category × cửa sổ bảy ngày. Counter tăng bằng SQL atomic upsert, không read-modify-write trong RAM.

Priority = demand × max(0,1−fresh_count/5) × staleness × business_value × (1−confidence).

Không có tọa độ/H3 thì để null; không bịa một mã H3 từ tên xã. Stage plan: `osm-pbf → registry → permitted-web`. PBF toàn quốc và registry thật **chưa được nạp**. `last_crawled` chỉ cập nhật sau import job thành công, không phải lúc tạo job.

## Kiểm thử

- `npx tsx scripts/local1-pilot.ts --gate`
- `npx tsx scripts/test-pilot.ts`: idempotency, conflict, same-domain exclusion, LegalEntity/branches, fixture exclusion, exclusive leases, scope-checked completion.
- Không reset seed/DB để chạy pilot. Test dùng fixture riêng và dọn dữ liệu của test.

## Giới hạn cần giữ rõ

Review là quyết định của người vận hành với nguồn đã thu thập; kiểm tra domain không tự chứng minh độc lập tổ chức/sao chép. Parser chưa đọc hay xác minh trang web tại thời điểm review. Alias/địa giới trong seed Next.js là fixture, không phải bộ địa giới quốc gia đã kiểm định. Những tác vụ PBF, registry, H3 indexing, queue phân tán và acquisition workers production nằm trong core/roadmap sau pilot này.
