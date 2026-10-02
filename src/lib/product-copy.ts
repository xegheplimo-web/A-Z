/** Copy sản phẩm dùng chung. Không chứa policy, routing hay logic retrieval. */
export const PRODUCT = {
  name: "VietScope",
  model: "vietscope-1",
  badge: "Vietnam-first",
  descriptor: "Search & Answer Engine",
  eyebrow: "VIETNAM-FIRST SEARCH & ANSWER ENGINE",
  headline: "Tìm kiếm & trả lời AI, hiểu Việt Nam như người Việt",
  subheadline:
    "Gõ tự nhiên bằng tiếng Việt — VietScope hiểu địa danh, thực thể và ngữ cảnh Việt Nam; tìm đúng nguồn, đối chiếu bằng chứng và trả lời kèm dẫn nguồn rõ ràng.",
  placeholder: "Hỏi bất kỳ điều gì về Việt Nam...",
  northStar: "Một nơi để tìm kiếm mọi lớp thông tin về Việt Nam.",
  shortDescription: "Công cụ tìm kiếm & trả lời AI cho Việt Nam.",
  description:
    "VietScope giúp bạn tìm kiếm thông tin về Việt Nam từ nhiều nguồn, hiểu tiếng Việt và ngữ cảnh Việt Nam sâu hơn, rồi trả lời kèm dẫn nguồn rõ ràng.",
  developerDescription:
    "Một Search & Answer Engine ưu tiên Việt Nam, sẵn sàng dùng qua web, API và AI agents.",
  github: "https://github.com/xegheplimo-web/VietScope",
} as const;

export const PROMPT_CHIPS = [
  { id: "places", label: "Địa điểm", query: "quán giò chả ngon ở Yên Dũng" },
  { id: "legal", label: "Pháp luật", query: "nghị định mới nhất về hóa đơn điện tử" },
  { id: "market", label: "Thị trường", query: "giá vàng hôm nay vì sao tăng" },
  { id: "product", label: "Sản phẩm", query: "cửa hàng gần đây bán máy khoan" },
  { id: "admin", label: "Hành chính", query: "Yên Dũng cũ nay thuộc đơn vị nào" },
] as const;

export const QUERY_EXAMPLES = [
  { id: "cafe", label: "Địa điểm", query: "quán cafe đẹp ở Yên Dũng" },
  { id: "invoice", label: "Pháp luật", query: "nghị định mới nhất về hóa đơn điện tử" },
  { id: "gold", label: "Thị trường", query: "giá vàng hôm nay vì sao tăng" },
  { id: "geography", label: "Hành chính", query: "Yên Dũng cũ nay thuộc đơn vị hành chính nào" },
  { id: "drill", label: "Sản phẩm", query: "cửa hàng gần đây bán máy khoan" },
  { id: "cars", label: "So sánh", query: "so sánh VinFast VF8 với Hyundai Santa Fe" },
] as const;

export const SEARCH_PLACEHOLDERS = [
  PRODUCT.placeholder,
  ...PROMPT_CHIPS.slice(0, 4).map((p) => p.query),
  "xã này trước đây thuộc huyện nào",
];
