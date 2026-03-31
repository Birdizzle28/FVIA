(function () {
  const main = document.querySelector("main");
  if (!main) return;

  const loader = document.createElement("div");
  loader.className = "main-loader";

  loader.innerHTML = `
    <video id="main-loader-video" autoplay muted playsinline preload="auto">
      <source src="/videos/loader.mp4" type="video/mp4">
    </video>
  `;

  main.prepend(loader);

  const video = loader.querySelector("#main-loader-video");

  function hideLoader() {
    loader.classList.add("is-hidden");
    setTimeout(() => {
      loader.remove();
    }, 500);
  }

  window.addEventListener("load", () => {
    if (!video) {
      hideLoader();
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const remaining = Math.max(0, duration - current);

    if (remaining > 0 && remaining < 0.7) {
      video.addEventListener("ended", hideLoader, { once: true });
    } else {
      hideLoader();
    }
  });
})();
