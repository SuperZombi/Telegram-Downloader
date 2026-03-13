if (TG_DOWNLOADER_EXECUTED){}
else{
	var TG_DOWNLOADER_EXECUTED = true;


onAppear(".media-viewer-aspecter", aspecter => {
	let mediaContainer = aspecter.closest(".media-viewer-whole")
	let mediaButtons = mediaContainer.querySelector(".media-viewer-topbar .media-viewer-buttons")
    let downloadButton = mediaButtons.querySelector("button.btn-icon.quality-download-options-button-menu.hide")
    if (downloadButton) {
      downloadButton.classList.remove("hide");
    }
})
}
