if (TG_DOWNLOADER_EXECUTED){}
else{
	var TG_DOWNLOADER_EXECUTED = true;


var DOWNLOAD_ICON = "\uE94E";
onAppear(".media-viewer-aspecter", aspecter => {
	let mediaContainer = aspecter.closest(".media-viewer-whole")
	let mediaButtons = mediaContainer.querySelector(".media-viewer-topbar .media-viewer-buttons")
	let hiddenButtons = mediaButtons.querySelectorAll("button.btn-icon.hide");
	for (let btn of hiddenButtons) {
		if (btn.textContent === DOWNLOAD_ICON) {
			btn.classList.remove("hide");
			return
		}
	}
})


}
