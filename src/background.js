chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status == 'complete'){
		if (tab.url){
			if (tab.url.startsWith("https://web.telegram.org/a/")){
				executeScript(tabId, "a")
			} else if (tab.url.startsWith("https://web.telegram.org/k/")){
				executeScript(tabId, "k")
			}
		}
	}
});

function executeScript(tabId, version){
	if (version == "a"){
		chrome.scripting.executeScript({
			target: { tabId: tabId },
			files : [ "main/tg_downloader_core.js", "main/tg_downloader_a.js" ],
			world: "MAIN"
		}, () => {
			chrome.scripting.insertCSS({
				target: { tabId: tabId },
				files: ["main/styles_a.css"]
			})
		});
	} else if (version == "k"){
		chrome.scripting.executeScript({
			target: { tabId: tabId },
			files : [ "main/tg_downloader_core.js", "main/tg_downloader_k.js" ],
			world: "MAIN"
		});
	}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
	console.log(msg)
});
