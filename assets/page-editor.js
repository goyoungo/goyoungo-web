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
    var touchedKeys = new Set();
    var isAdmin = false;
    var editing = false;
    var checkingAdmin = false;
    var saving = false;
    var observer = null;
    var processQueued = false;
    var toolbar = null;
    var statusNode = null;

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
            var descriptor = pagePath + "|" + elementPath(node.parentElement) + "|text:" + textSiblingIndex(node);
            return { node: node, key: editKey(descriptor), text: node.nodeValue };
        });

        prepared.forEach(function (item) {
            if (!item.node.parentNode || item.node.parentElement.closest(".page-editable-text")) return;
            if (!baselineByKey.has(item.key)) baselineByKey.set(item.key, item.text);
            var span = document.createElement("span");
            span.className = "page-editable-text";
            span.dataset.pageEditKey = item.key;
            span.textContent = item.text;
            item.node.parentNode.replaceChild(span, item.node);
            applyOverride(span);
        });
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
            wrapTextNodes(scope && scope.isConnected ? scope : editRoot);
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

    function setAdmin(value) {
        isAdmin = Boolean(value);
        if (!isAdmin) editing = false;
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

        toolbar.querySelector("[data-page-editor-start]").addEventListener("click", startEditing);
        toolbar.querySelector("[data-page-editor-save]").addEventListener("click", saveEditing);
        toolbar.querySelector("[data-page-editor-cancel]").addEventListener("click", cancelEditing);
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
        setStatus("수정할 글자를 눌러 바로 입력하세요.", false);
        updateToolbar();
        updateAllEditableStates();
    }

    function currentValueForKey(key) {
        var span = editRoot.querySelector('[data-page-edit-key="' + key + '"]');
        return span ? span.textContent : null;
    }

    function restoreDisplayedValues() {
        editRoot.querySelectorAll(".page-editable-text").forEach(function (span) {
            applyOverride(span);
        });
    }

    function cancelEditing() {
        if (saving) return;
        editing = false;
        touchedKeys.clear();
        restoreDisplayedValues();
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
        var fields = {};
        touchedKeys.forEach(function (key) {
            var value = currentValueForKey(key);
            if (typeof value !== "string") return;
            fields[key] = value === baselineByKey.get(key) ? null : value;
        });
        if (!Object.keys(fields).length) return;

        saving = true;
        setStatus("저장 중…", false);
        updateToolbar();
        try {
            var payload = await requestJson("/admin/pages", {
                method: "PUT",
                headers: {
                    Authorization: "Bearer " + token,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ pagePath: pagePath, fields: fields })
            });
            overrides = payload.fields || {};
            editing = false;
            touchedKeys.clear();
            restoreDisplayedValues();
            setStatus("페이지에 저장했습니다.", false);
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
            var payload = await requestJson("/page-overrides?pagePath=" + encodeURIComponent(pagePath));
            overrides = payload.fields || {};
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
        if (!editing || !event.target.closest("[data-page-edit-key]")) return;
        var link = event.target.closest("a");
        if (link) event.preventDefault();
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
    wrapTextNodes(editRoot);
    observeContent();
    loadOverrides();
    refreshAdminStatus();
    window.setTimeout(refreshAdminStatus, 800);
    window.setTimeout(refreshAdminStatus, 2000);
})();
