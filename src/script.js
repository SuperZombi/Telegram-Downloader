if (window.location.href.startsWith("https://web.telegram.org/a/")){
	onAppear("#MediaViewer", mediaContainer => {
		let mediaButtons = mediaContainer.querySelector(".MediaViewerActions")
		if (!mediaButtons.querySelector("button .icon-download")){
			let div = document.createElement("div")
			div.innerHTML = `<button type="button" class="Button smaller translucent-white round" aria-label="Download" title="Download"><i class="icon icon-download"></i></button>`
			let button = div.querySelector("button")
			button.onclick = _=>{download_action(button)}
			mediaButtons.prepend(button)
		}

		function download_action(button){
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
				let abort = downloadVideo(mediaElement.src, on_progress(progressEl),
				on_complete=>{
					initialDownloadButton(button)
				}, on_abort=>{
					initialDownloadButton(button)
				})
				button.onclick = _=>{abort()}
			}
		}

		function initialDownloadButton(button){
			button.innerHTML = `<i class="icon icon-download"></i>`
			button.onclick = _=>{download_action(button)}
		}

		function on_progress(element){
			return (percent)=>{
				element.style.setProperty("--progress", percent)
			}
		}
	})
}

else if (window.location.href.startsWith("https://web.telegram.org/k/")){
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



function onAppear(selector, callback){
	let observer = new MutationObserver(function(mutationsList) {
		for (let mutation of mutationsList) {
			if (mutation.addedNodes){
				for (let node of mutation.addedNodes) {
					if (node instanceof Element && node.matches(selector)){
						return callback(node)
					}
				}
			}
			
		}
	});
	observer.observe(document.body, { childList: true, subtree: true });
}


function randomFileName(extension='') {
    let filename = Math.random().toString(36).substring(2);
    return extension ? `${filename}.${extension}` : filename;
}

function downloadImage(url){
	const a = document.createElement("a");
	a.href = url;
	a.download = randomFileName("jpeg");
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}


function downloadVideo(url, progress="", onComplete="", onAbort=""){
	let _blobs = [];
	let _next_offset = 0;
	let _total_size = null;
	let canDownload = true;
	let fileName = randomFileName("mp4");
	let progressFunc = progress ? progress : default_progress_func;

	function default_progress_func(percent){console.log(`${percent}%`)}

	function fetchNextPart(_writable){
		fetch(url, {
			method: "GET",
			headers: {
				Range: `bytes=${_next_offset}-`,
			},
			"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36"
		})
		.then((res) => {
			if (![200, 206].includes(res.status)) {
				throw new Error("Not 200/206 response: " + res.status);
			}
			const mime = res.headers.get("Content-Type").split(";")[0];
			if (!mime.startsWith("video/")) {
				throw new Error("Not video MIME type: " + mime);
			}

			const match = res.headers.get("Content-Range").match(/^bytes (\d+)-(\d+)\/(\d+)$/);
			const startOffset = parseInt(match[1]);
			const endOffset = parseInt(match[2]);
			const totalSize = parseInt(match[3]);

			if (startOffset !== _next_offset) {
				throw new Error("Gap detected between responses.");
			}
			if (_total_size && totalSize !== _total_size) {
				throw new Error("Total size differs");
			}
			_next_offset = endOffset + 1;
			_total_size = totalSize;
			progressFunc(((_next_offset * 100) / _total_size).toFixed(0))
			return res.blob();
		})
		.then((resBlob) => {
			if (_writable) {
				_writable.write(resBlob);
			} else {
				_blobs.push(resBlob);
			}
		})
		.then(() => {
			if (!_total_size) {
				throw new Error("_total_size is NULL");
			}
			if (_next_offset < _total_size) {
				if (canDownload){
					fetchNextPart(_writable);
				} else {
					onAbort ? onAbort() : console.warn("Aborted", fileName)
				}
			} else {
				if (_writable) {
					_writable.close().then(() => {
						onComplete ? onComplete() : null;
					});
				} else {
					save();
					onComplete ? onComplete() : null;
				}
			}
		})
		.catch((reason) => {
			console.error(reason);
			onAbort ? onAbort() : null;
		});
	};

	function save(){
		const blob = new Blob(_blobs, { type: "video/mp4" });
		const blobUrl = window.URL.createObjectURL(blob);
		const a = document.createElement("a");
		document.body.appendChild(a);
		a.href = blobUrl;
		a.download = fileName;
		a.click();
		document.body.removeChild(a);
		window.URL.revokeObjectURL(blobUrl);
	};

	const supportsFileSystemAccess = "showSaveFilePicker" in window;
	if (supportsFileSystemAccess) {
		window.showSaveFilePicker({
			suggestedName: fileName,
			types: [{
				description: 'Video File',
				accept: {'video/mp4': ['.mp4']}
			}]
		}).then((handle) => {
			handle.createWritable()
			.then((writable) => {
				fetchNextPart(writable);
			})
		})
		.catch((err) => {
			if (err.name !== "AbortError") {
				console.error(err.name, err.message);
			}
		});
	} else {
		fetchNextPart(null);
	}
	return ()=>{
		canDownload = false;
	}
}

