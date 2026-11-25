# muse-tvc trong ele-flows – lớp nối

Skill gốc (`muse-video` của LuoJiangYong, tiếng Trung) chỉ làm **tiền kỳ**: Director/Writer/Art Director/DP/Sound → Creative Package → "biên dịch" prompt cho Seedance qua `arkcli`. Ở ele-flows ta giữ phần tư duy (vai trò, khuôn cảnh `references/scenes/*`, case `references/cases/*`, 6 đoạn prompt) và **thay bước 3.5 / 6 / 7.5 / 8 bằng node Flows chạy Muse**.

Chat tiếng Việt; prompt Muse viết tiếng Anh.

## Thứ tự đọc

1. `SKILL.md` (cây định tuyến) → chọn khuôn cảnh: TVC/quảng cáo → `references/scenes/studio-ad.md`, sản phẩm → `product-demo.md`, logo → `logo-animation.md`.
2. Pipeline: TVC 15–30 s, ≤ 2 bối cảnh, không nhân vật có mặt → `references/pipelines/fast-track.md`; có nhân vật/nhiều cảnh → `default.md`.
3. Vai trò chỉ nạp khi tới bước cần (`references/roles/<tên>.md`).
4. Bỏ qua: `volcano-engine-integration.md`, phần `arkcli` / ACT / slot Seedance trong `model-compiler.md`, `scripts/*.py` (không cần chạy; nếu muốn export HTML thì chạy bằng `python3 -I`).

## Ánh xạ pha → Flows

| Pha muse-video | Ở ele-flows |
| --- | --- |
| 1 Nhu cầu (Director) | Hỏi tối đa 1 lần: sản phẩm, thời lượng, tỉ lệ, kênh. Thiếu thì tự chọn mặc định hợp lý (9:16, 20 s) và ghi rõ trong pack |
| 2–4 Nội dung / visual / script | File `docs/tvc/<slug>.md` = Creative Pack: logline, vision, palette (mỗi màu có `visual_cause`), lighting, bảng shot (mã, góc, cỡ cảnh, chuyển động, giây dùng) |
| 3.5 Moodboard / product lock | Node `image-generation` **product sheet** (P01) – mọi still sau đều ref P01 để sản phẩm không trôi |
| 6 Storyboard panel | Mỗi shot 1 node still `A0n` (ảnh Muse, ref ≤ 3: P01 + bối cảnh/tay nếu có) |
| 7 HTML storyboard confirm | View **Scenes** của flow (`#/flows/<id>/scenes`) – nhãn `A01…` / `V01…` để bảng tự nhóm |
| 7.5 Model compiler | Prompt video 6 đoạn **Subject / Action / Scene / Camera / Lighting / Style** + HARD RULES; node `video-generation` `V0n`, `refs: [A0n]`, `duration: 10` |
| 5 Sound | Node `music` (GenMax trước – rẻ hơn) đúng độ dài phim; VO nếu có = `tts` chạy **sau** video |
| 8 Downstream | Node `composition` – **chỉ dựng sau khi user duyệt từng clip**; hoặc giao CapCut |

## Luật Muse phải nhớ khi "biên dịch"

- Ref tối đa 3 ảnh; mọi `@key` trong prompt đều thành ref – đừng nhắc tên node khác trong chữ.
- Video chỉ ref **still của chính shot đó** (thêm ref khác làm trôi).
- 10 s / clip, 1 shot / clip; ghi rõ đoạn dùng (vd. "usable 2–6 s") rồi cắt khi dựng.
- Shot không mặt người (sản phẩm, tay, macro) → **cho máy chuyển động** (orbit/push-in/slider chậm), không LOCKED CAMERA.
- Không chữ, logo, watermark trong ảnh/video – logo và CTA chèn khi dựng.
- Không thoại → `generateAudio: false`, nhạc đặt riêng.
- Prompt ≤ 5000 ký tự.
- Một node / shot; làm lại = chạy lại chính node đó (giữ lịch sử).
- **Có ảnh sản phẩm thật** (render nhiều góc): cắt bớt nền trắng, ghép 2×2 bằng ffmpeg thành **một** ảnh → upload → node `image` `P00` làm ref duy nhất cho mọi still (không sinh lại sheet). PRODUCT LOCK ghi bằng chữ các chi tiết dễ trôi (giác cắt, số chấu, đá tấm ở vai, màu đá).
- Nhạc: chỉ ElevenLabs có `/v1/music` (GenMax không có). Key trong Settings hết credit → thử các key khác trong `.env` (`ELEVENLABS_API_KEY` là danh sách phẩy).

## Quy trình chạy thử chuẩn

1. Viết Creative Pack `docs/tvc/<slug>.md`.
2. Build script `examples/tvc/<slug>.build.py` → `<slug>.spec.json` → `POST /api/flows` (nếu flow đã có thì `PUT`, rồi reload editor).
3. Chạy P01 → Claude xem → chạy các still A0n → Claude xem, gửi user dải still.
4. Chạy video V0n (1 take mỗi shot) → kiểm bằng dải khung ffmpeg → gửi user từng clip, user quyết shot nào làm lại.
5. User duyệt xong mới chạy `music` + `composition` (export H.264 yuv420p + AAC 48 kHz).

Ví dụ đầy đủ: `docs/tvc/jemmia-ring-tvc.md` + `examples/tvc/jemmia-ring-tvc.build.py`.

## Đường Nov: Seedream (still) + Seedance 2.5 (video)

Dùng khi user muốn chất lượng ảnh thật hơn / chuyển động máy rõ hơn Muse (so sánh ngày 25/11/2026: Seedance cho chuyển động máy rõ hơn, Seedream cho ảnh thật hơn). Provider `nov` – xem `docs/providers/nov-seedance.md` (giá, tham số SV18).

1. **Still = Seedream 5.5** (`nov/seedream-5.5`, 2K, ~169đ): ref = sheet 2×2 ảnh thật sản phẩm (`P00`). Prompt bắt buộc có:
   - PRODUCT LOCK (giác cắt, số chấu + **chấu tròn/nhọn**, đá tấm, đai) – Seedream hay vẽ đá **nhạt màu** → thêm COLOUR LOCK ("rich, saturated … not pale").
   - **TRUE SIZE bằng mm** (vd. đá 7.3 × 5.2 mm ≈ 1 ct) + tỉ lệ so với ngón ("≈ 1/3 bề ngang ngón, ngắn hơn móng") + **hướng đặt** ("cạnh dài chạy dọc ngón") + "exactly ONE ring". Ảnh ref không có thước đo → model tự phóng to đá nếu không khoá.
   - STRUCTURE LOCK cho macro: "exactly ONE thin band … no split shank, no extra posts" – góc macro quá chếch làm Seedance hiểu thành 2–3 đai.
   - Tay: "delicate, slim tapered fingers, fair light-ivory skin, refined real texture (fine pores, faint knuckle creases), NO prominent veins / wrinkles, no freckles or brown spots, NOT airbrushed/waxy". Quá mịn → fake; quá chi tiết → thô.
   - Kiểm: ngón đeo (áp út), số nhẫn, zoom chấu/đá trước khi chạy video.
2. **Video = Seedance 2.5** (`nov/seedance-2.5`): node có **ref `P00` + startFrame = still** → Nov gửi `@Image1` = ảnh sản phẩm, `@Image2` = khung mở đầu (reference mode). Kiểm bằng dry-run `buildRunRequest` trước khi tốn tiền.
   - Gen thử 480p; take duyệt 720p. 6 s/shot ≈ 6.875đ @720p (8 s rẻ hơn theo giây nếu cần hold).
   - **Chuyển động phải viết rõ**: đường máy cụ thể (orbit 30–40°, slider dọc đai, spiral top-down, pull-back + arc), ánh sáng quét, vật tạo parallax (bụi, rèm), "motion starts immediately and continues… never a simple digital zoom". Prompt kiểu "slow / hold / never change" → Seedance chỉ zoom ảnh.
   - Không viết "chuyển màu đá từ A sang B" (S04 ra đá màu cam 1 s đầu).
   - Không có shot đeo nhẫn vào tay (vật lý sai) – bắt đầu khi nhẫn đã nằm trên tay.
   - Bộ lọc kiểm duyệt Nov đôi khi chặn ngẫu nhiên (hoàn tiền) → chạy lại.
3. **Chạy bằng `examples/tvc/nov_direct.py`** (POST `/api/run` + `track`) thay vì sửa model/prompt trong file flow: tab editor đang mở sẽ autosave bản cũ đè lên. Kết quả vẫn gắn vào node (`source: api`).
4. Lỗi 502 khi poll ≠ job hỏng: job vẫn chạy và **vẫn tính tiền** bên Nov → lấy kết quả qua `GET https://nov.ai.vn/api/v1/generations` (code đơn hàng) thay vì chạy lại.
5. `POST /api/flows/:id/run` với `inputs` **xoá lịch sử generation** của node đó – chỉ truyền `inputs` cho node đang chạy lại.
6. Báo chi phí mỗi lần (generation.cost / danh sách job Nov).

Ví dụ hoàn chỉnh: `examples/tvc/jemmia-yellow-emerald.seedream.py` (chuyển still sang Seedream), `examples/tvc/jemmia-yellow-emerald.seedance.py` (prompt chuyển động 8 shot), `examples/tvc/nov_direct.py`. Ảnh sản phẩm không kèm trong repo – upload ảnh của bạn (`POST /api/upload`) và thay biến `SHEET`.
