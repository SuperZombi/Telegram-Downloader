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
			createDownload(e.id, e.filename, e.thumbnail, e.percent)
		})
		ListenEvents()
	}
});

function ListenEvents(){
	chrome.runtime.onMessage.addListener((msg, sender, res) => {
		if (msg.event == "new"){
			let el = createDownload(msg.id, msg.filename, msg.thumbnail)
			let cancel = el.querySelector(".cancel-button");
			cancel.onclick = _=>{
				// TODO
			}
		}
		else if (msg.event == "progress"){
			let el = document.querySelector(`#downloads .download-container[file-id="${msg.id}"]`)
			if (el) {
				el.querySelector(".progress-bar").style.setProperty("--percent", `${msg.percent}%`)
			}
		}
	});
}

function createDownload(file_id, filename, thumbnail="", percent=0){
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
		</div>
	`
	let container = div.querySelector(".download-container")
	document.querySelector("#downloads").appendChild(container)
	return container
}
