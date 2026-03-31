(function () {
  const main = document.querySelector("main");
  if (!main) return;

  const loader = document.createElement("div");
  loader.className = "main-loader";

  loader.innerHTML = `
    <video id="main-loader-video" autoplay muted playsinline preload="auto" loop>
      <source src="/videos/loader.mp4" type="video/mp4">
    </video>
  `;

  main.prepend(loader);

  const video = loader.querySelector("#main-loader-video");

  function hideLoader() {
    if (!loader || loader.classList.contains("is-hidden")) return;

    if (video) {
      video.pause();
    }

    loader.classList.add("is-hidden");

    setTimeout(() => {
      loader.remove();
    }, 500);
  }

  function finishWhenReady() {
    if (!video) {
      hideLoader();
      return;
    }

    // If near the end of a loop, let it finish naturally
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const remaining = Math.max(0, duration - current);

    if (duration > 0 && remaining < 0.35) {
      const onTimeUpdate = () => {
        const newRemaining = Math.max(0, video.duration - video.currentTime);
        if (newRemaining < 0.05) {
          video.removeEventListener("timeupdate", onTimeUpdate);
          hideLoader();
        }
      };
      video.addEventListener("timeupdate", onTimeUpdate);
    } else {
      hideLoader();
    }
  }

  function waitForBodyClassRemoval(className) {
    if (!document.body.classList.contains(className)) {
      finishWhenReady();
      return;
    }

    const observer = new MutationObserver(() => {
      if (!document.body.classList.contains(className)) {
        observer.disconnect();
        finishWhenReady();
      }
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }

  if (document.body.classList.contains("page-preload")) {
    waitForBodyClassRemoval("page-preload");
    return;
  }

  if (document.body.classList.contains("commissions-preload")) {
    waitForBodyClassRemoval("commissions-preload");
    return;
  }

  window.addEventListener("load", () => {
    finishWhenReady();
  });
})();
