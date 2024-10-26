chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.status == 'complete'){
		if (tab.url){
			executeScript(tabId)
		}
	}
});

function executeScript(tabId){
	chrome.scripting.executeScript({
		target: { tabId: tabId },
		files : [ "script.js" ],
		world: "MAIN"
	}, () => {
		chrome.scripting.insertCSS({
			target: { tabId: tabId },
			files: ["styles.css"]
		})
	});
}
