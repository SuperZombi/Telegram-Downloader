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


function downloadVideo(url, {progress, onCreate, onComplete, onAbort}={}){
	let _blobs = [];
	let _next_offset = 0;
	let _total_size = null;
	let canDownload = true;
	const fileId = Date.now();
	let fileName = randomFileName("mp4");
	let progressFunc = progress ? progress : default_progress_func;
	const abortByUser = "Aborted by user"

	function default_progress_func(percent, file_id){console.log(`${percent}% - ${fileName}`)}

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
			progressFunc(fileId, ((_next_offset * 100) / _total_size).toFixed(0))
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
					onAbort ? onAbort(fileId, abortByUser) : console.warn("Aborted", fileName)
				}
			} else {
				if (_writable) {
					_writable.close().then(() => {
						onComplete ? onComplete(fileId) : null;
					});
				} else {
					save();
					onComplete ? onComplete(fileId) : null;
				}
			}
		})
		.catch((reason) => {
			onAbort ? onAbort(fileId, reason.message) : console.error(reason);
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
			fileName = handle.name;
			handle.createWritable()
			.then((writable) => {
				onCreate ? onCreate(fileId, fileName) : null
				fetchNextPart(writable);
			})
		})
		.catch((err) => {
			if (err.name !== "AbortError") {
				console.error(err.name, err.message);
			}
			onAbort ? onAbort(fileId) : null;
		});
	} else {
		onCreate ? onCreate(fileId, fileName) : null
		fetchNextPart(null);
	}
	return {
		id: fileId,
		abort: ()=>{canDownload = false}
	}
}
