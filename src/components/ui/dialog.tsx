"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import type * as React from "react";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  wide,
  children,
}: {
  title: string;
  description?: string;
  /** Wider dialog for long forms (test case editor). */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <D.Portal>
      <D.Overlay className="bg-ink/40 fixed inset-0 z-40" />
      <D.Content
        className={`fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-card -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-white p-6 shadow-xl focus:outline-none`}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <D.Title className="text-ink text-[19px] font-bold">{title}</D.Title>
            <D.Description className={description ? "text-muted mt-1 text-sm" : "sr-only"}>
              {description ?? title}
            </D.Description>
          </div>
          <D.Close
            className="text-muted hover:bg-page inline-flex size-11 items-center justify-center rounded-lg"
            aria-label="Close"
          >
            <X className="size-5" />
          </D.Close>
        </div>
        {children}
      </D.Content>
    </D.Portal>
  );
}
