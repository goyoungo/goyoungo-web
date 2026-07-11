(function () {
    "use strict";

    var KAKAO_JS_KEY = "0ffa9164b98f13f79e8dd6902be2f599";
    var SDK_LOAD_ERROR = "카카오 로그인 파일을 불러오지 못했습니다. 광고·추적 차단 기능에서 t1.kakaocdn.net을 허용한 뒤 새로고침해 주세요.";

    function getAccessToken() {
        try {
            return window.Kakao && Kakao.isInitialized()
                ? Kakao.Auth.getAccessToken()
                : null;
        } catch (error) {
            return null;
        }
    }

    window.GoyoungoAuth = {
        getAccessToken: getAccessToken,
        isAuthenticated: function () {
            return Boolean(getAccessToken());
        }
    };

    function dispatchAuthChange(authenticated) {
        document.dispatchEvent(new CustomEvent("goyoungo:authchange", {
            detail: { authenticated: Boolean(authenticated) }
        }));
    }

    function elements() {
        return {
            loginScreen: document.getElementById("loginScreen"),
            mainContent: document.getElementById("mainContent"),
            loginButton: document.getElementById("kakaoLoginBtn"),
            logoutButton: document.getElementById("logoutBtn"),
            authStatus: document.getElementById("authStatus"),
            main: document.getElementById("main")
        };
    }

    function setStatus(ui, message) {
        ui.authStatus.textContent = message || "";
    }

    function setLoading(ui, loading) {
        ui.loginButton.disabled = loading;
        ui.loginButton.textContent = loading ? "로그인 중…" : "카카오 로그인";
    }

    function showLogin(ui, message, focus) {
        ui.mainContent.hidden = true;
        ui.loginScreen.hidden = false;
        document.body.dataset.view = "login";
        setLoading(ui, false);
        setStatus(ui, message || "");
        window.scrollTo(0, 0);
        if (focus) ui.loginButton.focus();
        dispatchAuthChange(false);
    }

    function showContent(ui, focus) {
        ui.loginScreen.hidden = true;
        ui.mainContent.hidden = false;
        document.body.dataset.view = "content";
        setLoading(ui, false);
        setStatus(ui, "");
        window.scrollTo(0, 0);
        if (focus) ui.main.focus();
        dispatchAuthChange(window.GoyoungoAuth.isAuthenticated());
    }

    function login(ui) {
        setLoading(ui, true);
        setStatus(ui, "카카오 로그인 창을 확인해 주세요.");

        try {
            Kakao.Auth.login({
                success: function () {
                    showContent(ui, true);
                },
                fail: function (error) {
                    var message = error && error.error === "access_denied"
                        ? "로그인이 취소되었습니다."
                        : "카카오 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
                    showLogin(ui, message, true);
                }
            });
        } catch (error) {
            showLogin(ui, "로그인을 시작할 수 없습니다. 카카오 앱 설정을 확인해 주세요.", true);
        }
    }

    function logout(ui) {
        try {
            if (!window.Kakao || !Kakao.isInitialized() || !Kakao.Auth.getAccessToken()) {
                showLogin(ui, "로그아웃했습니다.", true);
                return;
            }

            Kakao.Auth.logout(function () {
                showLogin(ui, "로그아웃했습니다.", true);
            });
        } catch (error) {
            showLogin(ui, "로그아웃했습니다.", true);
        }
    }

    function checkStatus(ui) {
        Kakao.Auth.getStatusInfo(function (result) {
            if (result && result.status === "connected") {
                showContent(ui, false);
            } else {
                showLogin(ui, "", false);
            }
        });
    }

    function initialize() {
        var ui = elements();
        if (!ui.loginScreen || !ui.mainContent || !ui.loginButton || !ui.logoutButton) return;

        ui.loginButton.addEventListener("click", function () { login(ui); });
        ui.logoutButton.addEventListener("click", function () { logout(ui); });

        var localPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
            new URLSearchParams(window.location.search).has("preview");

        if (localPreview) {
            showContent(ui, false);
            return;
        }

        if (!window.Kakao) {
            showLogin(ui, SDK_LOAD_ERROR, false);
            ui.loginButton.disabled = true;
            return;
        }

        try {
            if (!Kakao.isInitialized()) Kakao.init(KAKAO_JS_KEY);
            checkStatus(ui);
        } catch (error) {
            showLogin(ui, "카카오 로그인 서비스를 초기화하지 못했습니다.", false);
            ui.loginButton.disabled = true;
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
