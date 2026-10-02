# VietScope — Thông điệp thương hiệu và ngôn ngữ thiết kế

## Tên gọi thống nhất

- **Sản phẩm:** VietScope
- **Model ID:** `vietscope-1`
- **Badge:** Vietnam-first
- **Mô tả sản phẩm:** Search & Answer Engine

## Copy tiếng Việt (dùng thống nhất trên web)

Nguồn dùng trong code: `src/lib/product-copy.ts`.

**Headline**
> Tìm kiếm & trả lời AI, hiểu Việt Nam như người Việt

**Subheadline**
> Gõ tự nhiên bằng tiếng Việt — VietScope hiểu địa danh, thực thể và ngữ cảnh Việt Nam; tìm đúng nguồn, đối chiếu bằng chứng và trả lời kèm dẫn nguồn rõ ràng.

**Placeholder đầu tiên**
> Hỏi bất kỳ điều gì về Việt Nam...

**Thông điệp ngắn**
> VietScope là công cụ tìm kiếm & trả lời AI cho Việt Nam.

**North Star trên UI**
> Một nơi để tìm kiếm mọi lớp thông tin về Việt Nam.

**Developer/API**
> Một Search & Answer Engine ưu tiên Việt Nam, sẵn sàng dùng qua web, API và AI agents.

## Nguyên tắc giao diện

1. Câu hỏi là trọng tâm; retrieval engine và budget nằm trong chi tiết kỹ thuật, không phải lựa chọn bắt buộc.
2. Landing: hero → tìm được gì → vì sao khác biệt → câu hỏi mẫu → API.
3. Câu hỏi mẫu điền vào ô tìm kiếm; người dùng có thể sửa rồi mới gửi.
4. Dùng “như người Việt”, không dùng “như người bản địa”.
5. Giữ nhãn dữ liệu minh họa. Không dùng benchmark seed hay số liệu tĩnh làm claim về dịch vụ production.
6. Ẩn thông tin debug sau thao tác mở rộng, nhưng không che thông tin thiếu bằng chứng.
7. Giảm chuyển động, giữ focus bàn phím rõ, layout không tràn ngang ở điện thoại.

## Palette

- Nền: `#090B10`, `#0D1017`
- Vàng: `#F5B942`
- Cam: `#FF7A45`
- Xanh ngọc (API): `#24C8A5`
- Chữ: `#F7F8FA`, `#B8C0CC`
- Viền: trắng 6–8%

Font: Be Vietnam Pro. Chuyển động dùng để phản hồi thao tác, không dùng để cạnh tranh với ô tìm kiếm.
