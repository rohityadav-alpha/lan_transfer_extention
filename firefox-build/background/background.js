// ─── LAN File Transfer — Firefox Background Script ──────
// Handles transfer notifications (Firefox uses background scripts, not service workers)

browser.runtime.onInstalled.addListener(() => {
  console.log('LAN File Transfer extension installed on Firefox');
});

// Open sidebar when the extension icon is clicked
browser.browserAction.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

// Listen for messages from the popup
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'transfer-complete') {
    // Show a notification
    browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'LAN File Transfer',
      message: `File "${message.fileName}" transferred successfully!`,
    });
    sendResponse({ ok: true });
  }

  if (message.type === 'update-badge') {
    const text = message.count > 0 ? String(message.count) : '';
    browser.browserAction.setBadgeText({ text });
    browser.browserAction.setBadgeBackgroundColor({ color: '#6C63FF' });
    sendResponse({ ok: true });
  }

  return true;
});
