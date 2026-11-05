// Original project fixture: MIT licensed. Event registration stays at the top level.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ savedTabs: [] }, (data) => {
    chrome.storage.local.set({ savedTabs: data.savedTabs });
  });
});
