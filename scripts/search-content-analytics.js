(() => {
  "use strict";

  const body = document.body;
  if (!body) return;

  const pageType = body.dataset.analyticsPageType || "unknown";
  const contentId = body.dataset.analyticsContentId || "unknown";
  const sourcePage = window.location.pathname;

  const send = (eventName, extra = {}) => {
    if (typeof window.gtag !== "function") return;
    window.gtag("event", eventName, {
      page_type: pageType,
      content_id: contentId,
      source_page: sourcePage,
      transport_type: "beacon",
      ...extra
    });
  };

  if (pageType === "knowledge_hub") send("view_knowledge_hub");
  if (pageType === "answer") send("view_search_answer");
  if (pageType === "service") {
    send("view_service");
    send("view_item", {
      item_id: contentId,
      item_name: contentId,
      item_category: "laundry_service"
    });
  }
  if (pageType === "article") send("view_article");
  if (typeof window.gtag === "function") {
    window.gtag("set", "content_group", pageType);
  }

  let maxScroll = 0;
  const onScroll = () => {
    const doc = document.documentElement;
    const bodyEl = document.body;
    const height = Math.max(doc.scrollHeight, bodyEl.scrollHeight) - window.innerHeight;
    if (height <= 0) return;
    const percent = Math.round((window.scrollY / height) * 100);
    if (percent >= 50 && maxScroll < 50) {
      maxScroll = 50;
      send("scroll_depth", { percent_scrolled: 50 });
    }
    if (percent >= 90 && maxScroll < 90) {
      maxScroll = 90;
      send("scroll_depth", { percent_scrolled: 90 });
    }
  };
  document.addEventListener("scroll", onScroll, { passive: true });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (!anchor) return;

    const rawHref = anchor.getAttribute("href") || "";
    const ctaName = (anchor.textContent || "link").replace(/\s+/g, " ").trim().slice(0, 80);
    if (rawHref.startsWith("tel:")) {
      send("click_phone", { cta_name: ctaName });
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(rawHref, window.location.href);
    } catch {
      return;
    }

    if (targetUrl.pathname.endsWith("/go/line.html")) {
      send("click_line_cta", { cta_name: ctaName });
      return;
    }

    if (pageType === "knowledge_hub" && /\/(guides|local)\/[^/]+\.html$/.test(targetUrl.pathname)) {
      send("click_answer_from_hub", {
        answer_id: targetUrl.pathname.split("/").pop()?.replace(/\.html$/, "") || "unknown",
        cta_name: ctaName
      });
      return;
    }

    if (pageType === "knowledge_hub" && /\/services\/[^/]+\.html$/.test(targetUrl.pathname)) {
      send("click_service_from_hub", {
        service_id: targetUrl.pathname.split("/").pop()?.replace(/\.html$/, "") || "unknown",
        cta_name: ctaName
      });
      return;
    }

    if (pageType === "answer" && /\/services\/[^/]+\.html$/.test(targetUrl.pathname)) {
      send("click_service_from_answer", {
        service_id: targetUrl.pathname.split("/").pop()?.replace(/\.html$/, "") || "unknown",
        cta_name: ctaName
      });
      return;
    }

    if (pageType === "article" && /\/services\/[^/]+\.html$/.test(targetUrl.pathname)) {
      send("click_service_from_article", {
        service_id: targetUrl.pathname.split("/").pop()?.replace(/\.html$/, "") || "unknown",
        cta_name: ctaName
      });
    }
  });
})();
