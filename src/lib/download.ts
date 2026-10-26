/** Starts a file download (the response is an attachment, so the page stays put). */
export function startDownload(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
