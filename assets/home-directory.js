(function () {
    "use strict";

    function splitDirectory() {
        var section = document.querySelector(".directory-section");
        var grid = section && section.querySelector(".hub-grid");
        if (!section || !grid || grid.classList.contains("restaurant-grid")) return;

        var cards = Array.prototype.slice.call(grid.children);
        if (cards.length < 12) return;

        var restaurantCards = cards.slice(0, 11);
        var utilityCards = cards.slice(11);

        grid.classList.add("restaurant-grid");
        grid.setAttribute("aria-label", "스키장 맛집 페이지");

        var restaurantLabel = document.createElement("div");
        restaurantLabel.className = "directory-subheading";
        restaurantLabel.innerHTML = "<strong>맛집 리스트</strong><span>11개 스키장</span>";
        grid.parentNode.insertBefore(restaurantLabel, grid);

        restaurantCards.forEach(function (card) {
            grid.appendChild(card);
        });

        var otherSection = document.createElement("section");
        otherSection.className = "other-directory";
        otherSection.setAttribute("aria-labelledby", "otherDirectoryTitle");
        otherSection.innerHTML = [
            '<div class="directory-heading">',
            '<h2 id="otherDirectoryTitle">기타 정보</h2>',
            "<p>거래·시즌방·제휴·셔틀</p>",
            "</div>",
            '<nav class="hub-grid utility-grid" aria-label="기타 정보 페이지"></nav>'
        ].join("");

        var otherGrid = otherSection.querySelector(".utility-grid");
        utilityCards.forEach(function (card) {
            otherGrid.appendChild(card);
        });

        section.parentNode.insertBefore(otherSection, section.nextSibling);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", splitDirectory, { once: true });
    } else {
        splitDirectory();
    }
})();
