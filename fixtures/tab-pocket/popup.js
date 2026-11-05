const list = document.querySelector("#tabs");
const status = document.querySelector("#status");
function render() {
  chrome.storage.local.get({ savedTabs: [] }, ({ savedTabs }) => {
    list.replaceChildren();
    for (const tab of savedTabs) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.textContent = tab.title || tab.url;
      link.href = tab.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      li.append(link);
      list.append(li);
    }
  });
}
document.querySelector("#save").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab?.url || !/^https?:/.test(tab.url)) { status.textContent = "Open a web page first."; return; }
    chrome.storage.local.get({ savedTabs: [] }, ({ savedTabs }) => {
      if (!savedTabs.some(item => item.url === tab.url)) savedTabs.unshift({ title: tab.title, url: tab.url });
      chrome.storage.local.set({ savedTabs: savedTabs.slice(0, 30) }, () => { status.textContent = "Saved to your pocket."; render(); });
    });
  });
});
render();
