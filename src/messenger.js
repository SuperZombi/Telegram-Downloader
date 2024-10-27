window.addEventListener("message", (event) => {
	if (event.source !== window && event.origin !== "https://web.telegram.org") return;

	if (event.data.from === "TG_DOWNLOADER") {
		chrome.runtime.sendMessage(event.data.message);
	}
});
chrome.runtime.onMessage.addListener((msg, sender, res) => {
	if (msg.from == "background"){
		window.postMessage({from: "TG_DOWNLOADER_POPUP", message: msg.message});
	}
});
