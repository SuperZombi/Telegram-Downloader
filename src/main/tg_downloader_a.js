if (TG_DOWNLOADER_EXECUTED){}
else{
	var TG_DOWNLOADER_EXECUTED = true;


var processingDownloads = [];
onAppear("#MediaViewer", mediaContainer => {
	let mediaButtons = mediaContainer.querySelector(".MediaViewerActions")
	if (!mediaButtons.querySelector("button .icon-download")){
		let div = document.createElement("div")
		div.innerHTML = `<button type="button" class="Button smaller translucent-white round" aria-label="Download" title="Download"><i class="icon icon-download"></i></button>`
		let button = div.querySelector("button")
		button.onclick = _=>{download_action(button)}
		mediaButtons.prepend(button)
	}

	async function download_action(button){
		let mediaContent = mediaContainer.querySelector(".MediaViewerSlide--active .MediaViewerContent")
		let mediaElement = mediaContent.querySelector("video, img");
		if(mediaElement instanceof HTMLImageElement) {
			downloadImage(mediaElement.src)
		}
		else if (mediaElement instanceof HTMLVideoElement){
			button.innerHTML = `<div class="ProgressSpinner size-s"><i class="icon icon-close" aria-hidden="true"></i>
			<svg viewBox="0 0 200 200" width="50" height="50" style="--progress: 0" class="circular-progress">
			<circle class="bg"></circle><circle class="fg"></circle></svg></div>`
			let progressEl = button.querySelector(".circular-progress")
			let thumb = await getThumb(mediaElement)
			
			const {id, abort} = downloadVideo(mediaElement.src, {
				"progress": on_progress(progressEl),
				"onCreate": (file_id, filename)=>{on_create(file_id, filename, thumb)},
				"onComplete": file_id=>{
					initialDownloadButton(button)
					on_complete(file_id)
				},
				"onAbort": file_id=>{
					initialDownloadButton(button)
					on_abort(file_id)
				}
			})
			button.onclick = _=>{abort()}
			processingDownloads.push({"id": id, "abort": abort})
		}
	}

	function initialDownloadButton(button){
		button.innerHTML = `<i class="icon icon-download"></i>`
		button.onclick = _=>{download_action(button)}
	}

	function on_create(file_id, filename, thumbnail){
		window.postMessage({ from: "TG_DOWNLOADER", message: {
			"event": "new",
			"id": file_id,
			"filename": filename,
			"thumbnail": thumbnail
		} });
	}

	function on_progress(element){
		return (file_id, percent)=>{
			element.style.setProperty("--progress", percent)
			window.postMessage({ from: "TG_DOWNLOADER", message: {
				"event": "progress",
				"id": file_id,
				"percent": percent
			} });
		}
	}

	function on_complete(file_id){
		window.postMessage({ from: "TG_DOWNLOADER", message: {
			"event": "complete",
			"id": file_id
		} });
		removeDownloadFromArray(file_id)
	}
	function on_abort(file_id){
		window.postMessage({ from: "TG_DOWNLOADER", message: {
			"event": "abort",
			"id": file_id
		} });
		removeDownloadFromArray(file_id)
	}

	function getThumb(videoEl){
		return new Promise((resolve, reject) => {
			let computedStyle = window.getComputedStyle(videoEl)
			let imageUrl = computedStyle.backgroundImage.slice(4, -1).replace(/"/g, "")
			fetch(imageUrl).then((res)=>{return res.blob()}).then((blob)=>{
				const reader = new FileReader();
				reader.onloadend = ()=>{
					resolve(reader.result);
				};
				reader.readAsDataURL(blob);
			});
		});
	}
})
function removeDownloadFromArray(dwnlId){
	processingDownloads = processingDownloads.filter(o => {return o.id != dwnlId})
}

window.addEventListener("message", (event) => {
	if (event.data.from === "TG_DOWNLOADER_POPUP") {
		let message = event.data.message;
		let dwnl = processingDownloads.find(o => o.id == message.id)
		if (dwnl){
			dwnl.abort()
		}
	}
});


}
