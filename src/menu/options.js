const darkThemeMq = window.matchMedia("(prefers-color-scheme: dark)");
if (darkThemeMq.matches) {
	document.body.className = "dark"
	theme = "dark"
}
else{
	theme = "light"
}
const manifestData = chrome.runtime.getManifest();
document.querySelector("#version").src = `https://shields.io/badge/${manifestData.version}-blue`


chrome.runtime.sendMessage({ from: 'popup', event: 'get' }, data=>{
	if (data.length > 0){
		data.forEach(e=>{
			createDownload(e.id, e.filename, e.thumbnail, e.percent, e.status, e.error_text)
		})
	}
	ListenEvents()
});

function ListenEvents(){
	chrome.runtime.onMessage.addListener((msg, sender, res) => {
		if (msg.event == "new"){
			createDownload(msg.id, msg.filename, msg.thumbnail)
		}
		else if (msg.event == "progress"){
			let el = document.querySelector(`#downloads .download-container[file-id="${msg.id}"]`)
			if (el) {
				el.querySelector(".progress-bar").style.setProperty("--percent", `${msg.percent}%`)
			}
		}
		else if (msg.event == "complete" || msg.event == "abort"){
			let el = document.querySelector(`#downloads .download-container[file-id="${msg.id}"]`)
			if (el) {
				el.classList.add("finished")
				if (msg.event == "abort"){
					el.classList.add("inactive")
					el.querySelector(".description-text").innerHTML = msg.reason
				}
			}
		}
	});
}

function createDownload(file_id, filename, thumbnail="", percent=0, status="work", error_text=""){
	if (document.querySelector(`#downloads .download-container[file-id="${file_id}"]`)){return}

	let div = document.createElement("div")
	div.innerHTML = `
		<div class="download-container" file-id="${file_id}">
			<img src="${thumbnail}" class="preview-image">
			<div class="download-info">
				<span class="file-name">${filename}</span>
				<div class="progress-bar" style="--percent:${percent}%"></div>
			</div>
			<button class="cancel-button">✖</button>
			<div class="description-icon"></div>
			<div class="description-text">${error_text}</div>
		</div>
	`
	let download = div.querySelector(".download-container")
	document.querySelector("#downloads").appendChild(download)
	let cancel = download.querySelector(".cancel-button")
	if (status == "completed" || status == "aborted"){
		download.classList.add("finished")
	} else {
		cancel.onclick = _=>{
			chrome.runtime.sendMessage({from: 'popup', event: 'abort', id: download.getAttribute('file-id')});
		}
	}
	if (status == "aborted"){
		download.classList.add("inactive")
	}
	return download
}
