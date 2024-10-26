window.addEventListener("message", (event) => {
	if (event.source !== window && event.origin !== "https://web.telegram.org") return;

	if (event.data.from === "TG_DOWNLOADER") {
		chrome.runtime.sendMessage(event.data.message);
	}
});
