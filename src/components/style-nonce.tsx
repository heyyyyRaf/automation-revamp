"use client";

import { setNonce } from "get-nonce";

/**
 * Dialogs lock page scrolling by adding a small <style> element (react-remove-scroll). The strict
 * CSP only allows styles carrying the nonce of the document as it was first loaded, so take it
 * from the page's own scripts. In-app navigation keeps that document (and its CSP), so a nonce
 * from a later request would be rejected.
 */
if (typeof document !== "undefined") {
  const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  if (nonce) setNonce(nonce);
}

export function StyleNonce() {
  return null;
}
