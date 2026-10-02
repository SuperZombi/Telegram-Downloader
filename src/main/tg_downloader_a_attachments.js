if (typeof TG_DOWNLOADER_ATTACHMENTS_EXECUTED !== 'undefined') {}
else {
var TG_DOWNLOADER_ATTACHMENTS_EXECUTED = true;


const AUDIO_CAPTURE_ATTEMPTS = 3;
const AUDIO_CAPTURE_RETRY_DELAY = 300;
const AUDIO_METADATA_TIMEOUT = 5000;
const AUDIO_SETTLE_TIMEOUT = 3000;
const AUDIO_PART_RETRIES = 3;
const AUDIO_ABORTED_BY_USER = 'Aborted by user';
const AUDIO_EXTENSIONS = {
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/mp4': 'm4a',
	'audio/m4a': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/aac': 'aac',
	'audio/ogg': 'ogg',
	'audio/opus': 'opus',
	'audio/flac': 'flac',
	'audio/x-flac': 'flac',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav',
};

const _tgDlAudioJobs = new Map();

window.addEventListener('message', (event) => {
	if (event.source !== window || event.data?.from !== 'TG_DOWNLOADER_POPUP') return;
	const message = event.data.message || {};
	if (message.event === 'abort') {
		_tgDlAudioJobs.get(String(message.id))?.abort();
	}
});

function _tgDlNotify(message) {
	window.postMessage({ from: 'TG_DOWNLOADER', message });
}

function _tgDlSleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(signal.reason);
		}, { once: true });
	});
}

function _tgDlSaveUrl(url, filename) {
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
}

function _tgDlDispatch(target, type) {
	const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1 };
	target.dispatchEvent(new MouseEvent(type, opts));
}

async function _tgDlWaitUntil(predicate, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = predicate();
		if (value) return value;
		await _tgDlSleep(50);
	}
	return null;
}

async function _tgDlAfterRender() {
	for (let i = 0; i < 2; i++) {
		await new Promise(resolve => {
			requestAnimationFrame(resolve);
			setTimeout(resolve, 250);
		});
	}
}

// Telegram handles the play button synchronously inside dispatchEvent, so play()/pause() calls made
// during the dispatch belong to this message's track. Prefetching the next track never calls play().
function _tgDlCaptureAudioCall(playButton) {
	const calls = [];
	const proto = HTMLMediaElement.prototype;
	const { play, pause } = proto;
	proto.play = function() {
		if (this instanceof HTMLAudioElement) calls.push({ type: 'play', el: this, wasPlaying: !this.paused });
		return play.call(this);
	};
	proto.pause = function() {
		if (this instanceof HTMLAudioElement) calls.push({ type: 'pause', el: this, wasPlaying: !this.paused });
		return pause.call(this);
	};
	let trigger = null;
	try {
		for (const type of ['mousedown', 'click']) {
			_tgDlDispatch(playButton, type);
			if (calls.length) {
				trigger = type;
				break;
			}
		}
	} finally {
		proto.play = play;
		proto.pause = pause;
	}
	const call = calls.filter(c => c.type === 'play').at(-1) || (calls.length === 1 ? calls[0] : null);
	return call && { ...call, trigger };
}

// Pausing the element directly does not stick: Telegram's render effects see a track that should play
// and start it again. So wait until Telegram has rendered the new state and toggle back through its button.
async function _tgDlSettlePlayback(msg, call, labelBefore, keepPlaying) {
	const { el, trigger } = call;
	if (keepPlaying === !el.paused) return;
	const muted = el.muted;
	if (!keepPlaying) el.muted = true;
	const getButton = () => msg.querySelector('.Audio .toggle-play');
	const rendered = await _tgDlWaitUntil(() => {
		const button = getButton();
		return button && button.getAttribute('aria-label') !== labelBefore;
	}, AUDIO_SETTLE_TIMEOUT);
	if (rendered) {
		await _tgDlAfterRender();
		const button = getButton();
		if (button) _tgDlDispatch(button, trigger);
	}
	if (keepPlaying && el.paused) el.play().catch(() => {});
	if (!keepPlaying && !el.paused) el.pause();
	el.muted = muted;
}

function _tgDlReadAudioDuration(audioEl) {
	const text = audioEl.querySelector('.duration:not(.with-seekline)')?.textContent.trim();
	if (!text || !/^\d+(:\d{2}){1,2}$/.test(text)) return null;
	const seconds = text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
	return seconds || null;
}

function _tgDlWaitForDuration(el, timeout) {
	const read = () => (Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
	if (read() !== null) return Promise.resolve(read());
	return new Promise(resolve => {
		const finish = () => {
			clearTimeout(timer);
			el.removeEventListener('loadedmetadata', finish);
			resolve(read());
		};
		const timer = setTimeout(finish, timeout);
		el.addEventListener('loadedmetadata', finish);
	});
}

function _tgDlDurationsMatch(expected, actual) {
	if (expected === null || actual === null) return true;
	return Math.abs(expected - actual) <= Math.max(5, expected * 0.1);
}

function _tgDlFormatDuration(seconds) {
	const total = Math.round(seconds);
	const parts = [Math.floor(total / 3600), Math.floor(total % 3600 / 60), total % 60];
	if (!parts[0]) parts.shift();
	return parts.map((value, i) => (i ? String(value).padStart(2, '0') : String(value))).join(':');
}

async function _tgDlResolveAudio(msg) {
	const audioEl = msg?.querySelector('.Audio');
	if (!audioEl?.querySelector('.toggle-play')) throw new Error('Play button not found');
	const expectedDuration = _tgDlReadAudioDuration(audioEl);
	for (let attempt = 1; attempt <= AUDIO_CAPTURE_ATTEMPTS; attempt++) {
		const playButton = msg.querySelector('.Audio .toggle-play');
		const labelBefore = playButton?.getAttribute('aria-label');
		const call = playButton && _tgDlCaptureAudioCall(playButton);
		const url = call?.el.src;
		if (url) {
			await _tgDlSettlePlayback(msg, call, labelBefore, attempt === 1 && call.wasPlaying);
			const actualDuration = await _tgDlWaitForDuration(call.el, AUDIO_METADATA_TIMEOUT);
			return { url, expectedDuration, actualDuration };
		}
		await _tgDlSleep(AUDIO_CAPTURE_RETRY_DELAY);
	}
	throw new Error('Could not identify the audio file');
}

async function _tgDlRequestAudioPart(url, offset, signal) {
	const res = await fetch(url, { headers: { Range: `bytes=${offset}-` }, signal });
	const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	if (res.status === 200 && offset === 0) {
		const blob = await res.blob();
		const length = res.headers.get('content-length');
		if (length !== null && blob.size !== Number(length)) throw new Error('Incomplete response');
		return { blob, end: blob.size - 1, total: blob.size, mimeType };
	}
	if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
	const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('content-range') || '');
	if (!range) throw new Error('Invalid Content-Range');
	const [start, end, total] = range.slice(1).map(Number);
	if (start !== offset || end < start || end >= total) throw new Error(`Unexpected range ${start}-${end}/${total}`);
	const blob = await res.blob();
	if (blob.size !== end - start + 1) throw new Error(`Incomplete part at ${start}`);
	return { blob, end, total, mimeType };
}

async function _tgDlFetchAudioPart(url, offset, signal) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await _tgDlRequestAudioPart(url, offset, signal);
		} catch (err) {
			if (signal.aborted || attempt >= AUDIO_PART_RETRIES) throw err;
			await _tgDlSleep(500 * 2 ** attempt, signal);
		}
	}
}

async function _tgDlFetchAudio(url, signal, onProgress) {
	const parts = [];
	let offset = 0;
	let total = null;
	let mimeType = '';
	do {
		const part = await _tgDlFetchAudioPart(url, offset, signal);
		if (total === null) {
			total = part.total;
			mimeType = part.mimeType;
		} else if (part.total !== total) {
			throw new Error('File size changed during download');
		}
		parts.push(part.blob);
		offset = part.end + 1;
		onProgress(total ? Math.floor(offset * 100 / total) : 100);
	} while (offset < total);
	const blob = new Blob(parts, { type: mimeType });
	if (blob.size !== total) throw new Error('Downloaded size does not match the file size');
	return blob;
}

function _tgDlAudioExtension(mimeType) {
	if (AUDIO_EXTENSIONS[mimeType]) return AUDIO_EXTENSIONS[mimeType];
	const subtype = (mimeType.split('/')[1] || '').replace(/^x-/, '');
	return /^[a-z0-9]{2,5}$/.test(subtype) ? subtype : 'bin';
}

async function _tgDlDownloadAudio(url, controller, onProgress) {
	const id = `audio-${crypto.randomUUID()}`;
	const name = randomFileName();
	_tgDlAudioJobs.set(id, controller);
	_tgDlNotify({ event: 'new', id, filename: name, thumbnail: '' });
	try {
		const blob = await _tgDlFetchAudio(url, controller.signal, (percent) => {
			onProgress(percent);
			_tgDlNotify({ event: 'progress', id, percent });
		});
		controller.signal.throwIfAborted();
		const blobUrl = URL.createObjectURL(blob);
		_tgDlSaveUrl(blobUrl, `${name}.${_tgDlAudioExtension(blob.type)}`);
		setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
		_tgDlNotify({ event: 'complete', id });
	} catch (err) {
		const reason = controller.signal.aborted ? AUDIO_ABORTED_BY_USER : err.message;
		_tgDlNotify({ event: 'abort', id, reason });
		throw err;
	} finally {
		_tgDlAudioJobs.delete(id);
	}
}

function _tgDlCreateBanner() {
	const btn = document.createElement('button');
	btn.className = 'tg-dl-banner';
	btn.textContent = '⬇ Download';
	btn.type = 'button';
	return btn;
}

function makeBanner(getUrl, getFilename) {
	const btn = _tgDlCreateBanner();
	btn.onclick = (e) => {
		e.stopPropagation();
		e.preventDefault();
		const url = getUrl();
		if (url) _tgDlSaveUrl(url, getFilename());
	};
	return btn;
}

function makeAudioBanner() {
	const btn = _tgDlCreateBanner();
	let state = 'idle';
	let controller = null;
	let unverifiedUrl = null;

	const setState = (next, text, percent = 0) => {
		state = next;
		btn.className = `tg-dl-banner tg-dl-${next}`;
		btn.textContent = text;
		btn.style.setProperty('--tg-dl-progress', `${percent}%`);
	};

	const download = async (url) => {
		controller = new AbortController();
		setState('progress', '⬇ 0% — click to cancel');
		try {
			await _tgDlDownloadAudio(url, controller, (percent) => {
				setState('progress', `⬇ ${percent}% — click to cancel`, percent);
			});
			setState('done', '✓ Downloaded');
		} catch (err) {
			if (controller.signal.aborted) setState('idle', '⬇ Download');
			else setState('error', `⚠ ${err.message} — click to retry`);
		} finally {
			controller = null;
		}
	};

	btn.onclick = async (e) => {
		e.stopPropagation();
		e.preventDefault();
		if (state === 'resolving') return;
		if (state === 'progress') {
			controller?.abort();
			return;
		}
		if (state === 'mismatch') {
			await download(unverifiedUrl);
			return;
		}
		setState('resolving', '⏳ Preparing...');
		try {
			const { url, expectedDuration, actualDuration } = await _tgDlResolveAudio(btn.closest('.Message'));
			if (_tgDlDurationsMatch(expectedDuration, actualDuration)) {
				await download(url);
				return;
			}
			unverifiedUrl = url;
			const actual = _tgDlFormatDuration(actualDuration);
			const expected = _tgDlFormatDuration(expectedDuration);
			setState('mismatch', `⚠ File is ${actual} long, message says ${expected} — click to download anyway`);
		} catch (err) {
			setState('error', `⚠ ${err.message} — click to retry`);
		}
	};
	return btn;
}

function injectMessageBanner(mediaEl, createBanner) {
	const msg = mediaEl.closest('.Message');
	if (!msg || msg.querySelector('.tg-dl-banner')) return;
	const content = msg.querySelector('.message-content');
	if (!content) return;
	content.appendChild(createBanner());
}

function scan() {
	document.querySelectorAll('.Audio').forEach(el => {
		injectMessageBanner(el, makeAudioBanner);
	});

	document.querySelectorAll('.media-photo').forEach(img => {
		injectMessageBanner(img, () => makeBanner(
			() => img.src || null,
			() => randomFileName('jpg')
		));
	});

	document.querySelectorAll('.media-video').forEach(video => {
		injectMessageBanner(video, () => makeBanner(
			() => video.currentSrc || video.src || null,
			() => randomFileName('mp4')
		));
	});
}

scan();
setInterval(scan, 1500);
new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });


}
