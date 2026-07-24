(function () {
    "use strict";

    var KAKAO_JS_KEY = "0ffa9164b98f13f79e8dd6902be2f599";
    var SDK_LOAD_ERROR = "카카오 로그인 파일을 불러오지 못했습니다. 광고·추적 차단 기능에서 t1.kakaocdn.net을 허용한 뒤 새로고침해 주세요.";
    var localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
        new URLSearchParams(window.location.search).has("preview");
    var activeUi = null;
    var pendingAction = null;
    var returnFocus = null;
    var sdkReady = false;
    var sessionInvalidated = false;

    function getAccessToken() {
        if (sessionInvalidated) return null;
        try {
            return window.Kakao && Kakao.isInitialized()
                ? Kakao.Auth.getAccessToken()
                : null;
        } catch (error) {
            return null;
        }
    }

    function isAuthenticated() {
        return Boolean(getAccessToken());
    }

    function dispatchAuthChange(authenticated) {
        document.dispatchEvent(new CustomEvent("goyoungo:authchange", {
            detail: { authenticated: Boolean(authenticated) }
        }));
    }

    function ensureLoginDialog() {
        var existing = document.getElementById("loginScreen");
        if (existing) return existing;

        var dialog = document.createElement("section");
        dialog.id = "loginScreen";
        dialog.className = "login-screen";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        dialog.setAttribute("aria-labelledby", "loginTitle");
        dialog.hidden = true;
        dialog.innerHTML = [
            '<div class="login-card">',
            '<button id="loginCloseBtn" class="login-close" type="button" aria-label="로그인 창 닫기">×</button>',
            '<div class="login-mark" aria-hidden="true">🔐</div>',
            '<h1 id="loginTitle">참여하려면 카카오 로그인</h1>',
            "<p>정보 열람은 로그인 없이 가능합니다.<br>평가와 정보 수정 요청에만 로그인이 필요해요.</p>",
            '<button id="kakaoLoginBtn" type="button">카카오 로그인</button>',
            '<p id="authStatus" class="auth-status" role="status" aria-live="polite"></p>',
            "</div>"
        ].join("");
        document.body.insertBefore(dialog, document.body.firstChild);
        return dialog;
    }

    function elements() {
        ensureLoginDialog();
        return {
            loginScreen: document.getElementById("loginScreen"),
            mainContent: document.getElementById("mainContent"),
            loginButton: document.getElementById("kakaoLoginBtn"),
            closeButton: document.getElementById("loginCloseBtn"),
            accountButton: document.getElementById("logoutBtn"),
            authStatus: document.getElementById("authStatus"),
            main: document.getElementById("main")
        };
    }

    function setStatus(ui, message) {
        ui.authStatus.textContent = message || "";
    }

    function setLoading(ui, loading) {
        ui.loginButton.disabled = loading || !sdkReady;
        ui.loginButton.textContent = loading ? "로그인 중…" : "카카오 로그인";
    }

    function updateAccountButton(ui) {
        var authenticated = isAuthenticated();
        ui.accountButton.textContent = authenticated ? "로그아웃" : "로그인";
        ui.accountButton.setAttribute(
            "aria-label",
            authenticated ? "카카오 계정 로그아웃" : "카카오 로그인"
        );
        ui.accountButton.dataset.authenticated = authenticated ? "true" : "false";
    }

    function showPublicContent(ui) {
        ui.mainContent.hidden = false;
        document.body.dataset.view = "content";
        updateAccountButton(ui);
    }

    function invalidateSession(ui) {
        sessionInvalidated = true;
        if (ui) updateAccountButton(ui);
        dispatchAuthChange(false);
    }

    function closeLogin(ui, restoreFocus) {
        ui.loginScreen.hidden = true;
        document.body.removeAttribute("data-login-open");
        setStatus(ui, "");
        setLoading(ui, false);
        pendingAction = null;

        if (restoreFocus && returnFocus && typeof returnFocus.focus === "function") {
            returnFocus.focus();
        }
        returnFocus = null;
    }

    function openLogin(ui, message, onSuccess) {
        if (isAuthenticated()) {
            if (typeof onSuccess === "function") onSuccess();
            return true;
        }

        pendingAction = typeof onSuccess === "function" ? onSuccess : null;
        returnFocus = document.activeElement;
        ui.loginScreen.hidden = false;
        document.body.dataset.loginOpen = "true";
        setLoading(ui, false);

        if (localPreview) {
            setStatus(ui, "로컬 미리보기에서는 로그인과 참여 기능이 비활성화됩니다.");
        } else if (!sdkReady) {
            setStatus(ui, SDK_LOAD_ERROR);
        } else {
            setStatus(ui, message || "계속하려면 카카오 로그인이 필요합니다.");
        }

        ui.closeButton.focus();
        return false;
    }

    function finishLogin(ui) {
        var action = pendingAction;
        pendingAction = null;
        sessionInvalidated = false;
        ui.loginScreen.hidden = true;
        document.body.removeAttribute("data-login-open");
        setStatus(ui, "");
        setLoading(ui, false);
        updateAccountButton(ui);
        dispatchAuthChange(true);
        returnFocus = null;

        if (typeof action === "function") {
            window.setTimeout(action, 0);
        }
    }

    function login(ui) {
        if (!sdkReady || localPreview) {
            openLogin(ui, "");
            return;
        }

        setLoading(ui, true);
        setStatus(ui, "카카오 로그인 창을 확인해 주세요.");

        try {
            Kakao.Auth.login({
                success: function () {
                    finishLogin(ui);
                },
                fail: function (error) {
                    var message = error && error.error === "access_denied"
                        ? "로그인이 취소되었습니다."
                        : "카카오 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
                    setLoading(ui, false);
                    setStatus(ui, message);
                    ui.loginButton.focus();
                }
            });
        } catch (error) {
            setLoading(ui, false);
            setStatus(ui, "로그인을 시작할 수 없습니다. 카카오 앱 설정을 확인해 주세요.");
            ui.loginButton.focus();
        }
    }

    function logout(ui) {
        if (!isAuthenticated()) {
            openLogin(ui, "참여 기능을 이용하려면 카카오 로그인이 필요합니다.");
            return;
        }

        try {
            Kakao.Auth.logout(function () {
                sessionInvalidated = false;
                updateAccountButton(ui);
                dispatchAuthChange(false);
                ui.accountButton.focus();
            });
        } catch (error) {
            sessionInvalidated = true;
            updateAccountButton(ui);
            dispatchAuthChange(false);
        }
    }

    function checkStatus(ui) {
        Kakao.Auth.getStatusInfo(function () {
            updateAccountButton(ui);
            dispatchAuthChange(isAuthenticated());
        });
    }

    window.GoyoungoAuth = {
        getAccessToken: getAccessToken,
        isAuthenticated: isAuthenticated,
        requestLogin: function (message, onSuccess) {
            if (!activeUi) return false;
            return openLogin(activeUi, message, onSuccess);
        },
        invalidateSession: function () {
            invalidateSession(activeUi);
        },
        reauthenticate: function (message, onSuccess) {
            if (!activeUi) return false;
            invalidateSession(activeUi);
            return openLogin(activeUi, message || "로그인이 만료되었습니다. 다시 로그인해 주세요.", onSuccess);
        }
    };

    function initialize() {
        var ui = elements();
        if (
            !ui.loginScreen ||
            !ui.mainContent ||
            !ui.loginButton ||
            !ui.closeButton ||
            !ui.accountButton
        ) return;

        activeUi = ui;
        showPublicContent(ui);
        ui.loginButton.addEventListener("click", function () { login(ui); });
        ui.closeButton.addEventListener("click", function () { closeLogin(ui, true); });
        ui.accountButton.addEventListener("click", function () { logout(ui); });
        ui.loginScreen.addEventListener("click", function (event) {
            if (event.target === ui.loginScreen) closeLogin(ui, true);
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !ui.loginScreen.hidden) {
                closeLogin(ui, true);
            }
        });

        if (localPreview) {
            updateAccountButton(ui);
            dispatchAuthChange(false);
            return;
        }

        if (!window.Kakao) {
            updateAccountButton(ui);
            dispatchAuthChange(false);
            return;
        }

        try {
            if (!Kakao.isInitialized()) Kakao.init(KAKAO_JS_KEY);
            sdkReady = true;
            setLoading(ui, false);
            checkStatus(ui);
        } catch (error) {
            sdkReady = false;
            updateAccountButton(ui);
            dispatchAuthChange(false);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
