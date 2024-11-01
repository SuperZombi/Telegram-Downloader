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

var downloads = [];
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
	if (msg.from == 'popup'){
		if (msg.event == "abort"){
			let dwnl = downloads.find(o => o.id == msg.id)
			if (dwnl){
				chrome.tabs.sendMessage(dwnl.tab, {from: 'background', message: {event: 'abort', id: msg.id}})
			}
		}
		else if (msg.event == "get"){
			sendResponse(downloads)
		}
		return
	}

	if (msg.event == "new"){
		let dwnl = new Download(msg.id, sender.tab.id, msg.filename, msg.thumbnail)
		downloads.push(dwnl)
	}
	else if (msg.event == "progress"){
		let dwnl = downloads.find(o => o.id == msg.id)
		if (dwnl){
			dwnl.progress(msg.percent)
		}
	}
	else if (msg.event == "complete" || msg.event == "abort"){
		let dwnl = downloads.find(o => o.id == msg.id)
		if (dwnl){
			if (msg.event == "complete"){dwnl.status = "completed"}
			else if (msg.event == "abort"){
				dwnl.status = "aborted"
				dwnl.error_text = msg.reason
			}
		}
	}
	// else if (msg.event == "complete" || msg.event == "abort"){
	// 	downloads = downloads.filter(o => {return o.id != msg.id})
	// }
});

class Download {
	constructor(file_id, tab_id, filename, thumbnail="") {
		this.id = file_id;
		this.tab = tab_id;
		this.filename = filename;
		this.thumbnail = thumbnail;
		this.percent = 0;
		this.status = "work";
		this.error_text = "";
	}
	progress(new_percent){
		this.percent = new_percent;
	}
};
