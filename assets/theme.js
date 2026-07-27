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

    function syncControl() {
        var select = document.getElementById("themeModeSelect");
        if (select && select.value !== selectedMode) {
            select.value = selectedMode;
        }
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
        if (document.getElementById("themeModeSelect")) return;

        var header = document.querySelector(".site-header");
        if (!header) return;

        var actions = document.createElement("div");
        actions.className = "site-header-actions";

        var label = document.createElement("label");
        label.className = "visually-hidden";
        label.htmlFor = "themeModeSelect";
        label.textContent = "화면 모드";

        var select = document.createElement("select");
        select.id = "themeModeSelect";
        select.className = "theme-mode-select";
        select.setAttribute("aria-label", "화면 모드");
        select.title = "화면 모드";

        [
            { value: "light", label: "☀ 라이트" },
            { value: "dark", label: "☾ 다크" },
            { value: "system", label: "◐ 시스템" }
        ].forEach(function (optionData) {
            var option = document.createElement("option");
            option.value = optionData.value;
            option.textContent = optionData.label;
            select.appendChild(option);
        });

        select.value = selectedMode;
        select.addEventListener("change", function () {
            applyTheme(select.value, true);
        });

        actions.appendChild(label);
        actions.appendChild(select);

        var loginButton = document.getElementById("logoutBtn");
        if (loginButton && loginButton.parentNode === header) {
            header.insertBefore(actions, loginButton);
            actions.appendChild(loginButton);
        } else {
            header.appendChild(actions);
        }
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
