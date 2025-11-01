# Gemini HTML Translator — Render template (miễn phí, gọn)

## Triển khai nhanh trên Render
1) Tạo repo GitHub mới, up 2 file này: `main.py`, `requirements.txt`.
2) Vào [Render](https://render.com) → **New → Web Service** → chọn repo.
3) **Build Command**: `pip install -r requirements.txt`
4) **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5) **Environment**: thêm biến
   - `GEMINI_API_KEY` = (API key của bạn)
   - (tuỳ chọn) `GEMINI_MODEL` = `gemini-2.5-pro`
6) Deploy → lấy URL HTTPS → dán vào **API base** của extension.

## Test nhanh
- Mở: `/health` → nhận `{ "ok": true }`
- Dịch thử: `/translate?url=https%3A%2F%2Fexample.com&lang=vi` → trả về HTML đã dịch.

> Gợi ý: Free tier có thể “ngủ đông”; lần gọi đầu hơi chậm là bình thường.
