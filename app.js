/* ============================================================
 * AeroFetch · Logic cốt lõi phía Frontend (JavaScript thuần)
 * Phân tích yêu cầu / Lịch sử / Carousel bộ ảnh / Ngăn cấu hình / Toast
 * ============================================================ */
"use strict";

// ---------------- Hằng số và Trạng thái ----------------
const LS_HISTORY_KEY = "aerofetch_history";
const LS_API_BASE_KEY = "aerofetch_api_base";
const HISTORY_LIMIT = 6;
const URL_PATTERN = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/i;

// Backend công cộng do tác giả triển khai (Đầy đủ tính năng: Tải qua proxy/ZIP bộ ảnh/Trích xuất âm thanh bằng ffmpeg)
// Trang lưu trữ tĩnh (GitHub Pages, v.v.) mặc định sử dụng backend này để khách truy cập dùng ngay không cần cấu hình
const DEFAULT_REMOTE_API = "https://aerofetch-api.onrender.com";

// Node thử nghiệm công cộng do tác giả Douyin_TikTok_Download_API cung cấp (Tương thích khi cấu hình thủ công).
// Node này chưa mở CORS, trình duyệt kết nối trực tiếp sẽ bị chặn nên phải chuyển tiếp qua relay công cộng;
// Endpoint tải xuống của nó đã bị vô hiệu hóa, mọi thao tác tải xuống đều dùng link trực tiếp CDN.
const PUBLIC_API = "https://api.douyin.wtf";
// Độ ổn định của relay công cộng miễn phí biến động lớn, thử lại theo thứ tự; unwrap=true nghĩa là response nằm trong {contents}
const CORS_RELAYS = [
  { wrap: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u) },
  { wrap: (u) => "https://api.allorigins.win/get?url=" + encodeURIComponent(u), unwrap: true },
];

/** Yêu cầu dành riêng cho node công cộng: Thử kết nối trực tiếp trước (nếu tương lai mở CORS sẽ truy cập trực tiếp), nếu thất bại sẽ thử từng relay */
async function fetchPublicNode(endpoint) {
  try {
    const resp = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
    if (resp.ok) return await resp.json();
  } catch { /* Bị chặn CORS hoặc hết thời gian, chuyển sang relay */ }

  for (const relay of CORS_RELAYS) {
    try {
      const resp = await fetch(relay.wrap(endpoint), { signal: AbortSignal.timeout(20000) });
      if (!resp.ok) continue;
      const body = await resp.json();
      return relay.unwrap ? JSON.parse(body.contents) : body;
    } catch { /* Relay này không khả dụng, thử cái tiếp theo */ }
  }
  throw new Error(
    "Node phân tích công cộng tạm thời không khả dụng (Relay miễn phí bị giới hạn lưu lượng hoặc sập), vui lòng thử lại sau; " +
    "Hoặc tham khảo README để triển khai backend riêng chỉ với 1 cú nhấp chuột và nhập vào ⚙ Cài đặt ở góc trên bên phải (Ổn định và đầy đủ tính năng hơn)"
  );
}

const state = {
  data: null,      // Kết quả phân tích gần nhất (đã chuẩn hóa)
  rawInput: "",    // Đầu vào gốc của lần phân tích gần nhất
  style: "native", // Loại backend: native=Backend dự án này, wtf=Node Douyin_TikTok_Download_API
  slide: 0,        // Trang hiện tại của Carousel
  slideCount: 0,
  loading: false,
};

// ---------------- Tham chiếu DOM ----------------
const $ = (id) => document.getElementById(id);

const els = {
  input: $("share-url-input"),
  pasteBtn: $("paste-btn"),
  parseBtn: $("parse-btn"),
  skeleton: $("skeleton-loader"),
  errorBox: $("error-box"),
  errorMessage: $("error-message"),
  resultCard: $("result-card"),
  avatar: $("author-avatar"),
  nickname: $("author-nickname"),
  uid: $("author-uid"),
  badge: $("platform-badge"),
  desc: $("video-desc"),
  statLikes: $("stat-likes"),
  statComments: $("stat-comments"),
  statShares: $("stat-shares"),
  videoWrap: $("video-preview-wrap"),
  videoPlayer: $("video-player"),
  carouselWrap: $("carousel-wrap"),
  carouselTrack: $("carousel-track"),
  carouselPrev: $("carousel-prev"),
  carouselNext: $("carousel-next"),
  carouselDots: $("carousel-dots"),
  btnHd: $("btn-download-hd"),
  btnZip: $("btn-download-zip"),
  btnDirect: $("btn-direct-link"),
  btnAudio: $("btn-download-audio"),
  historySection: $("history-section"),
  historyList: $("history-list"),
  clearHistoryBtn: $("clear-history-btn"),
  settingsBtn: $("settings-btn"),
  drawer: $("settings-drawer"),
  drawerOverlay: $("drawer-overlay"),
  closeDrawerBtn: $("close-drawer-btn"),
  apiBaseInput: $("api-base-input"),
  saveSettingsBtn: $("save-settings-btn"),
  testApiBtn: $("test-api-btn"),
  toastContainer: $("toast-container"),
};

// ---------------- Hàm tiện ích ----------------
function apiBase() {
  const saved = (localStorage.getItem(LS_API_BASE_KEY) || "").replace(/\/+$/, "");
  if (saved) return saved;
  // Khi chạy local/tự triển khai (cùng nguồn có backend) thì yêu cầu đến site hiện tại; Lưu trữ tĩnh thuần (GitHub Pages, v.v.) mặc định dùng backend công cộng
  if (/\.github\.io$/i.test(location.hostname) || location.protocol === "file:") {
    return DEFAULT_REMOTE_API;
  }
  return "";
}

function apiUrl(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  return `${apiBase()}${path}${qs ? "?" + qs : ""}`;
}

function extractUrl(text) {
  const match = (text || "").match(URL_PATTERN);
  if (!match) return null;
  try { const url = new URL(match[0]); return ["https:", "http:"].includes(url.protocol) ? url.href : null; }
  catch { return null; }
}

function formatCount(n) {
  const num = Number(n) || 0;
  if (num >= 1e8) return (num / 1e8).toFixed(1) + " tỷ";
  if (num >= 1e4) return (num / 1e4).toFixed(1) + " vạn";
  return String(num);
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return new Date(ts).toLocaleDateString("vi-VN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function toast(message, type = "info", duration = 2600) {
  const node = document.createElement("div");
  node.className = `toast${type !== "info" ? " toast--" + type : ""}`;
  node.textContent = message;
  els.toastContainer.appendChild(node);
  setTimeout(() => {
    node.classList.add("leaving");
    node.addEventListener("animationend", () => node.remove(), { once: true });
  }, duration);
}

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function setLoading(loading) {
  state.loading = loading;
  els.parseBtn.disabled = loading;
  els.parseBtn.innerHTML = loading
    ? '<span class="spinner"></span><span class="btn-label">Đang phân tích…</span>'
    : '<span class="btn-label">Phân tích ngay</span>';
  loading ? show(els.skeleton) : hide(els.skeleton);
  if (loading) {
    hide(els.resultCard);
    hide(els.errorBox);
  }
}

function showError(message) {
  els.errorMessage.textContent = message;
  show(els.errorBox);
  hide(els.resultCard);
}

// ---------------- Chuẩn hóa phản hồi từ Backend ----------------
function firstUrl(obj) {
  if (obj && Array.isArray(obj.url_list) && obj.url_list.length) return obj.url_list[0];
  return null;
}

/**
 * Tương thích với 2 loại backend:
 * 1. Backend của dự án này: Trả về cấu trúc phẳng {platform, type, desc, author, video, images, music...}
 * 2. Node tự dựng Douyin_TikTok_Download_API (minimal=true):
 *    Trả về {code, router, data: {video_data, image_data, cover_data, ...}}
 */
function normalizeResponse(body) {
  if (!body || typeof body !== "object") return null;

  // Backend của dự án này
  if (body.platform && body.video !== undefined) {
    state.style = "native";
    return body;
  }

  // Node Douyin_TikTok_Download_API
  const d = body.data;
  if (d && typeof d === "object" && d.aweme_id) {
    state.style = "wtf";
    const vd = d.video_data || {};
    const images = d.image_data?.no_watermark_image_list || [];
    return {
      platform: d.platform || "douyin",
      aweme_id: d.aweme_id,
      type: d.type === "image" || images.length ? "image" : "video",
      desc: d.desc || "",
      author: {
        nickname: d.author?.nickname || "",
        unique_id: d.author?.unique_id || d.author?.uniqueId || "",
        avatar: firstUrl(d.author?.avatar_thumb) || d.author?.avatarThumb || "",
      },
      statistics: {
        digg_count: d.statistics?.digg_count ?? d.statistics?.diggCount ?? 0,
        comment_count: d.statistics?.comment_count ?? d.statistics?.commentCount ?? 0,
        share_count: d.statistics?.share_count ?? d.statistics?.shareCount ?? 0,
      },
      cover: firstUrl(d.cover_data?.cover) || "",
      video: {
        nwm_video_url_HQ: vd.nwm_video_url_HQ || null,
        nwm_video_url: vd.nwm_video_url || null,
        wm_video_url: vd.wm_video_url || null,
      },
      images,
      music: {
        title: d.music?.title || "",
        url: firstUrl(d.music?.play_url) || null,
      },
    };
  }
  return null;
}

/** Tạo liên kết tải qua proxy theo loại backend; Trả về null nếu backend không có endpoint tải (quay lại link trực tiếp) */
function downloadHref(media) {
  const shareUrl = extractUrl(state.rawInput) || state.rawInput;
  if (state.style === "wtf") {
    // Node thử nghiệm công cộng đã vô hiệu hóa endpoint tải xuống; Node tự dựng vẫn dùng được (Bộ ảnh tự động nén ZIP)
    if (apiBase() === PUBLIC_API) return null;
    return apiUrl("/api/download", { url: shareUrl, prefix: true, with_watermark: false });
  }
  return apiUrl("/api/download", { url: state.rawInput, media });
}

// ---------------- Luồng phân tích chính ----------------
async function parse(inputText) {
  const raw = (inputText ?? els.input.value).trim();
  if (!raw) {
    toast("Vui lòng dán liên kết chia sẻ trước", "error");
    els.input.focus();
    return;
  }
  if (!extractUrl(raw)) {
    showError("Không tìm thấy liên kết hợp lệ trong nội dung nhập, vui lòng kiểm tra và thử lại");
    return;
  }
  if (state.loading) return;

  setLoading(true);
  // Gói miễn phí của Render sẽ ngủ khi không hoạt động, khởi động nguội mất 30~60 giây, an ủi người dùng nếu quá 6 giây chưa phản hồi
  const coldStartTimer = setTimeout(() => {
    if (state.loading && apiBase() === DEFAULT_REMOTE_API) {
      toast("Backend công cộng đang thức dậy từ chế độ ngủ, lần phân tích đầu tiên mất khoảng 30~60 giây, vui lòng đợi…", "info", 9000);
    }
  }, 6000);
  try {
    // minimal=true dành cho node Douyin_TikTok_Download_API trả về cấu trúc rút gọn thống nhất, backend dự án này sẽ bỏ qua
    const endpoint = apiUrl("/api/hybrid/video_data", { url: raw, minimal: true });
    let body;
    if (apiBase() === PUBLIC_API) {
      body = await fetchPublicNode(endpoint);
    } else {
      const resp = await fetch(endpoint, { signal: AbortSignal.timeout(90000) });
      body = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(body?.detail || body?.message || `Yêu cầu thất bại (HTTP ${resp.status})`);
      }
    }
    if (body && typeof body.code === "number" && body.code !== 200) {
      throw new Error(body.message || body.detail || `Giao diện trả về lỗi (code ${body.code})`);
    }
    const data = normalizeResponse(body);
    if (!data) {
      throw new Error("Backend trả về định dạng dữ liệu không thể nhận diện");
    }
    state.data = data;
    state.rawInput = raw;
    renderResult(data);
    saveHistory(raw, data);
  } catch (err) {
    const message = err instanceof TypeError
      ? "Không thể kết nối đến API (Backend chưa khởi động, sai địa chỉ hoặc node này chưa mở CORS cross-origin), vui lòng kiểm tra API Base URL trong ⚙ Cài đặt ở góc trên bên phải"
      : err.message;
    showError(message);
    toast("Phân tích thất bại", "error");
  } finally {
    clearTimeout(coldStartTimer);
    setLoading(false);
  }
}

// ---------------- Hiển thị kết quả ----------------
function renderResult(data) {
  hide(els.errorBox);

  // Tác giả và Nền tảng
  const PLATFORM_LABELS = { douyin: "Douyin", tiktok: "TikTok", twitter: "X / Twitter" };
  els.avatar.src = safeMediaUrl(data.author?.avatar || "") || "";
  els.nickname.textContent = data.author?.nickname || "Tác giả không xác định";
  els.uid.textContent = data.author?.unique_id ? "@" + data.author.unique_id : "";
  els.badge.textContent = PLATFORM_LABELS[data.platform] || data.platform;
  els.badge.className = "platform-badge"
    + (data.platform !== "douyin" ? ` platform-badge--${data.platform}` : "");

  // Mô tả và Thống kê
  els.desc.textContent = data.desc || "（Không có mô tả）";
  els.statLikes.textContent = formatCount(data.statistics?.digg_count);
  els.statComments.textContent = formatCount(data.statistics?.comment_count);
  els.statShares.textContent = formatCount(data.statistics?.share_count);

  const isImage = data.type === "image" && (data.images || []).length > 0;

  // Khu vực phương tiện (Media)
  if (isImage) {
    hide(els.videoWrap);
    els.videoPlayer.removeAttribute("src");
    renderCarousel(data.images);
    show(els.carouselWrap);
  } else {
    hide(els.carouselWrap);
    // Backend dự án này: Xem trước qua proxy để tránh màn hình đen do chống hotlink; Node bên thứ ba: Kết nối trực tiếp đường dẫn không watermark (đã kèm no-referrer)
    els.videoPlayer.src = state.style === "native"
      ? apiUrl("/api/download", { url: state.rawInput, media: "video" })
      : (safeMediaUrl(data.video?.nwm_video_url_HQ || data.video?.nwm_video_url || data.video?.wm_video_url || ""));
    els.videoPlayer.poster = safeMediaUrl(data.cover || "") || "";
    show(els.videoWrap);
  }

  // Nút tải xuống
  const video = data.video || {};
  const directUrl = video.nwm_video_url_HQ || video.nwm_video_url || video.wm_video_url;

  if (isImage) {
    hide(els.btnHd);
    const zipHref = downloadHref("images");
    if (zipHref) {
      show(els.btnZip);
      els.btnZip.href = zipHref;
    } else {
      hide(els.btnZip); // Node công cộng không có khả năng nén file, trên Carousel có nút "Mở ảnh đơn trong thẻ mới"
    }
    els.btnDirect.href = safeMediaUrl(data.images[0]) || "#";
  } else {
    show(els.btnHd);
    hide(els.btnZip);
    const hdHref = downloadHref("video");
    if (hdHref) {
      els.btnHd.href = hdHref;
      els.btnHd.removeAttribute("target");
      els.btnHd.rel = "";
    } else {
      // Node công cộng: Chuyển về link trực tiếp CDN không watermark, noreferrer để tránh lỗi 403 do chống hotlink
      els.btnHd.href = safeMediaUrl(directUrl || "") || "#";
      els.btnHd.target = "_blank";
      els.btnHd.rel = "noreferrer noopener";
    }
    els.btnDirect.href = safeMediaUrl(directUrl || "") || "#";
    els.btnDirect.setAttribute("aria-disabled", directUrl ? "false" : "true");
  }

  // Trích xuất âm thanh: Backend dự án này hỗ trợ ffmpeg trích xuất từ luồng video; Node bên thứ ba chỉ có thể dùng link âm thanh trực tiếp
  if (state.style === "native" && (data.music?.url || !isImage)) {
    show(els.btnAudio);
    els.btnAudio.href = downloadHref("audio");
    els.btnAudio.removeAttribute("target");
    els.btnAudio.removeAttribute("rel");
  } else if (data.music?.url) {
    show(els.btnAudio);
    els.btnAudio.href = safeMediaUrl(data.music.url) || "#";
    els.btnAudio.target = "_blank";
    els.btnAudio.rel = "noreferrer noopener";
  } else {
    hide(els.btnAudio);
  }

  show(els.resultCard);
  els.resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------------- Carousel bộ ảnh ----------------
function safeMediaUrl(value) {
  try {
    const url = new URL(value, location.href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function renderCarousel(images) {
  state.slide = 0;
  els.carouselTrack.replaceChildren();
  els.carouselDots.replaceChildren();
  const validImages = images.map(safeMediaUrl).filter(Boolean);
  state.slideCount = validImages.length;

  validImages.forEach((url, i) => {
    const slide = document.createElement("div");
    slide.className = "carousel-slide";
    const image = document.createElement("img");
    image.src = url;
    image.alt = `Ảnh thứ ${i + 1} trong bộ ảnh`;
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    const open = document.createElement("a");
    open.className = "slide-open-btn";
    open.href = url;
    open.target = "_blank";
    open.rel = "noreferrer noopener";
    open.textContent = "Mở ảnh";
    slide.append(image, open);
    els.carouselTrack.appendChild(slide);

    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "carousel-dot";
    dot.setAttribute("aria-label", `Chuyển đến ảnh thứ ${i + 1}`);
    dot.addEventListener("click", () => goToSlide(i));
    els.carouselDots.appendChild(dot);
  });
  state.slideCount = els.carouselTrack.children.length;
  goToSlide(0);
}

function goToSlide(index) {
  const count = state.slideCount;
  if (!count) return;
  state.slide = (index + count) % count;
  els.carouselTrack.style.transform = `translateX(-${state.slide * 100}%)`;
  [...els.carouselDots.children].forEach((dot, i) =>
    dot.classList.toggle("active", i === state.slide)
  );
}

els.carouselPrev.addEventListener("click", () => goToSlide(state.slide - 1));
els.carouselNext.addEventListener("click", () => goToSlide(state.slide + 1));

// Hỗ trợ vuốt cảm ứng
let touchStartX = null;
els.carouselTrack.addEventListener("touchstart", (e) => {
  touchStartX = e.touches[0].clientX;
}, { passive: true });
els.carouselTrack.addEventListener("touchend", (e) => {
  if (touchStartX === null) return;
  const delta = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(delta) > 48) goToSlide(state.slide + (delta < 0 ? 1 : -1));
  touchStartX = null;
}, { passive: true });

// ---------------- Lịch sử phân tích (LocalStorage) ----------------
function loadHistory() {
  try {
    const list = JSON.parse(localStorage.getItem(LS_HISTORY_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveHistory(rawInput, data) {
  const entry = {
    url: rawInput,
    desc: (data.desc || "Không có mô tả").slice(0, 60),
    avatar: data.author?.avatar || "",
    nickname: data.author?.nickname || "",
    time: Date.now(),
  };
  // Lọc trùng (Cùng liên kết chỉ giữ lại bản mới nhất), giới hạn số lượng tối đa
  const list = [entry, ...loadHistory().filter((it) => it.url !== rawInput)]
    .slice(0, HISTORY_LIMIT);
  try { localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(list)); } catch { toast("Không thể lưu lịch sử trên thiết bị này", "info"); }
  renderHistory();
}

function renderHistory() {
  const list = loadHistory();
  if (!list.length) { hide(els.historySection); return; }
  els.historyList.replaceChildren();
  list.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";
    const avatar = document.createElement("img");
    avatar.className = "history-avatar";
    avatar.alt = "";
    avatar.referrerPolicy = "no-referrer";
    avatar.src = safeMediaUrl(item.avatar || "") || "";
    avatar.addEventListener("error", () => { avatar.style.visibility = "hidden"; }, { once: true });
    const meta = document.createElement("div"); meta.className = "history-meta";
    const desc = document.createElement("div"); desc.className = "history-desc"; desc.textContent = item.desc || "Media link";
    const time = document.createElement("div"); time.className = "history-time"; time.textContent = `${item.nickname ? item.nickname + " · " : ""}${timeAgo(item.time)}`;
    meta.append(desc, time);
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("viewBox", "0 0 24 24"); arrow.setAttribute("fill", "none"); arrow.setAttribute("stroke", "currentColor"); arrow.setAttribute("stroke-width", "2"); arrow.setAttribute("stroke-linecap", "round"); arrow.setAttribute("stroke-linejoin", "round"); arrow.classList.add("history-arrow");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); path.setAttribute("points", "9 18 15 12 9 6"); arrow.appendChild(path);
    li.append(avatar, meta, arrow);
    li.addEventListener("click", () => { els.input.value = item.url; parse(item.url); window.scrollTo({ top: 0, behavior: "smooth" }); });
    els.historyList.appendChild(li);
  });
  show(els.historySection);
}

els.clearHistoryBtn.addEventListener("click", () => {
  try { localStorage.removeItem(LS_HISTORY_KEY); } catch {}
  renderHistory();
  toast("Đã xóa lịch sử", "success");
});

// ---------------- Ngăn cấu hình (Settings Drawer) ----------------
function openDrawer() {
  show(els.drawerOverlay);
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  hide(els.drawerOverlay);
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
}

els.settingsBtn.addEventListener("click", openDrawer);
els.closeDrawerBtn.addEventListener("click", closeDrawer);
els.drawerOverlay.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDrawer();
});

els.testApiBtn.addEventListener("click", async () => {
  const value = els.apiBaseInput.value.trim().replace(/\/+$/, "");
  const base = value || apiBase();
  if (!base) { toast("Hãy nhập API Base URL trước", "error"); return; }
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") throw new Error("URL không an toàn");
    const resp = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(12000) });
    const body = await resp.json();
    if (resp.ok && body?.status === "ok") toast("Kết nối API thành công", "success");
    else throw new Error();
  } catch {
    toast("Không thể kết nối. Kiểm tra URL, HTTPS, CORS và endpoint /api/health", "error", 4200);
  }
});

els.saveSettingsBtn.addEventListener("click", () => {
  const raw = els.apiBaseInput.value.trim().replace(/\/+$/, "");
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol === 'http:' && !['localhost','127.0.0.1'].includes(parsed.hostname))) throw new Error();
      localStorage.setItem(LS_API_BASE_KEY, parsed.origin);
    } catch { toast("API Base URL không hợp lệ. Hãy nhập địa chỉ HTTPS", "error"); return; }
  } else localStorage.removeItem(LS_API_BASE_KEY);
  toast("Đã lưu cấu hình API", "success");
  closeDrawer();
});

// Khôi phục cấu hình API đã lưu trên thiết bị
els.apiBaseInput.value = localStorage.getItem(LS_API_BASE_KEY) || "";

// ---------------- Tương tác khu vực nhập ----------------
els.parseBtn.addEventListener("click", () => parse());

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") parse();
});

els.pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) {
      toast("Khay nhớ tạm đang trống", "error");
      return;
    }
    els.input.value = text.trim();
    toast("Đã dán", "success");
    if (extractUrl(text)) parse();
  } catch {
    toast("Không thể đọc khay nhớ tạm, vui lòng dán thủ công (Cmd/Ctrl+V)", "error");
    els.input.focus();
  }
});

// ---------------- Khởi tạo ----------------
renderHistory();