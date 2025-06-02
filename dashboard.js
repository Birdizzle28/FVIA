document.addEventListener("DOMContentLoaded", () => {
  // Nav tab click handler
  const tabs = document.querySelectorAll("#dashboard-nav a");
  const tabContents = document.querySelectorAll(".tab-content");

  tabs.forEach(tab => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();

      const targetId = tab.getAttribute("href").substring(1);

      // Hide all tab contents
      tabContents.forEach(content => {
        content.style.display = "none";
      });

      // Remove active class from all tabs
      tabs.forEach(t => t.classList.remove("active-tab"));

      // Show selected tab
      document.getElementById(targetId).style.display = "block";
      tab.classList.add("active-tab");
    });
  });

  // Default: Show Profile tab
  if (document.getElementById("profile-tab")) {
    document.getElementById("profile-tab").style.display = "block";
    document.querySelector("#dashboard-nav a[href='#profile-tab']").classList.add("active-tab");
  }
});
