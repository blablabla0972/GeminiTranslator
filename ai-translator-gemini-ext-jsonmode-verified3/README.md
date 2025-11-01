# AI Translator (Gemini 2.5) – Vietnamese [JSONMODE]
- Dùng **responseMimeType: application/json** + **responseSchema** để bắt model trả JSON đúng chuẩn.
- Nếu server không hỗ trợ JSON mode, tự **fallback** về chế độ prompt thường.
- Có self-test để xem raw response.

Cài: Load unpacked → Options dán key (AI Studio) → Ping → Gọi thử → Dịch trang.
