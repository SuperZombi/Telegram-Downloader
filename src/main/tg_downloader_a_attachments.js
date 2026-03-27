if (typeof TG_DOWNLOADER_ATTACHMENTS_EXECUTED !== 'undefined') {}
else {
var TG_DOWNLOADER_ATTACHMENTS_EXECUTED = true;


// Map of .Message element → audio src URL, populated by HTMLMediaElement.prototype.src interceptor
const _tgDlAudioMap = new WeakMap();
let _tgDlPendingMsg = null; // .Message element currently expecting a src assignment
let _tgDlLastAudio = null;  // last HTMLAudioElement that called .play() — used to pause it

// Step 1: when user clicks play inside .Audio naturally, record which .Message it belongs to.
document.addEventListener('click', function(e) {
	if (e.target.closest('.tg-dl-banner')) return;
	const inAudio = e.target.closest('.Audio');
	if (inAudio) {
		const msg = inAudio.closest('.Message');
		if (msg) _tgDlPendingMsg = msg;
	}
}, true);

// Step 2a: intercept HTMLMediaElement.prototype.src setter to capture the audio URL.
// Telegram creates detached <audio> elements (not appended to DOM), but they still
// go through the prototype setter.
(function() {
	const _srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
	if (!_srcDescriptor) return;
	Object.defineProperty(HTMLMediaElement.prototype, 'src', {
		get() { return _srcDescriptor.get.call(this); },
		set(value) {
			if (this instanceof HTMLAudioElement && value && _tgDlPendingMsg) {
				_tgDlAudioMap.set(_tgDlPendingMsg, value);
				_tgDlPendingMsg = null;
			}
			return _srcDescriptor.set.call(this, value);
		}
	});
})();

// Step 2b: intercept HTMLAudioElement.prototype.play to capture the element reference.
// Allows calling .pause() later without needing the element to be in the DOM.
(function() {
	const _origPlay = HTMLAudioElement.prototype.play;
	HTMLAudioElement.prototype.play = function() {
		_tgDlLastAudio = this;
		return _origPlay.call(this);
	};
})();


// Direct anchor download — avoids fetch().blob() which hangs on SW-served streaming audio URLs.
function _tgDlSaveUrl(url, filename) {
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

// Fetches audio in chunks via Range requests (Telegram SW serves ~512KB per request).
// Calls onProgress(percent) after each chunk. Returns { blob, ext }.
async function _tgDlFetchAudio(url, onProgress) {
	const blobs = [];
	let offset = 0;
	let total = null;
	let mimeType = 'audio/ogg';
	while (total === null || offset < total) {
		const res = await fetch(url, { headers: { Range: `bytes=${offset}-` } });
		if (![200, 206].includes(res.status)) throw new Error('HTTP ' + res.status);
		const ct = res.headers.get('content-type');
		if (ct) mimeType = ct.split(';')[0].trim();
		const cr = res.headers.get('content-range');
		if (cr) {
			const m = cr.match(/bytes (\d+)-(\d+)\/(\d+)/);
			if (m) { offset = parseInt(m[2]) + 1; total = parseInt(m[3]); }
		} else {
			blobs.push(await res.blob());
			break; // single full response, no chunking needed
		}
		blobs.push(await res.blob());
		if (onProgress && total) onProgress(Math.round(offset * 100 / total));
	}
	const ext = /mpeg|mp3/.test(mimeType) ? 'mp3' : /mp4|aac|m4a/.test(mimeType) ? 'm4a' : 'ogg';
	return { blob: new Blob(blobs, { type: mimeType }), ext };
}

// Downloads audio via chunked Range fetching and reports to the extension download manager.
async function _tgDlDownloadAudio(url, filename) {
	const fileId = Date.now();
	window.postMessage({ from: "TG_DOWNLOADER", message: { event: "new", id: fileId, filename: filename, thumbnail: "" } });
	try {
		const { blob, ext } = await _tgDlFetchAudio(url, (percent) => {
			window.postMessage({ from: "TG_DOWNLOADER", message: { event: "progress", id: fileId, percent } });
		});
		const fname = filename.replace(/\.[^.]+$/, '.' + ext);
		const blobUrl = URL.createObjectURL(blob);
		_tgDlSaveUrl(blobUrl, fname);
		setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
	} catch (e) {
		console.error('[TG-DL] audio fetch error:', e.message);
		_tgDlSaveUrl(url, filename);
	}
	window.postMessage({ from: "TG_DOWNLOADER", message: { event: "complete", id: fileId } });
}

// Dispatch a full pointer→mouse→click sequence on el.
// Needed because Telegram's audio player listens to pointer events, not just click.
function _tgDlDispatchClick(el) {
	const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1 };
	el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true }));
	el.dispatchEvent(new MouseEvent('mousedown', opts));
	el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true, buttons: 0 }));
	el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
	el.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }));
	el.click();
}

function makeBanner(getUrl, getFilename, isAudio = false) {
	const btn = document.createElement('button');
	btn.className = 'tg-dl-banner';
	btn.textContent = '\u2b07 Download'; // ⬇ Download
	btn.type = 'button';
	const _save = (url, filename) => isAudio ? _tgDlDownloadAudio(url, filename) : _tgDlSaveUrl(url, filename);
	btn.onclick = async (e) => {
		e.stopPropagation();
		e.preventDefault();
		let url = getUrl();
		if (url) {
			await _save(url, getFilename());
			return;
		}
		const msg = btn.closest('.Message');
		const audioEl = msg?.querySelector('.Audio');
		if (!audioEl) return;

		btn.textContent = '\u25b6 Loading...'; // ▶ Loading...
		btn.classList.add('tg-dl-wait');

		// Set pendingMsg before triggering so src interceptor associates the URL with this message
		_tgDlPendingMsg = msg;

		// Click the play button. Class confirmed from DOM inspection: Button.toggle-play.
		// Falls back to aria-label or any button inside .Audio.
		const playBtn = audioEl.querySelector('.toggle-play')
			|| audioEl.querySelector('[aria-label="Play audio"]')
			|| audioEl.querySelector('button');
		if (playBtn) _tgDlDispatchClick(playBtn);

		// Wait up to 10 s for src to be captured (auto-play) or for user to click play manually
		for (let i = 0; i < 100; i++) {
			await new Promise(r => setTimeout(r, 100));
			url = getUrl();
			if (url) break;
		}

		btn.textContent = '\u2b07 Download'; // ⬇ Download
		btn.classList.remove('tg-dl-wait');

		if (url) {
			// Await download before pausing: for blob: URLs this reads data into an owned blob
			// so pausing (which may revoke Telegram's blob URL) happens after data is captured.
			await _save(url, getFilename());
			if (_tgDlLastAudio && !_tgDlLastAudio.paused) {
				_tgDlLastAudio.pause();
			}
		}
	};
	return btn;
}

// Injects banner into .message-content of the parent .Message container.
// Real DOM (confirmed): div.Message > div.message-content-wrapper > div.message-content > div.content-inner > div.Audio
function injectMessageBanner(mediaEl, getUrl, getFilename, isAudio = false) {
	const msg = mediaEl.closest('.Message');
	if (!msg) return;
	if (msg.querySelector('.tg-dl-banner')) return;
	const content = msg.querySelector('.message-content');
	if (!content) return;
	content.appendChild(makeBanner(getUrl, getFilename, isAudio));
}

function scan() {
	document.querySelectorAll('.Audio').forEach(el => {
		const msg = el.closest('.Message');
		if (!msg) return;
		injectMessageBanner(el,
			() => _tgDlAudioMap.get(msg) || null,
			() => randomFileName('mp3'),
			true
		);
	});

	document.querySelectorAll('.media-photo').forEach(img => {
		injectMessageBanner(img,
			() => img.src || null,
			() => randomFileName('jpg')
		);
	});

	document.querySelectorAll('.media-video').forEach(video => {
		injectMessageBanner(video,
			() => video.currentSrc || video.src || null,
			() => randomFileName('mp4')
		);
	});
}

scan();
setInterval(scan, 1500);
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });


}
