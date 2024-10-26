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
