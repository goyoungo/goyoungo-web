(function () {
    "use strict";

    var STORAGE_KEY = "goyoungo-theme";
    var MODES = ["light", "dark", "system"];
    var systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    var selectedMode = readStoredMode();

    function isValidMode(value) {
        return MODES.indexOf(value) !== -1;
    }

    function readStoredMode() {
        try {
            var value = window.localStorage.getItem(STORAGE_KEY);
            return isValidMode(value) ? value : "system";
        } catch (_error) {
            return "system";
        }
    }

    function resolvedTheme(mode) {
        if (mode === "system") {
            return systemTheme.matches ? "dark" : "light";
        }
        return mode;
    }

    function updateThemeColor(theme) {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute("content", theme === "dark" ? "#171512" : "#f5f1ea");
        }
    }

    function modeLabel(mode) {
        return {
            system: "시스템",
            light: "라이트",
            dark: "다크"
        }[mode] || "시스템";
    }

    function syncControl() {
        var label = document.getElementById("themeLabel");
        if (label) label.textContent = modeLabel(selectedMode);
    }

    function applyTheme(mode, persist) {
        selectedMode = isValidMode(mode) ? mode : "system";
        var theme = resolvedTheme(selectedMode);

        document.documentElement.dataset.theme = theme;
        document.documentElement.dataset.themeMode = selectedMode;
        document.documentElement.style.colorScheme = theme;
        updateThemeColor(theme);
        syncControl();

        if (persist) {
            try {
                window.localStorage.setItem(STORAGE_KEY, selectedMode);
            } catch (_error) {
                // The selected theme still applies for this page when storage is unavailable.
            }
        }
    }

    function createThemeControl() {
        var header = document.querySelector(".site-header");
        if (!header) return;

        var actions = header.querySelector(".site-header-actions");
        if (!actions) {
            actions = document.createElement("div");
            actions.className = "site-header-actions";
        }

        var button = document.getElementById("themeButton");
        if (!button) {
            button = document.createElement("button");
            button.id = "themeButton";
            button.className = "quiet-button";
            button.type = "button";
            button.setAttribute("aria-label", "화면 모드 변경");
            button.innerHTML = '<span aria-hidden="true">◐</span><span id="themeLabel">시스템</span>';
            button.addEventListener("click", function () {
                var next = MODES[(MODES.indexOf(selectedMode) + 1) % MODES.length];
                applyTheme(next, true);
            });
        }

        syncControl();
        actions.appendChild(button);

        var loginButton = document.getElementById("logoutBtn");
        if (loginButton) {
            loginButton.classList.add("quiet-button", "account-button");
            actions.appendChild(loginButton);
        }
        header.appendChild(actions);
    }

    applyTheme(selectedMode, false);

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", createThemeControl, { once: true });
    } else {
        createThemeControl();
    }

    function handleSystemThemeChange() {
        if (selectedMode === "system") {
            applyTheme("system", false);
        }
    }

    if (typeof systemTheme.addEventListener === "function") {
        systemTheme.addEventListener("change", handleSystemThemeChange);
    } else if (typeof systemTheme.addListener === "function") {
        systemTheme.addListener(handleSystemThemeChange);
    }

    window.addEventListener("storage", function (event) {
        if (event.key === STORAGE_KEY) {
            applyTheme(readStoredMode(), false);
        }
    });
})();
