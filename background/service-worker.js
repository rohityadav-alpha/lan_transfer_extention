// ─── LAN File Transfer — Service Worker ─────────────────
// Handles side panel registration and transfer notifications.

chrome.runtime.onInstalled.addListener(() => {
  console.log('LAN File Transfer extension installed');
  // Register the side panel
  chrome.sidePanel.setOptions({
    path: 'popup/popup.html',
    enabled: true,
  });
});

// Open side panel when the extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'transfer-complete') {
    // Show a notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'LAN File Transfer',
      message: `File "${message.fileName}" transferred successfully!`,
      priority: 2,
    });
    sendResponse({ ok: true });
  }

  if (message.type === 'update-badge') {
    const text = message.count > 0 ? String(message.count) : '';
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: '#6C63FF' });
    sendResponse({ ok: true });
  }

  return true; // Keep message channel open for async responses
});
