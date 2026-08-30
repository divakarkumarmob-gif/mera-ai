/**
 * FRIDAY AI Chrome Extension — Background Service Worker
 * Listens for commands from FRIDAY AI Server and relays them to active store tabs
 */

console.log("[FRIDAY Extension] Background service worker initialized.");

let socket = null;

function connectWebSocket() {
  try {
    socket = new WebSocket("ws://127.0.0.1:5000");

    socket.onopen = () => {
      console.log("[FRIDAY Extension] Connected to local FRIDAY AI Server.");
      socket.send(JSON.stringify({ type: "extension_connected", version: "1.0.0" }));
    };

    socket.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "extension_order_command") {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab && activeTab.id) {
            chrome.tabs.sendMessage(activeTab.id, data);
          }
        }
      } catch (err) {
        console.warn("[FRIDAY Extension] Error parsing WS message:", err);
      }
    };

    socket.onclose = () => {
      setTimeout(connectWebSocket, 5000);
    };

    socket.onerror = () => {
      socket?.close();
    };
  } catch (e) {
    setTimeout(connectWebSocket, 5000);
  }
}

connectWebSocket();
