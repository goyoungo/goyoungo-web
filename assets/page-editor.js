(function () {
    "use strict";

    var DEFAULT_API_URL = "https://ndx4bl2obl.execute-api.ap-northeast-3.amazonaws.com";
    var apiUrl = window.SITE_DATA && window.SITE_DATA.config && window.SITE_DATA.config.voteApiUrl
        ? String(window.SITE_DATA.config.voteApiUrl).replace(/\/$/, "")
        : DEFAULT_API_URL;
    var pagePath = normalizePagePath(window.location.pathname);
    var editRoot = document.getElementById("mainContent") || document.querySelector("main") || document.body;
    var overrides = {};
    var baselineByKey = new Map();
    var baselineLinkByKey = new Map();
    var syncPathByKey = new Map();
    var touchedKeys = new Set();
    var isAdmin = false;
    var editing = false;
    var checkingAdmin = false;
    var saving = false;
    var observer = null;
    var processQueued = false;
    var toolbar = null;
    var statusNode = null;
    var linkPanel = null;
    var linkInput = null;
    var linkName = null;
    var selectedLink = null;

    function normalizePagePath(value) {
        var path = String(value || "/").replace(/\/{2,}/g, "/");
        if (/\/index\.html$/i.test(path)) {
            path = path.slice(0, -10) || "/";
        }
        return path;
    }

    function authToken() {
        return window.GoyoungoAuth && typeof window.GoyoungoAuth.getAccessToken === "function"
            ? window.GoyoungoAuth.getAccessToken()
            : null;
    }

    async function requestJson(path, options) {
        var response = await fetch(apiUrl + path, Object.assign({ credentials: "omit" }, options || {}));
        var payload = {};
        try { payload = await response.json(); } catch (error) { payload = {}; }
        if (!response.ok) {
            var requestError = new Error(payload.message || "요청을 처리하지 못했습니다.");
            requestError.status = response.status;
            throw requestError;
        }
        return payload;
    }

    function hashPart(value, seed) {
        var hash = seed >>> 0;
        for (var index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function editKey(value) {
        return "t_" + hashPart(value, 2166136261) + hashPart(value, 3339675911);
    }

    function linkKey(value) {
        return "l_" + hashPart(value, 2166136261) + hashPart(value, 3339675911);
    }

    function editableSiblingIndex(element) {
        var tagName = element.tagName;
        var siblings = Array.from(element.parentElement ? element.parentElement.children : []).filter(function (candidate) {
            return candidate.tagName === tagName && !candidate.classList.contains("page-editable-text");
        });
        return Math.max(0, siblings.indexOf(element));
    }

    function elementPath(element) {
        var parts = [];
        var current = element;
        while (current && current !== editRoot && current.nodeType === 1) {
            if (current.id && !/^pageEditor/.test(current.id)) {
                parts.unshift("#" + current.id);
                break;
            }
            parts.unshift(current.tagName.toLowerCase() + ":" + editableSiblingIndex(current));
            current = current.parentElement;
        }
        return parts.join("/");
    }

    function textSiblingIndex(node) {
        var siblings = Array.from(node.parentNode ? node.parentNode.childNodes : []).filter(function (candidate) {
            if (candidate.nodeType === 3) return Boolean(String(candidate.nodeValue || "").trim());
            return candidate.nodeType === 1 && candidate.classList.contains("page-editable-text");
        });
        return Math.max(0, siblings.indexOf(node));
    }

    function excludedTextNode(node) {
        var parent = node.parentElement;
        if (!parent || !String(node.nodeValue || "").trim()) return true;
        if (/^[\s·›→↗—|]+$/.test(String(node.nodeValue || ""))) return true;
        return Boolean(parent.closest([
            "script", "style", "noscript", "template", "svg", "canvas",
            "input", "textarea", "select", "option", "button", "code", "pre",
            ".login-screen", ".page-editor-toolbar", ".page-editable-text",
            ".admin-modal", "[data-no-page-edit]", "[aria-live]"
        ].join(",")));
    }

    function collectTextNodes(scope) {
        var nodes = [];
        if (!scope) return nodes;
        if (scope.nodeType === 3) {
            if (!excludedTextNode(scope)) nodes.push(scope);
            return nodes;
        }
        if (scope.nodeType !== 1 || scope.closest(".page-editor-toolbar, .login-screen, [data-no-page-edit]")) {
            return nodes;
        }
        var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                return excludedTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
            }
        });
        var current;
        while ((current = walker.nextNode())) nodes.push(current);
        return nodes;
    }

    function applyOverride(span) {
        var key = span.dataset.pageEditKey;
        var hasOverride = Object.prototype.hasOwnProperty.call(overrides, key);
        var value = hasOverride
            ? overrides[key]
            : baselineByKey.get(key);
        if (typeof value === "string" && span.textContent !== value) span.textContent = value;
        span.classList.toggle(
            "page-editable-multiline",
            hasOverride && typeof value === "string" && value.includes("\n")
        );
        updateEditableState(span);
    }

    function wrapTextNodes(scope) {
        var nodes = collectTextNodes(scope);
        var prepared = nodes.map(function (node) {
            var syncRoot = node.parentElement.closest("[data-page-sync-id][data-page-sync-path]");
            var syncPath = syncRoot ? normalizePagePath(syncRoot.dataset.pageSyncPath) : null;
            var descriptor = syncRoot
                ? "sync|" + syncRoot.dataset.pageSyncId + "|text:" + textSiblingIndex(node)
                : pagePath + "|" + elementPath(node.parentElement) + "|text:" + textSiblingIndex(node);
            return { node: node, key: editKey(descriptor), text: node.nodeValue, syncPath: syncPath };
        });

        prepared.forEach(function (item) {
            if (!item.node.parentNode || item.node.parentElement.closest(".page-editable-text")) return;
            if (!baselineByKey.has(item.key)) baselineByKey.set(item.key, item.text);
            if (item.syncPath) syncPathByKey.set(item.key, item.syncPath);
            var span = document.createElement("span");
            span.className = "page-editable-text";
            span.dataset.pageEditKey = item.key;
            span.textContent = item.text;
            item.node.parentNode.replaceChild(span, item.node);
            applyOverride(span);
        });
    }

    function applyLinkOverride(link) {
        var key = link.dataset.pageLinkKey;
        var value = Object.prototype.hasOwnProperty.call(overrides, key)
            ? overrides[key]
            : baselineLinkByKey.get(key);
        if (typeof value === "string" && link.getAttribute("href") !== value) {
            link.setAttribute("href", value);
        }
    }

    function prepareLinks(scope) {
        if (!scope || scope.nodeType !== 1) return;
        var links = [];
        if (scope.matches("a[href]")) links.push(scope);
        scope.querySelectorAll("a[href]").forEach(function (link) { links.push(link); });
        links.forEach(function (link) {
            if (
                link.dataset.pageLinkKey ||
                !editRoot.contains(link) ||
                link.closest(".page-editor-toolbar, .login-screen, [data-no-page-edit]")
            ) return;
            var syncRoot = link.closest("[data-page-sync-id][data-page-sync-path]");
            var syncPath = syncRoot ? normalizePagePath(syncRoot.dataset.pageSyncPath) : null;
            var descriptor = syncRoot
                ? "sync|" + syncRoot.dataset.pageSyncId + "|href"
                : pagePath + "|" + elementPath(link) + "|href";
            var key = linkKey(descriptor);
            link.dataset.pageLinkKey = key;
            link.classList.add("page-editable-link");
            if (!baselineLinkByKey.has(key)) {
                baselineLinkByKey.set(key, link.getAttribute("href"));
            }
            if (syncPath) syncPathByKey.set(key, syncPath);
            applyLinkOverride(link);
        });
    }

    function processEditableContent(scope) {
        wrapTextNodes(scope);
        prepareLinks(scope);
    }

    function updateEditableState(span) {
        if (editing && isAdmin) {
            span.setAttribute("contenteditable", "plaintext-only");
            span.setAttribute("spellcheck", "true");
            span.setAttribute("role", "textbox");
            span.setAttribute("aria-label", "페이지 글자 수정");
        } else {
            span.removeAttribute("contenteditable");
            span.removeAttribute("spellcheck");
            span.removeAttribute("role");
            span.removeAttribute("aria-label");
        }
    }

    function updateAllEditableStates() {
        editRoot.querySelectorAll(".page-editable-text").forEach(updateEditableState);
        document.body.toggleAttribute("data-page-editing", editing && isAdmin);
    }

    function scheduleProcess(scope) {
        if (processQueued) return;
        processQueued = true;
        window.requestAnimationFrame(function () {
            processQueued = false;
            processEditableContent(scope && scope.isConnected ? scope : editRoot);
        });
    }

    function observeContent() {
        observer = new MutationObserver(function (mutations) {
            var scope = null;
            mutations.some(function (mutation) {
                for (var index = 0; index < mutation.addedNodes.length; index += 1) {
                    var node = mutation.addedNodes[index];
                    if (node.nodeType === 3 || node.nodeType === 1) {
                        scope = mutation.target.nodeType === 1 ? mutation.target : editRoot;
                        return true;
                    }
                }
                return false;
            });
            if (scope) scheduleProcess(scope);
        });
        observer.observe(editRoot, { childList: true, subtree: true });
    }

    function setStatus(message, error) {
        if (!statusNode) return;
        statusNode.textContent = message || "";
        statusNode.classList.toggle("is-error", Boolean(error));
    }

    function validLinkValue(value) {
        var text = String(value || "").trim();
        if (!text || text.length > 2048) return false;
        if (/^(?:#|\?|\/(?!\/)|\.\.?\/)/.test(text)) return true;
        if (/^mailto:[^\s]+$/i.test(text)) return true;
        if (/^tel:[0-9+().\s-]+$/i.test(text)) return true;
        try {
            var parsed = new URL(text);
            return parsed.protocol === "https:" || parsed.protocol === "http:";
        } catch (error) {
            return false;
        }
    }

    function clearLinkSelection() {
        if (selectedLink) selectedLink.classList.remove("is-page-link-selected");
        selectedLink = null;
        if (linkPanel) linkPanel.hidden = true;
        if (linkInput) linkInput.value = "";
        if (linkName) linkName.textContent = "";
    }

    function selectLink(link) {
        if (!editing || !isAdmin || !link || !link.dataset.pageLinkKey) return;
        if (selectedLink && selectedLink !== link) {
            selectedLink.classList.remove("is-page-link-selected");
        }
        selectedLink = link;
        selectedLink.classList.add("is-page-link-selected");
        linkPanel.hidden = false;
        linkInput.value = link.getAttribute("href") || "";
        linkName.textContent = (link.innerText || link.textContent || "링크").trim().slice(0, 80);
        setStatus("선택한 링크의 주소를 수정할 수 있습니다.", false);
    }

    function setAdmin(value) {
        isAdmin = Boolean(value);
        if (!isAdmin) {
            editing = false;
            clearLinkSelection();
        }
        document.body.toggleAttribute("data-page-admin", isAdmin);
        if (toolbar) toolbar.hidden = !isAdmin;
        updateToolbar();
        updateAllEditableStates();
    }

    function toolbarHtml() {
        return [
            '<aside class="page-editor-toolbar" id="pageEditorToolbar" aria-label="관리자 페이지 수정" hidden data-no-page-edit>',
            '<div class="page-editor-toolbar-head"><strong>ADMIN</strong><span>페이지 콘텐츠</span></div>',
            '<div class="page-editor-actions">',
            '<button type="button" data-page-editor-start>페이지 수정</button>',
            '<button type="button" data-page-editor-save hidden>저장</button>',
            '<button type="button" data-page-editor-cancel hidden>취소</button>',
            '</div>',
            '<div class="page-editor-link-panel" data-page-editor-link-panel hidden>',
            '<label for="pageEditorLinkInput">선택한 링크 주소</label>',
            '<span data-page-editor-link-name></span>',
            '<input id="pageEditorLinkInput" type="text" inputmode="url" autocomplete="off" spellcheck="false">',
            '<small>외부 링크는 http:// 또는 https://로 입력하세요.</small>',
            '</div>',
            '<p class="page-editor-status" data-page-editor-status role="status" aria-live="polite"></p>',
            '</aside>'
        ].join("");
    }

    function createToolbar() {
        var holder = document.createElement("div");
        holder.innerHTML = toolbarHtml();
        toolbar = holder.firstElementChild;
        document.body.appendChild(toolbar);
        statusNode = toolbar.querySelector("[data-page-editor-status]");
        linkPanel = toolbar.querySelector("[data-page-editor-link-panel]");
        linkInput = toolbar.querySelector("#pageEditorLinkInput");
        linkName = toolbar.querySelector("[data-page-editor-link-name]");

        toolbar.querySelector("[data-page-editor-start]").addEventListener("click", startEditing);
        toolbar.querySelector("[data-page-editor-save]").addEventListener("click", saveEditing);
        toolbar.querySelector("[data-page-editor-cancel]").addEventListener("click", cancelEditing);
        linkInput.addEventListener("input", function () {
            if (!editing || !selectedLink) return;
            selectedLink.setAttribute("href", linkInput.value.trim());
            touchedKeys.add(selectedLink.dataset.pageLinkKey);
            setStatus(touchedKeys.size + "개 항목이 변경되었습니다.", false);
            updateToolbar();
        });
    }

    function updateToolbar() {
        if (!toolbar) return;
        var start = toolbar.querySelector("[data-page-editor-start]");
        var save = toolbar.querySelector("[data-page-editor-save]");
        var cancel = toolbar.querySelector("[data-page-editor-cancel]");
        start.hidden = editing;
        save.hidden = !editing;
        cancel.hidden = !editing;
        save.disabled = saving || touchedKeys.size === 0;
        cancel.disabled = saving;
    }

    function startEditing() {
        if (!isAdmin) return;
        editing = true;
        touchedKeys.clear();
        clearLinkSelection();
        setStatus("글자를 수정하거나 링크를 눌러 주소를 바꾸세요.", false);
        updateToolbar();
        updateAllEditableStates();
    }

    function currentValueForKey(key) {
        if (key.indexOf("l_") === 0) {
            var link = editRoot.querySelector('[data-page-link-key="' + key + '"]');
            return link ? link.getAttribute("href") : null;
        }
        var span = editRoot.querySelector('[data-page-edit-key="' + key + '"]');
        return span ? span.textContent : null;
    }

    function baselineValueForKey(key) {
        return key.indexOf("l_") === 0 ? baselineLinkByKey.get(key) : baselineByKey.get(key);
    }

    function restoreDisplayedValues() {
        editRoot.querySelectorAll(".page-editable-text").forEach(function (span) {
            applyOverride(span);
        });
        editRoot.querySelectorAll("[data-page-link-key]").forEach(function (link) {
            applyLinkOverride(link);
        });
    }

    function cancelEditing() {
        if (saving) return;
        editing = false;
        touchedKeys.clear();
        restoreDisplayedValues();
        clearLinkSelection();
        setStatus("수정을 취소했습니다.", false);
        updateToolbar();
        updateAllEditableStates();
    }

    async function saveEditing() {
        if (!isAdmin || saving || touchedKeys.size === 0) return;
        var token = authToken();
        if (!token) {
            setAdmin(false);
            return;
        }
        var fieldsByPath = {};
        var invalidLink = null;
        var hasSharedField = false;
        touchedKeys.forEach(function (key) {
            var value = currentValueForKey(key);
            if (typeof value !== "string") return;
            if (key.indexOf("l_") === 0 && !validLinkValue(value)) {
                invalidLink = editRoot.querySelector('[data-page-link-key="' + key + '"]');
                return;
            }
            var targetPath = syncPathByKey.get(key) || pagePath;
            if (targetPath !== pagePath) hasSharedField = true;
            if (!fieldsByPath[targetPath]) fieldsByPath[targetPath] = {};
            fieldsByPath[targetPath][key] = value === baselineValueForKey(key) ? null : value;
        });
        if (invalidLink) {
            selectLink(invalidLink);
            setStatus("링크 주소를 확인해 주세요. 외부 주소는 http:// 또는 https://가 필요합니다.", true);
            linkInput.focus();
            return;
        }
        if (!Object.keys(fieldsByPath).length) return;

        saving = true;
        setStatus("저장 중…", false);
        updateToolbar();
        try {
            await Promise.all(Object.keys(fieldsByPath).map(function (targetPath) {
                return requestJson("/admin/pages", {
                    method: "PUT",
                    headers: {
                        Authorization: "Bearer " + token,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ pagePath: targetPath, fields: fieldsByPath[targetPath] })
                });
            }));
            await loadOverrides();
            editing = false;
            touchedKeys.clear();
            restoreDisplayedValues();
            clearLinkSelection();
            setStatus(hasSharedField ? "연결된 카드와 본문에 함께 저장했습니다." : "페이지에 저장했습니다.", false);
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                setAdmin(false);
                if (error.status === 401 && window.GoyoungoAuth && typeof window.GoyoungoAuth.reauthenticate === "function") {
                    window.GoyoungoAuth.reauthenticate("페이지 수정을 계속하려면 카카오 로그인을 다시 해주세요.");
                }
            }
            setStatus(error.message || "저장하지 못했습니다.", true);
        } finally {
            saving = false;
            updateToolbar();
            updateAllEditableStates();
        }
    }

    async function loadOverrides() {
        try {
            var targetPaths = Array.from(new Set([pagePath].concat(Array.from(syncPathByKey.values()))));
            var payloads = await Promise.all(targetPaths.map(function (targetPath) {
                return requestJson("/page-overrides?pagePath=" + encodeURIComponent(targetPath));
            }));
            overrides = {};
            payloads.forEach(function (payload) {
                Object.assign(overrides, payload.fields || {});
            });
            restoreDisplayedValues();
        } catch (error) {
            console.warn("Page content overrides unavailable", error && error.message);
        }
    }

    async function refreshAdminStatus() {
        var token = authToken();
        if (!token || checkingAdmin) {
            if (!token) setAdmin(false);
            return;
        }
        checkingAdmin = true;
        try {
            var payload = await requestJson("/admin/me", {
                headers: { Authorization: "Bearer " + token }
            });
            setAdmin(payload.isAdmin === true);
        } catch (error) {
            setAdmin(false);
        } finally {
            checkingAdmin = false;
        }
    }

    editRoot.addEventListener("input", function (event) {
        var target = event.target.closest("[data-page-edit-key]");
        if (!editing || !isAdmin || !target || !editRoot.contains(target)) return;
        touchedKeys.add(target.dataset.pageEditKey);
        target.classList.toggle("page-editable-multiline", target.textContent.includes("\n"));
        setStatus(touchedKeys.size + "개 항목이 변경되었습니다.", false);
        updateToolbar();
    });

    document.addEventListener("click", function (event) {
        if (!editing) return;
        var link = event.target.closest("a[data-page-link-key]");
        if (!link || !editRoot.contains(link)) return;
        event.preventDefault();
        selectLink(link);
    }, true);

    document.addEventListener("keydown", function (event) {
        if (!editing) return;
        if (event.key === "Escape") cancelEditing();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            saveEditing();
        }
    });

    document.addEventListener("goyoungo:authchange", function (event) {
        if (event.detail && event.detail.authenticated) refreshAdminStatus();
        else setAdmin(false);
    });

    createToolbar();
    processEditableContent(editRoot);
    observeContent();
    loadOverrides();
    refreshAdminStatus();
    window.setTimeout(refreshAdminStatus, 800);
    window.setTimeout(refreshAdminStatus, 2000);
})();
