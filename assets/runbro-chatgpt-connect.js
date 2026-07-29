(function () {
    "use strict";

    var config = window.RUNBRO_CONFIG || {};
    var apiBase = String(config.apiBase || "").replace(/\/+$/, "");
    var request = new URLSearchParams(window.location.search).get("request") || "";
    var approveButton = document.getElementById("approveChatgpt");
    var cancelButton = document.getElementById("cancelChatgpt");
    var statusNode = document.getElementById("connectStatus");

    function setStatus(message, isError) {
        statusNode.textContent = message || "";
        statusNode.classList.toggle("is-error", Boolean(isError));
    }

    function getAccessToken() {
        return window.GoyoungoAuth && window.GoyoungoAuth.getAccessToken
            ? window.GoyoungoAuth.getAccessToken()
            : null;
    }

    function approve() {
        if (!request || request.length > 4096) {
            setStatus("연결 요청이 없거나 올바르지 않습니다. ChatGPT에서 다시 연결해 주세요.", true);
            return;
        }
        if (!apiBase) {
            setStatus("RUNBRO 연결 서버를 확인하지 못했습니다.", true);
            return;
        }
        window.GoyoungoAuth.requestLogin(
            "ChatGPT와 RUNBRO를 연결하려면 카카오 로그인이 필요합니다.",
            function () {
                approveButton.disabled = true;
                setStatus("요청 권한과 카카오 계정을 확인하고 있습니다.");
                fetch(apiBase + "/oauth/approve", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                        "authorization": "Bearer " + getAccessToken()
                    },
                    body: JSON.stringify({ request: request })
                }).then(function (response) {
                    return response.json().catch(function () { return {}; }).then(function (body) {
                        if (!response.ok || !body.redirectUrl) {
                            throw new Error(body.message || "ChatGPT 연결을 완료하지 못했습니다.");
                        }
                        return body.redirectUrl;
                    });
                }).then(function (redirectUrl) {
                    setStatus("연결을 승인했습니다. ChatGPT로 돌아갑니다.");
                    window.location.assign(redirectUrl);
                }).catch(function (error) {
                    approveButton.disabled = false;
                    setStatus(error.message, true);
                });
            }
        );
    }

    approveButton.addEventListener("click", approve);
    cancelButton.addEventListener("click", function () {
        if (window.history.length > 1) window.history.back();
        else window.location.replace("/runbro/");
    });

    if (!request) {
        approveButton.disabled = true;
        setStatus("ChatGPT에서 RUNBRO 앱 연결을 시작해 주세요.", true);
    }
})();
