document.getElementById("openDashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: "http://localhost:5000" });
});
