(function () {
    "use strict";

    var MAX_PHOTOS = 6;
    var MAX_PHOTO_BYTES = 600 * 1024;
    var resorts = ["웰리힐리파크", "휘닉스 평창", "모나 용평", "하이원리조트", "곤지암리조트", "지산포레스트리조트", "오투리조트", "비발디파크", "엘리시안 강촌", "무주덕유산리조트", "양지파인"];
    var stays = ["주중", "주말", "풀상주"];
    var filters = { type: "", status: "", resort: "", season: "", stay: "", budget: "" };
    var draft = [];
    var draftEpoch = 0;
    var pending = Promise.resolve();
    var activeForm = null;

    function esc(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
        });
    }

    function currentSeason() {
        var date = new Date();
        var year = date.getFullYear() - (date.getMonth() < 5 ? 1 : 0);
        return String(year).slice(-2) + "/" + String(year + 1).slice(-2);
    }

    function timestamp(value) {
        var korean = /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(?:\s*(\d{1,2}):(\d{1,2}))?/.exec(String(value || ""));
        if (korean) return Date.UTC(+korean[1], +korean[2] - 1, +korean[3], +(korean[4] || 0), +(korean[5] || 0)) - 9 * 3600000;
        var parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function filteredItems(items, criteria) {
        criteria = criteria || filters;
        return items.map(function (item, index) { return { item: item, index: index }; }).filter(function (entry) {
            var item = entry.item;
            if (criteria.type && item.type !== criteria.type) return false;
            if (criteria.status && item.status !== criteria.status) return false;
            if (criteria.resort && item.resort !== criteria.resort) return false;
            if (criteria.season && item.season !== criteria.season) return false;
            if (criteria.stay && (item.stayTypes || []).indexOf(criteria.stay) < 0) return false;
            if (criteria.budget !== "" && criteria.budget != null) {
                if (item.budgetManwon == null || !Number.isFinite(Number(item.budgetManwon)) || Number(item.budgetManwon) > Number(criteria.budget)) return false;
            }
            return true;
        }).sort(function (a, b) {
            var completed = Number(a.item.status === "완료") - Number(b.item.status === "완료");
            return completed || timestamp(b.item.updatedAt) - timestamp(a.item.updatedAt) || a.index - b.index;
        }).map(function (entry) { return entry.item; });
    }

    function photoUrl(apiUrl, photoId) {
        return String(apiUrl || "").replace(/\/$/, "") + "/season-photos/" + encodeURIComponent(photoId);
    }

    function options(values, selected, emptyLabel) {
        return '<option value="">' + esc(emptyLabel) + '</option>' + values.map(function (value) {
            return '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(value) + '</option>';
        }).join("");
    }

    function fieldsHtml() {
        return [
            '<label>스키장<select name="resort">' + options(resorts, "", "미입력") + '</select></label>',
            '<label>시즌<input name="season" maxlength="5" pattern="[0-9]{2}/[0-9]{2}" placeholder="' + currentSeason() + '"></label>',
            '<fieldset class="season-stay-fields admin-form-wide"><legend>이용 형태</legend>' + stays.map(function (stay) {
                return '<label><input type="checkbox" name="stayType" value="' + stay + '"><span>' + stay + '</span></label>';
            }).join("") + '</fieldset>',
            '<label class="admin-form-wide">대표 시즌 비용 (만원)<input name="budgetManwon" type="number" min="0" max="10000" step="1" placeholder="예: 80"><small>예산 필터에 사용할 금액입니다. 주중·주말별 비용과 포함 항목은 아래 금액 칸에 적어 주세요.</small></label>',
            '<section class="season-photo-editor admin-form-wide" aria-label="모집 사진">',
            '<strong>사진</strong><div class="season-photo-drop" data-season-drop tabindex="0" role="group" aria-label="사진 파일을 놓거나 복사한 이미지를 붙여넣으세요">',
            '<span aria-hidden="true">＋</span><p>사진을 여기에 놓거나 붙여넣으세요</p><small>최대 6장 · 저장한 사진은 게시판에 공개됩니다</small>',
            '<button type="button" class="action-link" data-season-photo-pick>사진 선택</button>',
            '<input type="file" data-season-photo-input accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple hidden>',
            '</div><p class="season-photo-message" data-season-photo-message role="status" aria-live="polite"></p>',
            '<div class="season-photo-previews" data-season-photo-previews></div></section>'
        ].join("");
    }

    function editorMessage(message, error) {
        if (!activeForm) return;
        var element = activeForm.querySelector("[data-season-photo-message]");
        if (!element) return;
        element.textContent = message || "";
        element.classList.toggle("is-error", Boolean(error));
    }

    function paintPhotos() {
        if (!activeForm) return;
        activeForm.querySelector("[data-season-photo-previews]").innerHTML = draft.map(function (photo, index) {
            return '<div class="season-photo-preview"><img src="' + esc(photo.url) + '" alt="등록할 사진 ' + (index + 1) + '">' +
                '<span>' + (index === 0 ? "대표 사진" : "사진 " + (index + 1)) + '</span>' +
                '<button type="button" data-season-photo-remove="' + index + '" aria-label="사진 ' + (index + 1) + ' 제거">×</button></div>';
        }).join("");
    }

    function resetDraft() {
        draftEpoch++;
        draft.forEach(function (photo) { if (photo.blob) URL.revokeObjectURL(photo.url); });
        draft = [];
        activeForm = null;
        pending = Promise.resolve();
    }

    function openEditor(form, item, apiUrl) {
        resetDraft();
        activeForm = form;
        form.elements.resort.value = item ? (item.resort || "") : "";
        form.elements.season.value = item ? (item.season || "") : currentSeason();
        form.elements.budgetManwon.value = item && item.budgetManwon != null ? item.budgetManwon : "";
        form.querySelectorAll('[name="stayType"]').forEach(function (input) {
            input.checked = Boolean(item && (item.stayTypes || []).indexOf(input.value) >= 0);
        });
        draft = (item && item.photos || []).map(function (id) { return { id: id, url: photoUrl(apiUrl, id) }; });
        editorMessage("");
        paintPhotos();
    }

    function readDataUrl(blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(reader.result); };
            reader.onerror = function () { reject(new Error("사진 파일을 읽지 못했습니다.")); };
            reader.readAsDataURL(blob);
        });
    }

    async function compressImage(file) {
        if (file.size > 20 * 1024 * 1024) throw new Error("사진 한 장은 20MB 이하로 선택해 주세요.");
        var url = URL.createObjectURL(file);
        var image = new Image();
        try {
            await new Promise(function (resolve, reject) {
                image.onload = resolve;
                image.onerror = function () { reject(new Error("이 사진 형식을 열 수 없습니다. JPG·PNG·WebP 사진을 선택해 주세요.")); };
                image.src = url;
            });
            var canvas = document.createElement("canvas");
            var scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            var context = canvas.getContext("2d");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            for (var quality of [0.85, 0.7, 0.55, 0.4]) {
                var blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", quality); });
                if (blob && blob.size <= MAX_PHOTO_BYTES) return blob;
            }
            throw new Error("사진 용량을 충분히 줄이지 못했습니다. 더 작은 사진을 선택해 주세요.");
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function addFiles(files) {
        var epoch = draftEpoch;
        var selected = Array.from(files || []).filter(function (file) { return /^image\//.test(file.type); });
        if (!selected.length) { editorMessage("이미지 파일을 선택해 주세요.", true); return; }
        pending = pending.then(async function () {
            for (var file of selected) {
                if (epoch !== draftEpoch) return;
                if (draft.length >= MAX_PHOTOS) { editorMessage("사진은 최대 6장까지 추가할 수 있습니다.", true); break; }
                editorMessage("사진을 준비하고 있습니다…");
                try {
                    var blob = await compressImage(file);
                    if (epoch !== draftEpoch) return;
                    draft.push({ blob: blob, url: URL.createObjectURL(blob) });
                    paintPhotos();
                    editorMessage(draft.length + "장 준비 완료 · 저장 버튼을 누르면 업로드됩니다.");
                } catch (error) {
                    if (epoch !== draftEpoch) return;
                    editorMessage(error.message, true);
                }
            }
        });
    }

    function bindEditor(root) {
        root.addEventListener("click", function (event) {
            if (event.target.closest("[data-season-photo-pick]")) {
                var form = event.target.closest("[data-collection-form]");
                form.querySelector("[data-season-photo-input]").click();
            }
            var remove = event.target.closest("[data-season-photo-remove]");
            if (remove && activeForm) {
                var photo = draft.splice(Number(remove.dataset.seasonPhotoRemove), 1)[0];
                if (photo && photo.blob) URL.revokeObjectURL(photo.url);
                paintPhotos();
                editorMessage(draft.length ? draft.length + "장 준비됨" : "");
            }
        });
        root.addEventListener("change", function (event) {
            if (!event.target.matches("[data-season-photo-input]")) return;
            addFiles(event.target.files);
            event.target.value = "";
        });
        root.addEventListener("dragover", function (event) {
            var drop = event.target.closest("[data-season-drop]");
            if (!drop) return;
            event.preventDefault();
            drop.classList.add("is-dragging");
        });
        root.addEventListener("dragleave", function (event) {
            var drop = event.target.closest("[data-season-drop]");
            if (drop && !drop.contains(event.relatedTarget)) drop.classList.remove("is-dragging");
        });
        root.addEventListener("drop", function (event) {
            var drop = event.target.closest("[data-season-drop]");
            if (!drop) return;
            event.preventDefault();
            drop.classList.remove("is-dragging");
            addFiles(event.dataTransfer.files);
        });
        root.addEventListener("paste", function (event) {
            if (!activeForm || !activeForm.contains(event.target)) return;
            var files = Array.from(event.clipboardData && event.clipboardData.files || []).filter(function (file) { return /^image\//.test(file.type); });
            if (!files.length) return;
            event.preventDefault();
            addFiles(files);
        });
    }

    async function saveEditor(form, upload) {
        var epoch = draftEpoch;
        await pending;
        if (epoch !== draftEpoch || form !== activeForm) throw new Error("편집 화면이 바뀌었습니다. 다시 저장해 주세요.");
        for (var index = 0; index < draft.length; index++) {
            var photo = draft[index];
            if (photo.id) continue;
            editorMessage("사진 업로드 중 · " + (index + 1) + "/" + draft.length);
            var base64 = String(await readDataUrl(photo.blob)).split(",")[1];
            var uploaded = await upload({ contentType: "image/jpeg", data: base64 });
            if (epoch !== draftEpoch) throw new Error("편집 화면이 닫혔습니다. 다시 저장해 주세요.");
            photo.id = uploaded.photoId;
        }
        var budget = form.elements.budgetManwon.value;
        return {
            resort: form.elements.resort.value,
            season: form.elements.season.value.trim(),
            stayTypes: Array.from(form.querySelectorAll('[name="stayType"]:checked')).map(function (input) { return input.value; }),
            budgetManwon: budget === "" ? null : Number(budget),
            photos: draft.map(function (photo) { return photo.id; })
        };
    }

    function coverHtml(item, apiUrl) {
        if (!item.photos || !item.photos.length) return "";
        return '<button type="button" class="season-cover" data-season-gallery="' + esc(item.id) + '" aria-label="' + esc(item.name) + ' 사진 ' + item.photos.length + '장 보기">' +
            '<img src="' + esc(photoUrl(apiUrl, item.photos[0])) + '" alt="' + esc(item.name) + ' 대표 사진" loading="lazy" decoding="async">' +
            '<span>사진 ' + item.photos.length + '장 보기 ↗</span></button>';
    }

    function metadataHtml(item) {
        var values = [item.resort, item.season ? item.season + " 시즌" : "", (item.stayTypes || []).join(" · ")].filter(Boolean);
        return values.length ? '<div class="season-tags">' + values.map(function (value) { return '<span>' + esc(value) + '</span>'; }).join("") + '</div>' : "";
    }

    function filtersHtml(items) {
        var seasons = Array.from(new Set([currentSeason()].concat(items.map(function (item) { return item.season; }).filter(Boolean)))).sort().reverse();
        return '<section class="season-filter-panel" aria-label="모집글 필터" data-no-page-edit><form data-season-filters>' +
            '<label>모집 목적<select name="type">' + options(["주주 구해요", "시즌방 구해요"], filters.type, "전체") + '</select></label>' +
            '<label>스키장<select name="resort">' + options(resorts, filters.resort, "전체") + '</select></label>' +
            '<label>시즌<select name="season">' + options(seasons, filters.season, "전체") + '</select></label>' +
            '<label>이용 형태<select name="stay">' + options(stays, filters.stay, "전체") + '</select></label>' +
            '<label>모집 상태<select name="status">' + options(["진행중", "완료"], filters.status, "전체") + '</select></label>' +
            '<label>예산 이하 (만원)<input name="budget" type="number" min="0" step="10" value="' + esc(filters.budget) + '" placeholder="제한 없음"></label>' +
            '<button type="button" class="action-link" data-season-reset>필터 초기화</button></form>' +
            '<div class="season-filter-summary"><p data-season-count role="status" aria-live="polite"></p><small>완료된 글은 뒤쪽에 표시됩니다.</small></div>' +
            '<p class="season-budget-note" data-season-budget-note hidden>예산 필터는 대표 시즌 비용이 입력된 글에 적용됩니다.</p></section>';
    }

    function mount(root, page, cardHtml, apiUrl) {
        var grid = root.querySelector("[data-season-grid]");
        var form = root.querySelector("[data-season-filters]");
        function paint() {
            var items = filteredItems(page.items);
            grid.innerHTML = items.length ? items.map(cardHtml).join("") : '<div class="empty-state"><h2>조건에 맞는 글이 없습니다</h2><p>필터를 조정해서 다시 찾아보세요.</p></div>';
            root.querySelector("[data-season-count]").textContent = "전체 " + page.items.length + "개 중 " + items.length + "개 · 진행중 " + items.filter(function (item) { return item.status !== "완료"; }).length + "개";
            root.querySelector("[data-season-budget-note]").hidden = filters.budget === "";
            grid.querySelectorAll("[data-collection-admin]").forEach(function (element) {
                element.hidden = !root.querySelector("[data-collection-admin]:not([hidden])");
            });
        }
        form.addEventListener("submit", function (event) { event.preventDefault(); });
        form.addEventListener("input", function () {
            Object.keys(filters).forEach(function (key) { filters[key] = form.elements[key].value; });
            paint();
        });
        root.querySelector("[data-season-reset]").addEventListener("click", function () {
            Object.keys(filters).forEach(function (key) { filters[key] = ""; form.elements[key].value = ""; });
            paint();
        });
        grid.addEventListener("click", function (event) {
            var button = event.target.closest("[data-season-gallery]");
            if (!button) return;
            var item = page.items.find(function (candidate) { return candidate.id === button.dataset.seasonGallery; });
            if (item) openGallery(root, item, apiUrl);
        });
        paint();
    }

    function openGallery(root, item, apiUrl) {
        var dialog = document.createElement("dialog");
        dialog.className = "season-gallery";
        dialog.setAttribute("aria-label", item.name + " 사진");
        dialog.innerHTML = '<div class="season-gallery-head"><strong>' + esc(item.name) + '</strong><button type="button" data-gallery-close aria-label="사진 닫기">×</button></div>' +
            '<img alt=""><div class="season-gallery-nav"><button type="button" data-gallery-prev aria-label="이전 사진">←</button><span aria-live="polite"></span><button type="button" data-gallery-next aria-label="다음 사진">→</button></div>';
        var index = 0;
        function paint() {
            var image = dialog.querySelector("img");
            image.src = photoUrl(apiUrl, item.photos[index]);
            image.alt = item.name + " 사진 " + (index + 1);
            dialog.querySelector(".season-gallery-nav span").textContent = (index + 1) + " / " + item.photos.length;
            dialog.querySelector("[data-gallery-prev]").disabled = index === 0;
            dialog.querySelector("[data-gallery-next]").disabled = index === item.photos.length - 1;
        }
        dialog.querySelector("[data-gallery-close]").addEventListener("click", function () { dialog.close(); });
        dialog.querySelector("[data-gallery-prev]").addEventListener("click", function () { index--; paint(); });
        dialog.querySelector("[data-gallery-next]").addEventListener("click", function () { index++; paint(); });
        dialog.addEventListener("click", function (event) { if (event.target === dialog) dialog.close(); });
        dialog.addEventListener("close", function () { dialog.remove(); });
        root.appendChild(dialog);
        paint();
        dialog.showModal();
    }

    var api = { filteredItems: filteredItems, timestamp: timestamp, fieldsHtml: fieldsHtml, filtersHtml: filtersHtml, metadataHtml: metadataHtml, coverHtml: coverHtml, openEditor: openEditor, resetDraft: resetDraft, bindEditor: bindEditor, saveEditor: saveEditor, mount: mount };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    if (typeof window !== "undefined") window.GoyoungoSeasonBoard = api;
}());
